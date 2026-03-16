mod commands;

use std::str::FromStr;
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Manager, WebviewWindowBuilder,
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
                            show_main_window(app);
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
                .icon(app.default_window_icon().cloned().unwrap_or_else(|| {
                    // Fallback or just skip icon if not found to prevent panic
                    println!("Warning: Default window icon not found, tray icon might be empty.");
                    app.default_window_icon().cloned().expect("Still failed to get icon") // Should probably have a better fallback
                }))
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        show_main_window(app);
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
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            // Main App: Ctrl + Shift + Space
            let main_shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space);
            if let Err(e) = app.global_shortcut().register(main_shortcut) {
                eprintln!("Failed to register main shortcut: {}", e);
            }

            // ToDo Overlay: Ctrl + Shift + L
            let todo_shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyL);
            if let Err(e) = app.global_shortcut().register(todo_shortcut) {
                eprintln!("Failed to register todo shortcut: {}", e);
            }

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

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(todo) = app.get_webview_window("todo") {
        let _ = todo.hide();
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.unminimize();
        let _ = main.show();
        let _ = main.set_focus();
    }
}

fn toggle_todo_window(app: &tauri::AppHandle) {
    let main_window = app.get_webview_window("main");
    if let Some(window) = app.get_webview_window("todo") {
        if window.is_visible().unwrap_or(false) {
            let _: Result<(), _> = window.hide();
        } else {
            // Hide main when showing overlay
            if let Some(main) = main_window {
                let _ = main.hide();
            }
            let _: Result<(), _> = window.show();
            let _: Result<(), _> = window.set_focus();
        }
    } else {
        // Create the window if it doesn't exist
        let monitor = app.primary_monitor().ok().flatten()
            .or_else(|| app.available_monitors().ok().and_then(|m| m.into_iter().next()));
        let (width, height) = (350.0, 500.0);

        // Hide main when creating overlay
        if let Some(main) = main_window {
            let _ = main.hide();
        }

        let mut builder = WebviewWindowBuilder::new(
            app,
            "todo",
            tauri::WebviewUrl::App("todo".into()),
        )
        .title("Mini AppNotas")
        .inner_size(width, height)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false);

        #[cfg(not(target_os = "macos"))]
        {
            builder = builder.transparent(true);
        }

        #[cfg(not(target_os = "macos"))]
        {
            // Position in bottom right for Windows and Linux
            if let Some(ref m) = monitor {
                let screen_size = m.size();
                let screen_pos = m.position();
                let scale_factor = m.scale_factor();
                
                let logical_width = screen_size.width as f64 / scale_factor;
                let logical_height = screen_size.height as f64 / scale_factor;
                let logical_x = screen_pos.x as f64 / scale_factor;
                let logical_y = screen_pos.y as f64 / scale_factor;
                
                let x = logical_x + logical_width - width - 20.0;
                let y = logical_y + logical_height - height - 60.0; // Above taskbar
                println!("🖥️ Monitor found! Position: ({}, {})", x, y);
                builder = builder.position(x, y);
            } else {
                println!("⚠️ No primary monitor found!");
            }
        }

        if let Ok(window) = builder.build() {
            println!("✅ Overlay window built successfully!");

            // Explicitly set position again after build for Linux/Wayland consistency
            #[cfg(not(target_os = "macos"))]
            if let Some(ref m) = monitor {
                let screen_size = m.size();
                let screen_pos = m.position();
                let scale_factor = m.scale_factor();
                println!("🖥️ Screen size: {:?}, Pos: {:?}, Scale: {}", screen_size, screen_pos, scale_factor);
                
                let logical_width = screen_size.width as f64 / scale_factor;
                let logical_height = screen_size.height as f64 / scale_factor;
                let logical_x = screen_pos.x as f64 / scale_factor;
                let logical_y = screen_pos.y as f64 / scale_factor;
                
                let x = logical_x + logical_width - width - 20.0;
                let y = logical_y + logical_height - height - 60.0;
                
                let window_clone = window.clone();
                // Capture owned values to avoid lifetime issues in async block
                let width_val = width;
                let height_val = height;
                let screen_width = screen_size.width;
                let screen_height = screen_size.height;
                let screen_px = screen_pos.x;
                let screen_py = screen_pos.y;

                tauri::async_runtime::spawn(async move {
                    // Longer delay to ensure the window is fully managed by the compositor
                    tokio::time::sleep(std::time::Duration::from_millis(1000)).await;
                    println!("🚀 (1s Delayed) Moving to Logical({}, {})", x, y);
                    let _ = window_clone.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(x, y)));
                    
                    // Also try physical just in case logical is failing due to scale issues
                    let px = (screen_px as f64) + (screen_width as f64) - (width_val * scale_factor) - (20.0 * scale_factor);
                    let py = (screen_py as f64) + (screen_height as f64) - (height_val * scale_factor) - (60.0 * scale_factor);
                    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                    println!("🚀 (Extra Delay) Moving to Physical({}, {})", px, py);
                    let _ = window_clone.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(px as i32, py as i32)));
                });
            }

            let _: Result<(), _> = window.show();
            let _: Result<(), _> = window.set_focus();
        } else {
            println!("❌ Failed to build overlay window!");
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
    let _ = app.global_shortcut().register(overlay_sc);
    let _ = app.global_shortcut().register(main_sc);

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
