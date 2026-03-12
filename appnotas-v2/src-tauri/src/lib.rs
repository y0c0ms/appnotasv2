mod commands;

use std::str::FromStr;
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Manager,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

struct AppShortcutConfig {
    main: Mutex<Shortcut>,
    overlay: Mutex<Shortcut>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .plugin(tauri_plugin_pty::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        let config = app.state::<AppShortcutConfig>();

                        if *shortcut == *config.main.lock().unwrap() {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.unminimize();
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        } else if *shortcut == *config.overlay.lock().unwrap() {
                            toggle_todo_window(app);
                        }
                    }
                })
                .build(),
        )
        .setup(|app| {
            // --- System Tray Setup ---
            let open_i = MenuItem::with_id(app, "open", "Open", true, None::<&str>)?;
            let todo_i = MenuItem::with_id(app, "todo", "Toggle To-Do", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_i, &todo_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "todo" => {
                        toggle_todo_window(app);
                    }
                    "quit" => {
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
            // Main App: Ctrl + Shift + Space
            let main_shortcut =
                Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space);
            app.global_shortcut().register(main_shortcut)?;

            // ToDo Overlay: Ctrl + Shift + L
            let todo_shortcut =
                Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyL);
            app.global_shortcut().register(todo_shortcut)?;

            // Store in state
            app.manage(AppShortcutConfig {
                main: Mutex::new(main_shortcut),
                overlay: Mutex::new(todo_shortcut),
            });

            // --- Window Focus Sync ---
            // Hide overlay when main window is focused
            if let Some(main) = app.get_webview_window("main") {
                let app_handle = app.app_handle().clone();
                main.on_window_event(move |event| {
                    if let tauri::WindowEvent::Focused(true) = event {
                        if let Some(todo) = app_handle.get_webview_window("todo") {
                            let _ = todo.hide();
                        }
                    }
                });
            }

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
            commands::files::get_file_mtime,
            commands::files::get_config_path,
            update_shortcuts,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn toggle_todo_window(app: &tauri::AppHandle) {
    let main_window = app.get_webview_window("main");
    if let Some(window) = app.get_webview_window("todo") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
            // Restore main if it was minimized? No, user wants overlay closed and main opened specifically via icon/event.
            // But if we toggle OFF, maybe we stay in current state.
        } else {
            // Minimize main when showing overlay
            if let Some(main) = main_window {
                let _ = main.minimize();
            }
            let _ = window.show();
            let _ = window.set_focus();
        }
    } else {
        // Create the window if it doesn't exist
        let monitor = app.primary_monitor().ok().flatten();
        let (width, height) = (350.0, 500.0);

        // Minimize main when creating overlay
        if let Some(main) = main_window {
            let _ = main.minimize();
        }

        let mut builder = tauri::webview::WebviewWindowBuilder::new(
            app,
            "todo",
            tauri::WebviewUrl::App("todo".into()),
        )
        .title("Mini AppNotas")
        .inner_size(width, height)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false);

        #[cfg(target_os = "windows")]
        {
            // Position in bottom right
            if let Some(m) = monitor {
                let screen_size = m.size();
                let scale_factor = m.scale_factor();
                let x = (screen_size.width as f64 / scale_factor) - width - 20.0;
                let y = (screen_size.height as f64 / scale_factor) - height - 60.0; // Above taskbar
                builder = builder.position(x, y);
            }
        }

        if let Ok(window) = builder.build() {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

#[tauri::command]
fn update_shortcuts(app: tauri::AppHandle, overlay: String, main: String) -> Result<(), String> {
    println!(
        "⌨️ Updating global shortcuts: Overlay={}, Main={}",
        overlay, main
    );

    let overlay_sc = parse_shortcut_str(&overlay).ok_or("Invalid overlay shortcut format")?;
    let main_sc = parse_shortcut_str(&main).ok_or("Invalid main shortcut format")?;

    // 1. Unregister all existing
    let _ = app.global_shortcut().unregister_all();

    // 2. Register new ones
    app.global_shortcut()
        .register(overlay_sc)
        .map_err(|e| e.to_string())?;
    app.global_shortcut()
        .register(main_sc)
        .map_err(|e| e.to_string())?;

    // 3. Update state
    let config = app.state::<AppShortcutConfig>();
    *config.overlay.lock().unwrap() = overlay_sc;
    *config.main.lock().unwrap() = main_sc;

    Ok(())
}

fn parse_shortcut_str(s: &str) -> Option<Shortcut> {
    let parts: Vec<&str> = s.split('+').collect();
    let mut mods = Modifiers::empty();
    let mut code = None;

    for part in parts {
        match part {
            "Ctrl" | "Control" => mods |= Modifiers::CONTROL,
            "Shift" => mods |= Modifiers::SHIFT,
            "Alt" => mods |= Modifiers::ALT,
            "Meta" | "Cmd" | "Super" => mods |= Modifiers::SUPER,
            key => {
                code = match key {
                    "Space" => Some(Code::Space),
                    "Enter" => Some(Code::Enter),
                    "Escape" => Some(Code::Escape),
                    "Tab" => Some(Code::Tab),
                    "Backspace" => Some(Code::Backspace),
                    "Delete" => Some(Code::Delete),
                    "ArrowUp" => Some(Code::ArrowUp),
                    "ArrowDown" => Some(Code::ArrowDown),
                    "ArrowLeft" => Some(Code::ArrowLeft),
                    "ArrowRight" => Some(Code::ArrowRight),
                    k if k.len() == 1 => {
                        let c = k.chars().next().unwrap().to_ascii_uppercase();
                        if c.is_ascii_alphabetic() {
                            Code::from_str(&format!("Key{}", c)).ok()
                        } else if c.is_ascii_digit() {
                            Code::from_str(&format!("Digit{}", c)).ok()
                        } else {
                            None
                        }
                    }
                    _ => None,
                }
            }
        }
    }

    code.map(|c| Shortcut::new(Some(mods), c))
}
