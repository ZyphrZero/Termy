// Shell detection and configuration

use portable_pty::CommandBuilder;
use std::env;
use std::path::Path;
use which::which;

/// Intelligently detect the system default shell
///
/// Detection priority:
/// 1. SHELL environment variable (user override)
/// 2. Platform-specific smart detection
/// 3. Safe fallback value
pub fn detect_default_shell() -> String {
    #[cfg(windows)]
    {
        detect_windows_shell()
    }

    #[cfg(not(windows))]
    {
        detect_unix_shell()
    }
}

#[cfg(windows)]
fn detect_windows_shell() -> String {
    // 1. Check the SHELL environment variable (user override, such as a Git Bash setup)
    if let Ok(shell) = env::var("SHELL") {
        return shell;
    }

    // 2. Prefer Windows PowerShell 5.x for broader compatibility
    //    PowerShell 5.x is built into Windows and is available on nearly all Windows systems
    if let Ok(path) = which("powershell") {
        return path.to_string_lossy().into_owned();
    }

    // 3. If PowerShell 5.x is unavailable, try PowerShell Core (pwsh)
    //    PowerShell 7+ requires a separate installation and is not present on all systems
    if let Ok(path) = which("pwsh") {
        return path.to_string_lossy().into_owned();
    }

    // 4. Use the COMSPEC environment variable, which is usually cmd.exe
    if let Ok(shell) = env::var("COMSPEC") {
        return shell;
    }

    // 5. Fall back to cmd.exe as a last resort
    "cmd.exe".to_string()
}

#[cfg(not(windows))]
fn detect_unix_shell() -> String {
    // 1. Prefer the SHELL environment variable
    if let Ok(shell) = env::var("SHELL") {
        return shell;
    }

    // 2. Check common shells in order of popularity
    let shell_candidates = [
        "/bin/zsh",  // macOS default
        "/bin/bash", // Common Linux default
        "/bin/fish", // Modern shell
        "/bin/sh",   // POSIX standard
    ];

    for shell in shell_candidates {
        if Path::new(shell).exists() {
            return shell.to_string();
        }
    }

    // 3. Fall back as a last resort
    "/bin/sh".to_string()
}

/// Get the shell command for a shell type
pub fn get_shell_by_type(shell_type: Option<&str>) -> CommandBuilder {
    match shell_type {
        Some("cmd") => CommandBuilder::new("cmd.exe"),
        Some("powershell") => {
            #[cfg(windows)]
            {
                // Explicitly use Windows PowerShell 5.x instead of pwsh
                if let Ok(path) = which("powershell") {
                    eprintln!("[INFO] [Shell] 使用 PowerShell 5.x: {}", path.display());
                    CommandBuilder::new(path.to_string_lossy().into_owned())
                } else {
                    eprintln!("[WARN] [Shell] PowerShell 未在 PATH 中找到，使用默认路径");
                    CommandBuilder::new("powershell.exe")
                }
            }
            #[cfg(not(windows))]
            {
                // On non-Windows platforms, use the default shell
                get_default_shell()
            }
        }
        Some("pwsh") => {
            #[cfg(windows)]
            {
                // Explicitly use PowerShell Core (pwsh)
                if let Ok(path) = which("pwsh") {
                    eprintln!("[INFO] [Shell] 使用 PowerShell 7: {}", path.display());
                    CommandBuilder::new(path.to_string_lossy().into_owned())
                } else {
                    eprintln!("[WARN] [Shell] PowerShell 7 未安装，降级到 PowerShell 5.x");
                    // Fall back to Windows PowerShell
                    if let Ok(path) = which("powershell") {
                        eprintln!("[INFO] [Shell] 使用 PowerShell 5.x: {}", path.display());
                        CommandBuilder::new(path.to_string_lossy().into_owned())
                    } else {
                        eprintln!("[WARN] [Shell] PowerShell 未在 PATH 中找到，使用默认路径");
                        CommandBuilder::new("powershell.exe")
                    }
                }
            }
            #[cfg(not(windows))]
            {
                CommandBuilder::new("pwsh")
            }
        }
        Some("wsl") => CommandBuilder::new("wsl.exe"),
        Some("gitbash") => {
            #[cfg(windows)]
            {
                // Git Bash: prefer resolving it from PATH, then fall back to common install paths
                if let Some(bash_path) = detect_gitbash() {
                    let mut cmd = CommandBuilder::new(bash_path);
                    // Add --login so the user's shell configuration is loaded
                    cmd.arg("--login");
                    cmd
                } else {
                    // Fall back to the default shell
                    get_default_shell()
                }
            }
            #[cfg(not(windows))]
            {
                // On non-Windows platforms, use bash
                CommandBuilder::new("bash")
            }
        }
        Some("bash") => CommandBuilder::new("bash"),
        Some("zsh") => CommandBuilder::new("zsh"),
        Some("tmux") => command_from_path_or_candidates(
            "tmux",
            &[
                "/opt/homebrew/bin/tmux",
                "/usr/local/bin/tmux",
                "/usr/bin/tmux",
                "/bin/tmux",
                "C:\\msys64\\usr\\bin\\tmux.exe",
                "C:\\Program Files\\Git\\usr\\bin\\tmux.exe",
            ],
        ),
        Some("kitty") => command_from_path_or_candidates(
            "kitty",
            &[
                "/Applications/kitty.app/Contents/MacOS/kitty",
                "/opt/homebrew/bin/kitty",
                "/usr/local/bin/kitty",
                "/usr/bin/kitty",
                "C:\\Program Files\\kitty\\kitty.exe",
            ],
        ),
        Some("ghostty") => command_from_path_or_candidates(
            "ghostty",
            &[
                "/Applications/Ghostty.app/Contents/MacOS/ghostty",
                "/opt/homebrew/bin/ghostty",
                "/usr/local/bin/ghostty",
                "/usr/bin/ghostty",
                "C:\\Program Files\\Ghostty\\bin\\ghostty.exe",
                "C:\\Program Files\\Ghostty\\ghostty.exe",
            ],
        ),
        Some(custom) if custom.starts_with("custom:") => {
            // Custom shell path in the format "custom:/path/to/shell"
            let path = &custom[7..]; // Remove the "custom:" prefix
            CommandBuilder::new(path)
        }
        _ => get_default_shell(), // None or an unknown type uses the default
    }
}

