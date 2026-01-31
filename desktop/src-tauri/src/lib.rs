mod db;
mod gemini;
mod fs_browser;

use db::{Db, Note};
use gemini::Gemini;
use std::sync::Mutex;
use tauri::{State, Manager};

pub struct AppState {
    pub db: Mutex<Db>,
    pub gemini: Gemini,
}

#[tauri::command]
fn list_notes(state: State<'_, AppState>) -> Result<Vec<Note>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.list_notes().map_err(|e| e.to_string())
}

#[tauri::command]
fn save_note(state: State<'_, AppState>, note: Note) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.save_note(&note).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_note(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.delete_note(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_api_key(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_setting("gemini_api_key").map_err(|e| e.to_string())
}

#[tauri::command]
fn set_api_key(state: State<'_, AppState>, key: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.set_setting("gemini_api_key", &key).map_err(|e| e.to_string())
}

#[tauri::command]
async fn improve_note(state: State<'_, AppState>, content: String) -> Result<String, String> {
    let key = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.get_setting("gemini_api_key").ok().flatten()
    };
    state.gemini.improve_note(&content, key).await.map_err(|e| e.to_string())
}

#[tauri::command]
fn drag_window(window: tauri::Window) -> Result<(), String> {
    window.start_dragging().map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle();
            let db = Db::init(handle).expect("Failed to initialize database");
            let gemini = Gemini::new();
            
            app.manage(AppState { 
                db: Mutex::new(db), 
                gemini 
            });

            let window = app.get_webview_window("main").unwrap();
            
            #[cfg(target_os = "windows")]
            {
                use window_vibrancy::*;
                apply_blur(&window, Some((0, 0, 0, 0)))
                    .expect("Unsupported platform! 'apply_blur' is only supported on Windows 7, 8.1 and 10+");
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_notes,
            save_note,
            delete_note,
            improve_note,
            get_api_key,
            set_api_key,
            drag_window,
            fs_browser::list_directory,
            fs_browser::autocomplete_path,
            fs_browser::open_file_external
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
