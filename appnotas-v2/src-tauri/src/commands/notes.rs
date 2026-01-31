use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

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

// Config for notes directory
#[derive(Debug, Serialize, Deserialize, Clone)]
struct NotesConfig {
    notes_directory: Option<String>,
}

// In-memory storage
static NOTES_STORE: Mutex<Option<HashMap<String, Note>>> = Mutex::new(None);
static CONFIG_STORE: Mutex<Option<NotesConfig>> = Mutex::new(None);

fn get_notes_store() -> std::sync::MutexGuard<'static, Option<HashMap<String, Note>>> {
    NOTES_STORE.lock().unwrap()
}

fn get_config_store() -> std::sync::MutexGuard<'static, Option<NotesConfig>> {
    CONFIG_STORE.lock().unwrap()
}

fn ensure_initialized() {
    let mut store = get_notes_store();
    if store.is_none() {
        *store = Some(HashMap::new());
    }
    drop(store);
    
    let mut config = get_config_store();
    if config.is_none() {
        *config = Some(NotesConfig {
            notes_directory: None,
        });
    }
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
pub async fn get_notes_directory() -> Result<Option<String>, String> {
    ensure_initialized();
    let config = get_config_store();
    Ok(config.as_ref().unwrap().notes_directory.clone())
}

#[tauri::command]
pub async fn set_notes_directory(directory: String) -> Result<(), String> {
    ensure_initialized();
    let mut config = get_config_store();
    let cfg = config.as_mut().unwrap();
    cfg.notes_directory = Some(directory);
    Ok(())
}

#[tauri::command]
pub async fn list_notes_files(directory: String) -> Result<Vec<Note>, String> {
    ensure_initialized();
    
    let path = Path::new(&directory);
    if !path.exists() {
        return Err(format!("Directory does not exist: {}", directory));
    }

    let mut notes = Vec::new();
    let mut notes_map = get_notes_store();
    let map = notes_map.as_mut().unwrap();

    for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_path = entry.path();

        if file_path.extension().and_then(|s| s.to_str()) == Some("md") {
            let content = fs::read_to_string(&file_path).map_err(|e| e.to_string())?;
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
                // Fallback for notes without frontmatter
                let title = file_path
                    .file_stem()
                    .unwrap()
                    .to_str()
                    .unwrap()
                    .to_string();
                let now = chrono::Utc::now().to_rfc3339();
                Note {
                    id: filename.clone(),
                    title,
                    content,
                    path: Some(file_path.to_str().unwrap().to_string()),
                    created_at: now.clone(),
                    updated_at: now,
                    tags: vec![],
                    color: None,
                }
            };

            map.insert(note.id.clone(), note.clone());
            notes.push(note);
        }
    }

    // Sort by modified date (newest first)
    notes.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));

    Ok(notes)
}

#[tauri::command]
pub async fn create_note_file(
    directory: String,
    title: String,
) -> Result<Note, String> {
    ensure_initialized();
   
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

    let mut notes = get_notes_store();
    notes.as_mut().unwrap().insert(note.id.clone(), note.clone());

    Ok(note)
}

#[tauri::command]
pub async fn save_note_to_file(
    id: String,
    content: String,
) -> Result<(), String> {
    ensure_initialized();
    
    let mut notes = get_notes_store();
    let map = notes.as_mut().unwrap();
    
    let note = map
        .get_mut(&id)
        .ok_or_else(|| "Note not found".to_string())?;

    note.content = content;
    note.updated_at = chrono::Utc::now().to_rfc3339();

    let markdown = create_markdown(&note);
    let path = note.path.as_ref().ok_or("No path for note")?;
    
    fs::write(path, markdown).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn delete_note_file(id: String) -> Result<(), String> {
    ensure_initialized();
    
    let mut notes = get_notes_store();
    let map = notes.as_mut().unwrap();
    
    let note = map
        .get(&id)
        .ok_or_else(|| "Note not found".to_string())?;

    let path = note.path.as_ref().ok_or("No path for note")?;
    fs::remove_file(path).map_err(|e| e.to_string())?;

    map.remove(&id);

    Ok(())
}

// OLD COMMANDS - Keep backward compatibility with in-memory notes
#[tauri::command]
pub async fn list_notes() -> Result<Vec<Note>, String> {
    ensure_initialized();
    let store = get_notes_store();
    let notes: Vec<Note> = store
        .as_ref()
        .unwrap()
        .values()
        .cloned()
        .collect();
    
    Ok(notes)
}

#[tauri::command]
pub async fn save_note(note: Note) -> Result<(), String> {
    ensure_initialized();
    let mut store = get_notes_store();
    let map = store.as_mut().unwrap();
    
    println!("Saving note: {} - {}", note.id, note.title);
    map.insert(note.id.clone(), note);
    
    Ok(())
}

#[tauri::command]
pub async fn delete_note(id: String) -> Result<(), String> {
    ensure_initialized();
    let mut store = get_notes_store();
    let map = store.as_mut().unwrap();
    
    map.remove(&id);
    println!("Deleted note: {}", id);
    
    Ok(())
}
