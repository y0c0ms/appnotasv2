use std::path::Path;
use serde::{Serialize, Deserialize};
use tauri::command;

#[derive(Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: Option<u64>,
    pub modified: Option<String>,
}

#[command]
pub async fn list_directory(path: String) -> Result<Vec<FileEntry>, String> {
    let dir_path = Path::new(&path);
    
    if !dir_path.exists() {
        return Err("Path does not exist".to_string());
    }
    
    if !dir_path.is_dir() {
        return Err("Path is not a directory".to_string());
    }
    
    let mut entries = Vec::new();
    
    // Add parent directory entry
    if let Some(parent) = dir_path.parent() {
        entries.push(FileEntry {
            name: "..".to_string(),
            path: parent.to_string_lossy().to_string(),
            is_dir: true,
            size: None,
            modified: None,
        });
    }
    
    // Read directory entries
    for entry in std::fs::read_dir(dir_path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let metadata = entry.metadata().ok();
        
        entries.push(FileEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: entry.path().to_string_lossy().to_string(),
            is_dir: metadata.as_ref().map(|m| m.is_dir()).unwrap_or(false),
            size: metadata.as_ref().and_then(|m| {
                if m.is_file() { Some(m.len()) } else { None }
            }),
            modified: metadata.and_then(|m| 
                m.modified()
                    .ok()
                    .and_then(|t| {
                        let duration = t.duration_since(std::time::UNIX_EPOCH).ok()?;
                        Some(duration.as_secs().to_string())
                    })
            ),
        });
    }
    
    // Sort: directories first, then alphabetically
    entries.sort_by(|a, b| {
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });
    
    Ok(entries)
}

#[command]
pub async fn autocomplete_path(partial: String, cwd: String) -> Result<Vec<String>, String> {
    let base_path = Path::new(&cwd);
    
    if !base_path.exists() || !base_path.is_dir() {
        return Ok(vec![]);
    }
    
    let search_term = partial.to_lowercase();
    
    let mut matches: Vec<String> = std::fs::read_dir(base_path)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.to_lowercase().starts_with(&search_term) {
                Some(name)
            } else {
                None
            }
        })
        .collect();
    
    matches.sort();
    Ok(matches)
}

#[command]
pub async fn open_file_external(path: String) -> Result<(), String> {
    let file_path = Path::new(&path);
    
    if !file_path.exists() {
        return Err("File does not exist".to_string());
    }
    
    // Open with system default application
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(&["/C", "start", "", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    
    Ok(())
}
