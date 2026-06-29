//! Pure note-search logic, isolated from Tauri so it is cheaply and reliably
//! testable (the app crate's test harness links the whole WebView2 stack).
//!
//! Search scans the `.md` files directly in a directory (non-recursive, to
//! match the app's `list_notes_files`) for a case-insensitive substring match
//! in the note title or body.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SearchHit {
    pub id: String,
    pub title: String,
    pub path: String,
    /// Short excerpt of the body around the first match (original casing).
    pub snippet: String,
    /// Total matches across title + body.
    pub match_count: usize,
    /// Whether the query matched the title.
    pub title_match: bool,
}

/// Derive a note's title and body from its file contents. If the file has
/// `---` frontmatter, the `title:` line is used (falling back to the file
/// stem); otherwise the whole file is the body and the stem is the title.
fn title_and_body(content: &str, file_stem: &str) -> (String, String) {
    if content.starts_with("---") {
        let parts: Vec<&str> = content.splitn(3, "---").collect();
        if parts.len() == 3 {
            let mut title = file_stem.to_string();
            for line in parts[1].lines() {
                if let Some((key, value)) = line.split_once(':') {
                    if key.trim() == "title" {
                        let v = value.trim();
                        if !v.is_empty() {
                            title = v.to_string();
                        }
                    }
                }
            }
            return (title, parts[2].trim().to_string());
        }
    }
    (file_stem.to_string(), content.to_string())
}

/// Count non-overlapping occurrences of `needle` in `haystack`.
/// Both are expected to already be lowercased by the caller.
fn count_occurrences(haystack: &str, needle: &str) -> usize {
    if needle.is_empty() {
        return 0;
    }
    let mut count = 0;
    let mut start = 0;
    while let Some(idx) = haystack[start..].find(needle) {
        count += 1;
        start += idx + needle.len();
    }
    count
}

