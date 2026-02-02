mod commands;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Manager,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        println!("Global Shortcut Triggered: {:?}", shortcut);
                        if let Some(window) = app.get_webview_window("main") {
                            println!("Found window 'main', focusing...");
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        } else {
                            println!("ERROR: Could not find window 'main'");
                        }
                    }
                })
                .build(),
        )
        .setup(|app| {
            // --- System Tray Setup ---
            let open_i = MenuItem::with_id(app, "open", "Open", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        println!("Tray Item 'Open' Clicked");
                        if let Some(window) = app.get_webview_window("main") {
                            println!("Showing 'main' window");
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        } else {
                            println!("ERROR: Window 'main' not found via Tray");
                        }
                    }
                    "quit" => {
                        println!("Tray Item 'Quit' Clicked");
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        ..
                    } = event
                    {
                        println!("Tray Icon Left Clicked");
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            // --- Global Shortcut Setup ---
            // Register: Ctrl + Shift + Space
            let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space);
            app.global_shortcut().register(shortcut)?;
            println!("Global Shortcut registered: Ctrl+Shift+Space");

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // File-based notes commands
            commands::notes::list_notes_files,
            commands::notes::create_note_file,
            commands::notes::save_note_to_file,
            commands::notes::delete_note_file,
            // File operations
            commands::files::read_file,
            commands::files::write_file,
            commands::files::list_directory,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
