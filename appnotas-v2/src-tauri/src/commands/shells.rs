//! Cross-platform terminal-shell detection.
//!
//! Returns the shells actually available on the machine so the UI never offers
//! something that can't launch (e.g. WSL with no distro installed). Windows,
//! Linux, and macOS are all handled via `cfg` branches; the Windows branch is
//! the only one that touches the registry (gated dependency).

use serde::Serialize;
use std::path::Path;

#[derive(Debug, Serialize)]
pub struct ShellOption {
    pub id: String,
    pub name: String,
    pub command: String,
    pub available: bool,
}

/// Find an executable by name on `PATH`. On Windows, also tries common
/// executable extensions when the name has none.
fn find_on_path(names: &[&str]) -> Option<String> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        for name in names {
            let direct = dir.join(name);
            if direct.is_file() {
                return Some(direct.to_string_lossy().into_owned());
            }
            #[cfg(windows)]
            if !name.contains('.') {
                for ext in ["exe", "cmd", "bat"] {
                    let candidate = dir.join(format!("{name}.{ext}"));
                    if candidate.is_file() {
                        return Some(candidate.to_string_lossy().into_owned());
                    }
                }
            }
        }
    }
    None
}

fn first_existing(paths: &[String]) -> Option<String> {
    paths.iter().find(|p| Path::new(p).is_file()).cloned()
}

#[cfg(windows)]
fn wsl_has_distro() -> bool {
    // A real WSL distro registers a GUID subkey under Lxss. Checking the
    // registry avoids spawning the interactive "wsl.exe" Store stub, which
    // would otherwise prompt to install and could block.
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    match hkcu.open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Lxss") {
        Ok(lxss) => lxss.enum_keys().flatten().next().is_some(),
        Err(_) => false,
    }
}

#[cfg(windows)]
fn detect() -> Vec<ShellOption> {
    let mut shells = Vec::new();

    // PowerShell: prefer pwsh (PowerShell 7+), else Windows PowerShell.
    if let Some(cmd) = find_on_path(&["pwsh"]) {
        shells.push(ShellOption { id: "pwsh".into(), name: "PowerShell".into(), command: cmd, available: true });
    } else {
        let ps = find_on_path(&["powershell"]).unwrap_or_else(|| "powershell.exe".into());
        shells.push(ShellOption { id: "powershell".into(), name: "PowerShell".into(), command: ps, available: true });
    }

    // Command Prompt (honour %ComSpec%).
    let cmd_exe = std::env::var("ComSpec")
        .ok()
        .filter(|s| Path::new(s).is_file())
        .or_else(|| find_on_path(&["cmd"]))
        .unwrap_or_else(|| "cmd.exe".into());
    shells.push(ShellOption { id: "cmd".into(), name: "Command Prompt".into(), command: cmd_exe, available: true });

    // Git Bash: search system-wide AND per-user install roots, then PATH.
    let mut candidates = Vec::new();
    for env in ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)", "LOCALAPPDATA"] {
        if let Ok(base) = std::env::var(env) {
            candidates.push(format!("{base}\\Git\\bin\\bash.exe"));
            candidates.push(format!("{base}\\Programs\\Git\\bin\\bash.exe"));
        }
    }
    if let Some(cmd) = first_existing(&candidates).or_else(|| find_on_path(&["bash"])) {
        shells.push(ShellOption { id: "gitbash".into(), name: "Git Bash".into(), command: cmd, available: true });
    }

    // WSL: only if a distro is actually registered.
    if wsl_has_distro() {
        let wsl = find_on_path(&["wsl"]).unwrap_or_else(|| "wsl.exe".into());
        shells.push(ShellOption { id: "wsl".into(), name: "WSL".into(), command: wsl, available: true });
    }

    shells
}

#[cfg(not(windows))]
fn detect() -> Vec<ShellOption> {
    // Linux + macOS: probe the usual shells in standard locations and on PATH.
    let mut shells: Vec<ShellOption> = Vec::new();
    let known: &[(&str, &str)] = &[
        ("bash", "Bash"),
        ("zsh", "Zsh"),
        ("fish", "Fish"),
        ("sh", "sh"),
    ];
    let roots = ["/bin", "/usr/bin", "/usr/local/bin", "/opt/homebrew/bin"];
    for (id, name) in known {
        let abs: Vec<String> = roots.iter().map(|r| format!("{r}/{id}")).collect();
        if let Some(cmd) = first_existing(&abs).or_else(|| find_on_path(&[id])) {
            shells.push(ShellOption { id: (*id).into(), name: (*name).into(), command: cmd, available: true });
        }
    }

    // Surface the user's login shell ($SHELL) first if it isn't already listed.
    if let Ok(sh) = std::env::var("SHELL") {
        if Path::new(&sh).is_file() && !shells.iter().any(|s| s.command == sh) {
            let id = Path::new(&sh)
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("shell")
                .to_string();
            shells.insert(
                0,
                ShellOption { id: id.clone(), name: format!("Default ({id})"), command: sh, available: true },
            );
        }
    }

    shells
}

#[tauri::command]
pub fn detect_shells() -> Vec<ShellOption> {
    detect()
}