/// Get the default shell command
pub fn get_default_shell() -> CommandBuilder {
    CommandBuilder::new(detect_default_shell())
}

fn command_from_path_or_candidates(command: &str, candidates: &[&str]) -> CommandBuilder {
    if let Ok(path) = which(command) {
        return CommandBuilder::new(path.to_string_lossy().into_owned());
    }

    for candidate in candidates {
        if Path::new(candidate).exists() {
            return CommandBuilder::new(*candidate);
        }
    }

    CommandBuilder::new(command)
}

#[cfg(windows)]
fn detect_gitbash() -> Option<String> {
    // 1. Check standard Git Bash install paths first
    //    This avoids mistakenly detecting WSL bash, which is usually under WindowsApps
    let userprofile = env::var("USERPROFILE").unwrap_or_default();
    let gitbash_paths = vec![
        "C:\\Program Files\\Git\\bin\\bash.exe".to_string(),
        "C:\\Program Files (x86)\\Git\\bin\\bash.exe".to_string(),
        format!("{}\\AppData\\Local\\Programs\\Git\\bin\\bash.exe", userprofile),
    ];

    for path in gitbash_paths {
        if Path::new(&path).exists() {
            return Some(path);
        }
    }

    // 2. Fall back to finding bash in PATH
    //    but exclude WSL bash, which is usually under WindowsApps
    if let Ok(path) = which("bash.exe").or_else(|_| which("bash")) {
        let path_str = path.to_string_lossy();
        // Exclude WSL bash
        if !path_str.contains("WindowsApps") {
            return Some(path_str.into_owned());
        }
    }

    None
}

/// Get shell startup arguments for login-shell behavior
#[allow(dead_code)]
pub fn get_shell_login_args(shell_path: &str) -> Vec<String> {
    let shell_name = Path::new(shell_path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(shell_path)
        .to_lowercase();

    match shell_name.as_str() {
        "bash" | "zsh" | "fish" | "sh" => vec!["-l".to_string()],
        "pwsh" | "pwsh.exe" | "powershell" | "powershell.exe" => {
            vec!["-NoLogo".to_string()]
        }
        "cmd" | "cmd.exe" => vec![],
        _ => vec![],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_default_shell() {
        // Only verify that the function returns successfully without checking the exact result
        // because CommandBuilder does not provide a public API to read back the program path
        let _shell = get_default_shell();
        // Reaching this point means the function worked
    }

    #[test]
    fn test_detect_default_shell() {
        let shell = detect_default_shell();
        assert!(!shell.is_empty());
    }

    #[test]
    fn test_get_shell_login_args() {
        let bash_args = get_shell_login_args("/bin/bash");
        assert_eq!(bash_args, vec!["-l".to_string()]);

        let pwsh_args = get_shell_login_args("pwsh.exe");
        assert_eq!(pwsh_args, vec!["-NoLogo".to_string()]);

        let cmd_args = get_shell_login_args("cmd.exe");
        assert!(cmd_args.is_empty());
    }
    
    #[test]
    fn test_get_shell_by_type_cmd() {
        let _cmd = get_shell_by_type(Some("cmd"));
        // Verify that it does not panic
    }
    
    #[test]
    fn test_get_shell_by_type_powershell() {
        let _cmd = get_shell_by_type(Some("powershell"));
        // Verify that it does not panic
    }
    
    #[test]
    fn test_get_shell_by_type_bash() {
        let _cmd = get_shell_by_type(Some("bash"));
        // Verify that it does not panic
    }
    
    #[test]
    fn test_get_shell_by_type_zsh() {
        let _cmd = get_shell_by_type(Some("zsh"));
        // Verify that it does not panic
    }

    #[test]
    fn test_get_shell_by_type_tmux() {
        let _cmd = get_shell_by_type(Some("tmux"));
        // Verify that it does not panic
    }

    #[test]
    fn test_get_shell_by_type_kitty() {
        let _cmd = get_shell_by_type(Some("kitty"));
        // Verify that it does not panic
    }

    #[test]
    fn test_get_shell_by_type_ghostty() {
        let _cmd = get_shell_by_type(Some("ghostty"));
        // Verify that it does not panic
    }
    
    #[test]
    fn test_get_shell_by_type_custom() {
        let _cmd = get_shell_by_type(Some("custom:/bin/sh"));
        // Verify that it does not panic
    }
    
    #[test]
    fn test_get_shell_by_type_none() {
        let _cmd = get_shell_by_type(None);
        // Verify that it does not panic
    }
    
    #[test]
    fn test_get_shell_by_type_unknown() {
        let _cmd = get_shell_by_type(Some("unknown_shell"));
        // An unknown type should return the default shell
    }
}
