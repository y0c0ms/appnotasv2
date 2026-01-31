mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            // File-based notes commands
            commands::notes::get_notes_directory,
            commands::notes::set_notes_directory,
            commands::notes::list_notes_files,
            commands::notes::create_note_file,
            commands::notes::save_note_to_file,
            commands::notes::delete_note_file,
            // Old in-memory notes (backward compat)
            commands::notes::list_notes,
            commands::notes::save_note,
            commands::notes::delete_note,
            // File operations
            commands::files::read_file,
            commands::files::write_file,
            commands::files::list_directory,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
