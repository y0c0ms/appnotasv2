//! Filesystem watcher for the notes directory.
//!
//! The notes folder is shared with an external local MCP server (and OneDrive),
//! which can create/edit/delete the app's Markdown files directly. The app has
//! no other way to learn about those changes, so we watch the directory and
//! tell the webview to re-list when relevant files change.
//!
//! Design notes:
//! - Recursive watch on the notes root covers the flat `tasks/` subfolder too.
//! - Events are debounced (~400ms) and coalesced into one `notes-changed` emit.
//! - We ignore: anything under a dot-folder (incl. `.trash/`), dotfiles
//!   (covers the app's `.<name>.tmp-*` temp files), non-`.md` files, and
//!   OneDrive conflict copies (`<stem>-<HOSTNAME>.md`).
//! - To avoid a feedback loop, the app records its own writes in
//!   `recent_writes`; events for those paths are dropped for a short window.

use std::collections::HashMap;
use std::path::Path;
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use notify::{EventKind, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, Manager};

const DEBOUNCE_MS: u64 = 400;
const SELF_WRITE_TTL_MS: u128 = 1500;

#[derive(Default)]
pub struct WatcherState {
    watcher: Mutex<Option<notify::RecommendedWatcher>>,
    watched_dir: Mutex<Option<String>>,
    recent_writes: Mutex<HashMap<String, Instant>>,
}

fn normalize(p: &str) -> String {
    p.replace('/', "\\").to_lowercase()
}

impl WatcherState {
    /// Record that the app itself just wrote `path`, so the watcher ignores the
    /// resulting event (prevents a save → watch → reload feedback loop).
    pub fn mark_self_write(&self, path: &str) {
        if let Ok(mut m) = self.recent_writes.lock() {
            m.insert(normalize(path), Instant::now());
            m.retain(|_, t| t.elapsed().as_millis() < 5000); // prune
        }
    }

    fn was_self_write(&self, path_norm: &str) -> bool {
        self.recent_writes
            .lock()
            .ok()
            .and_then(|m| m.get(path_norm).map(|t| t.elapsed().as_millis() < SELF_WRITE_TTL_MS))
            .unwrap_or(false)
    }
}

fn hostname() -> String {
    std::env::var("COMPUTERNAME").unwrap_or_default().to_lowercase()
}

/// Whether a changed path is irrelevant for refresh purposes.
fn should_ignore(path: &Path, host: &str) -> bool {
    // Only Markdown notes matter.
    let is_md = path
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.eq_ignore_ascii_case("md"))
        .unwrap_or(false);
    if !is_md {
        return true;
    }

    // Any dot-prefixed component: `.trash/`, other dot-folders, and the app's
    // own `.<name>.tmp-*` temp files (the filename itself starts with '.').
    for comp in path.components() {
        if let Some(s) = comp.as_os_str().to_str() {
            if s.starts_with('.') {
                return true;
            }
        }
    }

    // OneDrive conflict copies look like "<original-stem>-<HOSTNAME>.md".
    if !host.is_empty() {
        if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
            if stem.to_lowercase().ends_with(&format!("-{host}")) {
                return true;
            }
        }
    }

    false
}

/// Start (or restart) watching `directory`. Idempotent for the same directory.
#[tauri::command]
pub fn start_notes_watcher(app: AppHandle, directory: String) -> Result<(), String> {
    let dir = directory.trim().to_string();
    if dir.is_empty() {
        return Ok(());
    }
    let root = Path::new(&dir);
    if !root.exists() {
        return Err(format!("Notes directory does not exist: {dir}"));
    }

    let state = app.state::<WatcherState>();

    // Already watching this exact directory? Nothing to do.
    if state.watched_dir.lock().unwrap().as_deref() == Some(dir.as_str())
        && state.watcher.lock().unwrap().is_some()
    {
        return Ok(());
    }

    let (tx, rx) = channel::<notify::Event>();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(event) = res {
            let _ = tx.send(event);
        }
    })
    .map_err(|e| format!("Failed to create watcher: {e}"))?;

    watcher
        .watch(root, RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to watch {dir}: {e}"))?;

    // Storing the new watcher drops the previous one; dropping it closes its
    // sender, so the previous debounce thread sees a disconnect and exits.
    *state.watcher.lock().unwrap() = Some(watcher);
    *state.watched_dir.lock().unwrap() = Some(dir.clone());

    let app_thread = app.clone();
    std::thread::spawn(move || {
        let host = hostname();
        let state = app_thread.state::<WatcherState>();
        loop {
            // Block until the first event; Err means our watcher was dropped.
            let first = match rx.recv() {
                Ok(ev) => ev,
                Err(_) => return,
            };
            let mut batch = vec![first];
            // Coalesce everything that arrives within the debounce window.
            loop {
                match rx.recv_timeout(Duration::from_millis(DEBOUNCE_MS)) {
                    Ok(ev) => batch.push(ev),
                    Err(RecvTimeoutError::Timeout) => break,
                    Err(RecvTimeoutError::Disconnected) => break,
                }
            }

            let mut changed: Vec<String> = Vec::new();
            for ev in &batch {
                if !matches!(
                    ev.kind,
                    EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_) | EventKind::Any
                ) {
                    continue;
                }
                for p in &ev.paths {
                    if should_ignore(p, &host) {
                        continue;
                    }
                    if state.was_self_write(&normalize(&p.to_string_lossy())) {
                        continue;
                    }
                    let s = p.to_string_lossy().to_string();
                    if !changed.contains(&s) {
                        changed.push(s);
                    }
                }
            }

            if !changed.is_empty() {
                let _ = app_thread.emit("notes-changed", changed);
            }
        }
    });

    Ok(())
}
