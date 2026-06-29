use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Note {
    pub id: String,
    pub title: String,
    pub content: String,
    pub path: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub tags: Vec<String>,
    pub color: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct NoteFrontmatter {
    title: String,
    created: String,
    modified: String,
    tags: Vec<String>,
    color: Option<String>,
}

// Parse markdown frontmatter
fn parse_frontmatter(content: &str) -> Option<(NoteFrontmatter, String)> {
    // Defensive: strip a leading UTF-8 BOM if some external tool added one
    // (a BOM before `---` would otherwise break this parser).
    let content = content.strip_prefix('\u{feff}').unwrap_or(content);

    if !content.starts_with("---") {
        return None;
    }

    let parts: Vec<&str> = content.splitn(3, "---").collect();
    if parts.len() < 3 {
        return None;
    }

    let frontmatter_str = parts[1].trim();
    let body = parts[2].trim();

    // Simple parsing (not using serde_yaml for now)
    let mut title = String::new();
    let mut created = String::new();
    let mut modified = String::new();
    let mut tags: Vec<String> = vec![];
    let mut color = None;

    for line in frontmatter_str.lines() {
        if let Some((key, value)) = line.split_once(':') {
            let key = key.trim();
            let value = value.trim();
            match key {
                "title" => title = value.to_string(),
                "created" => created = value.to_string(),
                "modified" => modified = value.to_string(),
                "color" => color = Some(value.to_string()),
                "tags" => {
                    // e.g. `tags: [a, b]` — preserve so app saves don't wipe
                    // tags that the external MCP set.
                    let inner = value.trim().trim_start_matches('[').trim_end_matches(']');
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

    Some((
        NoteFrontmatter {
            title,
            created,
            modified,
            tags,
            color,
        },
        body.to_string(),
    ))
}

// Create markdown with frontmatter
fn create_markdown(note: &Note) -> String {
    let color_line = if let Some(ref color) = note.color {
        format!("color: {}\n", color)
    } else {
        String::new()
    };

    format!(
        "---\ntitle: {}\ncreated: {}\nmodified: {}\ntags: [{}]\n{}---\n\n{}",
        note.title,
        note.created_at,
        note.updated_at,
        note.tags.join(", "),
        color_line,
        note.content
    )
}

// Generate filename from title
fn generate_filename(title: &str) -> String {
    let slug = title
        .to_lowercase()
        .replace(" ", "-")
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-')
        .collect::<String>();

    let timestamp = chrono::Utc::now().format("%Y%m%d-%H%M%S");
    format!("note-{}-{}.md", timestamp, slug)
}

#[tauri::command]
pub async fn list_notes_files(directory: String, include_content: bool) -> Result<Vec<Note>, String> {
    let path = Path::new(&directory);
    if !path.exists() {
        return Err(format!("Directory does not exist: {}", directory));
    }

    let mut notes = Vec::new();

    for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_path = entry.path();

        if file_path.is_dir() {
            continue;
        }

        let is_md = file_path
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| s.to_lowercase() == "md")
            .unwrap_or(false);

        if is_md {
            let content = match fs::read_to_string(&file_path) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("Failed to read note file {:?}: {}", file_path, e);
                    continue;
                }
            };

            let filename = file_path.file_name().unwrap().to_str().unwrap().to_string();

            let note = if let Some((frontmatter, body)) = parse_frontmatter(&content) {
                Note {
                    id: filename.clone(),
                    title: frontmatter.title,
                    content: if include_content { body } else { String::new() },
                    path: Some(file_path.to_str().unwrap().to_string()),
                    created_at: frontmatter.created,
                    updated_at: frontmatter.modified,
                    tags: frontmatter.tags,
                    color: frontmatter.color,
                }
            } else {
                let title = file_path.file_stem().unwrap().to_str().unwrap().to_string();
                let now = chrono::Utc::now().to_rfc3339();
                Note {
                    id: filename.clone(),
                    title,
                    content: if include_content { content.clone() } else { String::new() },
                    path: Some(file_path.to_str().unwrap().to_string()),
                    created_at: now.clone(),
                    updated_at: now,
                    tags: vec![],
                    color: None,
                }
            };

            notes.push(note);
        }
    }

    notes.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(notes)
}

#[tauri::command]
pub async fn create_note_file(
    directory: String,
    title: String,
    watcher: tauri::State<'_, crate::watcher::WatcherState>,
) -> Result<Note, String> {
    let filename = generate_filename(&title);
    let path = Path::new(&directory);

    // Ensure directory exists
    if !path.exists() {
        fs::create_dir_all(path).map_err(|e| e.to_string())?;
    }

    let file_path = path.join(&filename);

    let now = chrono::Utc::now().to_rfc3339();
    let note = Note {
        id: filename.clone(),
        title: title.clone(),
        content: String::new(),
        path: Some(file_path.to_str().unwrap().to_string()),
        created_at: now.clone(),
        updated_at: now,
        tags: vec![],
        color: None,
    };

    watcher.mark_self_write(&file_path.to_string_lossy());
    let markdown = create_markdown(&note);
    fs::write(&file_path, markdown).map_err(|e| e.to_string())?;

    Ok(note)
}

#[tauri::command]
pub async fn save_note_to_file(
    path: String,
    content: String,
    title: String,
    color: Option<String>,
    watcher: tauri::State<'_, crate::watcher::WatcherState>,
) -> Result<(), String> {
    // Mark this as a self-write so the filesystem watcher ignores the event.
    watcher.mark_self_write(&path);

    // Non-lossy save: preserve `created`/`tags` from the existing file and keep
    // its `color` unless a new one is passed. Metadata the app has no UI for but
    // the external MCP relies on is never wiped. Logic lives in `notes-core`
    // (unit-tested); see rebuild_preserving.
    let now = chrono::Utc::now().to_rfc3339();
    let existing = fs::read_to_string(&path).ok();
    let markdown = notes_core::rebuild_preserving(existing.as_deref(), &title, &content, color, &now);
    fs::write(&path, markdown).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn delete_note_file(
    path: String,
    watcher: tauri::State<'_, crate::watcher::WatcherState>,
) -> Result<(), String> {
    watcher.mark_self_write(&path);
    let p = Path::new(&path);
    if p.exists() {
        fs::remove_file(p).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// --- Search ---
// The pure search logic lives in the `notes-core` crate (so it can be unit
// tested without the GUI stack). These commands are just the Tauri entry points.
pub use notes_core::{FileSearchHit, SearchHit};

#[tauri::command]
pub async fn search_notes(directory: String, query: String) -> Result<Vec<SearchHit>, String> {
    let path = Path::new(&directory);
    if !path.exists() {
        return Err(format!("Directory does not exist: {}", directory));
    }
    Ok(notes_core::search_notes_in_dir(path, &query))
}

/// "Super search" over the files tab: filename + file content, recursively.
#[tauri::command]
pub async fn search_files(directory: String, query: String) -> Result<Vec<FileSearchHit>, String> {
    let path = Path::new(&directory);
    if !path.exists() {
        return Err(format!("Directory does not exist: {}", directory));
    }
    Ok(notes_core::search_files_in_tree(path, &query))
}
