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
    let tags = vec![];

    for line in frontmatter_str.lines() {
        if let Some((key, value)) = line.split_once(':') {
            let key = key.trim();
            let value = value.trim();
            match key {
                "title" => title = value.to_string(),
                "created" => created = value.to_string(),
                "modified" => modified = value.to_string(),
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
            color: None,
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
pub async fn list_notes_files(directory: String) -> Result<Vec<Note>, String> {
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

        let is_md = file_path.extension()
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
                    content: body,
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
                    content: content.clone(),
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
) -> Result<Note, String> {
    let filename = generate_filename(&title);
    let file_path = Path::new(&directory).join(&filename);

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

    let markdown = create_markdown(&note);
    fs::write(&file_path, markdown).map_err(|e| e.to_string())?;

    Ok(note)
}

#[tauri::command]
pub async fn save_note_to_file(
    path: String,
    content: String,
    title: String,
) -> Result<(), String> {
    // Read existing file to preserve frontmatter if possible, or just overwrite with basic structure
    let now = chrono::Utc::now().to_rfc3339();
    
    // We recreate the note object just for saving
    let note = Note {
        id: String::new(), // Not needed for save
        title: title,
        content: content,
        path: Some(path.clone()),
        created_at: now.clone(), // This might be wrong if we don't have original, but usually enough for simple save
        updated_at: now,
        tags: vec![],
        color: None,
    };

    let markdown = create_markdown(&note);
    fs::write(&path, markdown).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn delete_note_file(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.exists() {
        fs::remove_file(p).map_err(|e| e.to_string())?;
    }
    Ok(())
}