/// Build a whitespace-collapsed excerpt of `body` around the first occurrence
/// of `query_lc` (lowercased query), preserving the body's original casing.
fn make_snippet(body: &str, query_lc: &str, window: usize) -> String {
    let body_lc = body.to_lowercase();
    let chars: Vec<char> = body.chars().collect();

    let char_start = match body_lc.find(query_lc) {
        Some(byte_idx) => body_lc[..byte_idx].chars().count(),
        None => 0,
    };
    let qlen = query_lc.chars().count();
    let start = char_start.saturating_sub(window);
    let end = (char_start + qlen + window).min(chars.len());

    let mut out = String::new();
    if start > 0 {
        out.push('…');
    }
    out.extend(&chars[start..end]);
    if end < chars.len() {
        out.push('…');
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Search the `.md` files directly in `dir` for `query`. Results are ranked
/// title-matches first, then by descending match count, then title.
pub fn search_notes_in_dir(dir: &Path, query: &str) -> Vec<SearchHit> {
    let q = query.trim().to_lowercase();
    let mut hits: Vec<SearchHit> = Vec::new();
    if q.is_empty() {
        return hits;
    }

    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return hits,
    };

    for entry in entries.flatten() {
        let file_path = entry.path();
        if file_path.is_dir() {
            continue;
        }
        let is_md = file_path
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| s.eq_ignore_ascii_case("md"))
            .unwrap_or(false);
        if !is_md {
            continue;
        }

        let content = match fs::read_to_string(&file_path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let file_stem = file_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("");
        let (title, body) = title_and_body(&content, file_stem);

        let title_match = title.to_lowercase().contains(&q);
        let match_count = count_occurrences(&body.to_lowercase(), &q) + usize::from(title_match);
        if match_count == 0 {
            continue;
        }

        hits.push(SearchHit {
            id: file_path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string(),
            title,
            path: file_path.to_string_lossy().to_string(),
            snippet: make_snippet(&body, &q, 48),
            match_count,
            title_match,
        });
    }

    hits.sort_by(|a, b| {
        b.title_match
            .cmp(&a.title_match)
            .then(b.match_count.cmp(&a.match_count))
            .then(a.title.to_lowercase().cmp(&b.title.to_lowercase()))
    });
    hits
}

// --- Frontmatter-preserving save ---
// Mirrors the app's on-disk format EXACTLY (byte-compatible with the MCP).
// Used so the app's save no longer wipes `created`/`tags`/`color` set externally.

/// Parse `created`, `tags`, and `color` out of a note's frontmatter.
/// Returns None if there is no `---` frontmatter block.
fn parse_meta(content: &str) -> Option<(String, Vec<String>, Option<String>)> {
    // Tolerate a stray leading BOM (would otherwise hide the leading `---`).
    let content = content.strip_prefix('\u{feff}').unwrap_or(content);
    if !content.starts_with("---") {
        return None;
    }
    let parts: Vec<&str> = content.splitn(3, "---").collect();
    if parts.len() < 3 {
        return None;
    }
    let mut created = String::new();
    let mut tags: Vec<String> = vec![];
    let mut color = None;
    for line in parts[1].trim().lines() {
        if let Some((k, v)) = line.split_once(':') {
            let (k, v) = (k.trim(), v.trim());
            match k {
                "created" => created = v.to_string(),
                "color" => color = Some(v.to_string()),
                "tags" => {
                    let inner = v.trim_start_matches('[').trim_end_matches(']');
                    tags = inner
                        .split(',')
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                        .collect();
                }
                _ => {}
            }
        }
    }
    Some((created, tags, color))
}

/// Build a note file body byte-compatible with the app's writer.
pub fn build_markdown(
    title: &str,
    created: &str,
    modified: &str,
    tags: &[String],
    color: Option<&str>,
    body: &str,
) -> String {
    let color_line = match color {
        Some(c) => format!("color: {}\n", c),
        None => String::new(),
    };
    format!(
        "---\ntitle: {}\ncreated: {}\nmodified: {}\ntags: [{}]\n{}---\n\n{}",
        title,
        created,
        modified,
        tags.join(", "),
        color_line,
        body
    )
}

/// Rebuild a note's file content for a save, **preserving** `created` and `tags`
/// from the existing file, and keeping the existing `color` unless a new one is
/// given. `modified` is always set to `now`. This is what makes the app's save
/// non-lossy so it doesn't clobber metadata the external MCP set.
pub fn rebuild_preserving(
    existing: Option<&str>,
    title: &str,
    body: &str,
    new_color: Option<String>,
    now: &str,
) -> String {
    let (created, tags, existing_color) = existing
        .and_then(parse_meta)
        .unwrap_or((String::new(), vec![], None));
    let created = if created.is_empty() { now.to_string() } else { created };
    let color = new_color.or(existing_color);
    build_markdown(title, &created, now, &tags, color.as_deref(), body)
}

// --- "Super search" across a directory tree: filename + file contents. ---

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FileSearchHit {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    /// Whether the query matched the file/dir name.
    pub name_match: bool,
    /// 1-based line of the first content match (None for name-only / dirs).
    pub line_number: Option<usize>,
    /// The first matching line, trimmed/truncated (empty for name-only / dirs).
    pub snippet: String,
    /// Content occurrences + 1 if the name matched.
    pub match_count: usize,
}

/// Directories never worth scanning — keeps "super search" fast and relevant.
const SKIP_DIRS: &[&str] = &[
    "node_modules", "target", "dist", "build", ".svelte-kit", ".cache",
    ".next", "vendor", "__pycache__", ".venv", "venv", ".idea", ".vs",
];

/// Heuristic: a NUL byte in the first chunk means "binary, don't grep it".
fn is_probably_binary(bytes: &[u8]) -> bool {
    bytes.iter().take(8192).any(|&b| b == 0)
}

fn line_snippet(line: &str, max_chars: usize) -> String {
    let trimmed = line.trim();
    let chars: Vec<char> = trimmed.chars().collect();
    if chars.len() <= max_chars {
        trimmed.to_string()
    } else {
        let head: String = chars[..max_chars].iter().collect();
        format!("{head}…")
    }
}

/// Recursively search `root` for `query` in file/dir names and file contents.
/// Uses sane defaults for result/scan/size caps.
pub fn search_files_in_tree(root: &Path, query: &str) -> Vec<FileSearchHit> {
    search_files_with_limits(root, query, 300, 20_000, 1_000_000)
}

fn search_files_with_limits(
    root: &Path,
    query: &str,
    max_results: usize,
    max_files: usize,
    max_bytes: u64,
) -> Vec<FileSearchHit> {
    let q = query.trim().to_lowercase();
    let mut hits: Vec<FileSearchHit> = Vec::new();
    // Require >= 2 chars: a single character would match almost everything and
    // make a recursive content scan pointlessly expensive.
    if q.len() < 2 {
        return hits;
    }

    let mut stack = vec![root.to_path_buf()];
    let mut files_scanned = 0usize;

    while let Some(dir) = stack.pop() {
        if hits.len() >= max_results || files_scanned >= max_files {
            break;
        }
        let rd = match fs::read_dir(&dir) {
            Ok(r) => r,
            Err(_) => continue,
        };
        for entry in rd.flatten() {
            if hits.len() >= max_results || files_scanned >= max_files {
                break;
            }
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            let file_type = match entry.file_type() {
                Ok(t) => t,
                Err(_) => continue,
            };

            if file_type.is_dir() {
                // Skip junk and hidden directories entirely.
                if SKIP_DIRS.contains(&name.as_str()) || name.starts_with('.') {
                    continue;
                }
                if name.to_lowercase().contains(&q) {
                    hits.push(FileSearchHit {
                        path: path.to_string_lossy().to_string(),
                        name: name.clone(),
                        is_dir: true,
                        name_match: true,
                        line_number: None,
                        snippet: String::new(),
                        match_count: 1,
                    });
                }
                stack.push(path);
                continue;
            }

            files_scanned += 1;
            let name_match = name.to_lowercase().contains(&q);

            let mut line_number = None;
            let mut snippet = String::new();
            let mut content_matches = 0usize;

            let small_enough = entry.metadata().map(|m| m.len() <= max_bytes).unwrap_or(false);
            if small_enough {
                if let Ok(bytes) = fs::read(&path) {
                    if !is_probably_binary(&bytes) {
                        let text = String::from_utf8_lossy(&bytes);
                        for (i, line) in text.lines().enumerate() {
                            let c = count_occurrences(&line.to_lowercase(), &q);
                            if c > 0 {
                                content_matches += c;
                                if line_number.is_none() {
                                    line_number = Some(i + 1);
                                    snippet = line_snippet(line, 120);
                                }
                            }
                        }
                    }
                }
            }

            if name_match || content_matches > 0 {
                hits.push(FileSearchHit {
                    path: path.to_string_lossy().to_string(),
                    name,
                    is_dir: false,
                    name_match,
                    line_number,
                    snippet,
                    match_count: content_matches + usize::from(name_match),
                });
            }
        }
    }

    hits.sort_by(|a, b| {
        b.name_match
            .cmp(&a.name_match)
            .then(b.match_count.cmp(&a.match_count))
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    hits.truncate(max_results);
    hits
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn temp_dir(setup: impl FnOnce(&Path)) -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("notescore_test_{}_{}", std::process::id(), n));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        setup(&dir);
        dir
    }

    fn write(dir: &Path, name: &str, contents: &str) {
        fs::write(dir.join(name), contents).unwrap();
    }

    fn note(title: &str, body: &str) -> String {
        format!(
            "---\ntitle: {}\ncreated: 2026-01-01\nmodified: 2026-01-01\ntags: []\n---\n\n{}",
            title, body
        )
    }

    #[test]
    fn finds_match_in_body() {
        let dir = temp_dir(|d| {
            write(d, "a.md", &note("Alpha", "I love the rustacean mascot."));
            write(d, "b.md", &note("Beta", "Nothing relevant here."));
        });
        let hits = search_notes_in_dir(&dir, "rust");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].title, "Alpha");
        assert_eq!(hits[0].id, "a.md");
        assert_eq!(hits[0].match_count, 1);
        assert!(!hits[0].title_match);
        assert!(hits[0].snippet.to_lowercase().contains("rustacean"));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn is_case_insensitive() {
        let dir = temp_dir(|d| write(d, "a.md", &note("Notes", "Built with Rust and Tauri.")));
        assert_eq!(search_notes_in_dir(&dir, "RUST").len(), 1);
        assert_eq!(search_notes_in_dir(&dir, "rust").len(), 1);
        assert_eq!(search_notes_in_dir(&dir, "TaUrI").len(), 1);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn title_match_ranks_first() {
        let dir = temp_dir(|d| {
            write(d, "body.md", &note("Groceries", "remember the project deadline"));
            write(d, "title.md", &note("Project plan", "unrelated body text"));
        });
        let hits = search_notes_in_dir(&dir, "project");
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].title, "Project plan");
        assert!(hits[0].title_match);
        assert!(!hits[1].title_match);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn counts_multiple_matches() {
        let dir = temp_dir(|d| write(d, "a.md", &note("X", "test one test two test three")));
        let hits = search_notes_in_dir(&dir, "test");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].match_count, 3);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn title_and_body_match_counts_combine() {
        let dir = temp_dir(|d| write(d, "a.md", &note("Rust notes", "rust is great, rust rocks")));
        let hits = search_notes_in_dir(&dir, "rust");
        assert_eq!(hits.len(), 1);
        assert!(hits[0].title_match);
        assert_eq!(hits[0].match_count, 3); // 1 title + 2 body
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn no_match_returns_empty() {
        let dir = temp_dir(|d| write(d, "a.md", &note("Alpha", "some content")));
        assert!(search_notes_in_dir(&dir, "zzzznotfound").is_empty());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn empty_or_whitespace_query_returns_empty() {
        let dir = temp_dir(|d| write(d, "a.md", &note("Alpha", "content")));
        assert!(search_notes_in_dir(&dir, "").is_empty());
        assert!(search_notes_in_dir(&dir, "   ").is_empty());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn ignores_non_md_files() {
        let dir = temp_dir(|d| {
            write(d, "note.txt", "this txt mentions rust but must be ignored");
            write(d, "real.md", &note("Real", "this md mentions rust"));
        });
        let hits = search_notes_in_dir(&dir, "rust");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].id, "real.md");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn searches_files_without_frontmatter() {
        let dir = temp_dir(|d| write(d, "plain.md", "just a plain note about kanban boards"));
        let hits = search_notes_in_dir(&dir, "kanban");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].title, "plain");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn missing_directory_yields_no_hits() {
        let missing = std::env::temp_dir().join("notescore_does_not_exist_zzz");
        assert!(search_notes_in_dir(&missing, "anything").is_empty());
    }

    #[test]
    fn snippet_truncates_with_ellipsis() {
        let long = "x".repeat(200) + " findme " + &"y".repeat(200);
        let dir = temp_dir(|d| write(d, "a.md", &note("Long", &long)));
        let hits = search_notes_in_dir(&dir, "findme");
        assert_eq!(hits.len(), 1);
        assert!(hits[0].snippet.contains('…'));
        assert!(hits[0].snippet.contains("findme"));
        fs::remove_dir_all(&dir).unwrap();
    }

    // --- file-tree "super search" tests ---

    #[test]
    fn file_search_matches_content_recursively() {
        let dir = temp_dir(|d| {
            fs::create_dir_all(d.join("sub/deep")).unwrap();
            write(d, "sub/deep/config.toml", "key = \"needle value\"\nother = 1");
            write(d, "unrelated.txt", "nothing here");
        });
        let hits = search_files_in_tree(&dir, "needle");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].name, "config.toml");
        assert!(!hits[0].is_dir);
        assert_eq!(hits[0].line_number, Some(1));
        assert!(hits[0].snippet.contains("needle"));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn file_search_matches_filename() {
        let dir = temp_dir(|d| write(d, "todo-list.md", "body without the term"));
        let hits = search_files_in_tree(&dir, "todo");
        assert_eq!(hits.len(), 1);
        assert!(hits[0].name_match);
        assert_eq!(hits[0].match_count, 1);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn file_search_matches_directory_name() {
        let dir = temp_dir(|d| {
            fs::create_dir_all(d.join("invoices")).unwrap();
            write(d, "invoices/jan.txt", "irrelevant");
        });
        let hits = search_files_in_tree(&dir, "invoices");
        assert!(hits.iter().any(|h| h.is_dir && h.name == "invoices"));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn file_search_skips_junk_dirs() {
        let dir = temp_dir(|d| {
            fs::create_dir_all(d.join("node_modules/pkg")).unwrap();
            write(d, "node_modules/pkg/index.js", "the needle is in node_modules");
            write(d, "real.js", "no match here");
        });
        // The only file containing "needle" is inside node_modules → skipped.
        assert!(search_files_in_tree(&dir, "needle").is_empty());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn file_search_skips_binary_content() {
        let dir = temp_dir(|d| {
            // NUL byte makes it "binary"; the term must not match in content.
            fs::write(d.join("data.bin"), b"abc\0needle here").unwrap();
        });
        assert!(search_files_in_tree(&dir, "needle").is_empty());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn file_search_single_char_query_is_ignored() {
        let dir = temp_dir(|d| write(d, "a.txt", "a a a a a"));
        assert!(search_files_in_tree(&dir, "a").is_empty());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn file_search_respects_size_limit() {
        let dir = temp_dir(|d| write(d, "big.txt", "needle in a big file"));
        // max_bytes = 5 forces the file to be skipped for content scanning;
        // the name doesn't contain the term, so no hits.
        let hits = search_files_with_limits(&dir, "needle", 300, 20_000, 5);
        assert!(hits.is_empty());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn file_search_counts_content_occurrences() {
        let dir = temp_dir(|d| write(d, "a.txt", "alpha beta alpha\nalpha gamma"));
        let hits = search_files_in_tree(&dir, "alpha");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].match_count, 3);
        assert_eq!(hits[0].line_number, Some(1));
        fs::remove_dir_all(&dir).unwrap();
    }

    // --- non-lossy save (rebuild_preserving) tests ---

    #[test]
    fn save_preserves_created_and_tags() {
        let existing = note("Old Title", "old body"); // tags: [] in helper
        let existing = existing.replace("tags: []", "tags: [work, urgent]");
        let out = rebuild_preserving(Some(&existing), "New Title", "new body", None, "2026-09-09T00:00:00+00:00");
        assert!(out.contains("title: New Title"));
        assert!(out.contains("created: 2026-01-01")); // preserved from existing
        assert!(out.contains("modified: 2026-09-09T00:00:00+00:00")); // bumped
        assert!(out.contains("tags: [work, urgent]")); // preserved
        assert!(out.trim_end().ends_with("new body"));
    }

    #[test]
    fn save_preserves_color_when_no_new_color() {
        let existing = "---\ntitle: T\ncreated: 2026-01-01\nmodified: 2026-01-01\ntags: []\ncolor: #ff0000\n---\n\nbody";
        let out = rebuild_preserving(Some(existing), "T", "body", None, "2026-02-02T00:00:00+00:00");
        assert!(out.contains("color: #ff0000"));
    }

    #[test]
    fn save_new_color_overrides_existing() {
        let existing = "---\ntitle: T\ncreated: 2026-01-01\nmodified: 2026-01-01\ntags: []\ncolor: #ff0000\n---\n\nbody";
        let out = rebuild_preserving(Some(existing), "T", "body", Some("#00ff00".into()), "2026-02-02T00:00:00+00:00");
        assert!(out.contains("color: #00ff00"));
        assert!(!out.contains("#ff0000"));
    }

    #[test]
    fn save_new_note_uses_now_for_created() {
        let out = rebuild_preserving(None, "Fresh", "hello", None, "2026-03-03T00:00:00+00:00");
        assert!(out.contains("created: 2026-03-03T00:00:00+00:00"));
        assert!(out.contains("modified: 2026-03-03T00:00:00+00:00"));
        assert!(out.contains("tags: []"));
    }

    #[test]
    fn save_output_is_byte_compatible_format() {
        // No BOM, starts at byte 0 with '---', blank line before body.
        let out = rebuild_preserving(None, "T", "body text", None, "2026-01-01T00:00:00+00:00");
        assert!(out.starts_with("---\n"));
        assert!(!out.starts_with('\u{feff}'));
        assert!(out.contains("\n---\n\nbody text"));
    }

    #[test]
    fn save_tolerates_bom_in_existing() {
        let existing = format!("\u{feff}{}", note("T", "b").replace("tags: []", "tags: [keep]"));
        let out = rebuild_preserving(Some(&existing), "T", "b2", None, "2026-04-04T00:00:00+00:00");
        assert!(out.contains("tags: [keep]")); // parsed despite BOM
        assert!(out.contains("created: 2026-01-01"));
    }
}
