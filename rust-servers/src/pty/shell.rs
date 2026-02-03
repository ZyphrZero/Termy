// Shell 检测和配置

use portable_pty::CommandBuilder;
use std::env;
use std::path::Path;
use which::which;

/// 智能检测系统默认 Shell
///
/// 检测优先级:
/// 1. SHELL 环境变量（用户覆盖）
/// 2. 平台特定的智能检测
/// 3. 安全的回退值
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
    // 1. 检查 SHELL 环境变量（用户覆盖，如 Git Bash 设置）
    if let Ok(shell) = env::var("SHELL") {
        return shell;
    }

    // 2. 优先使用 Windows PowerShell 5.x（更广泛的兼容性）
    //    PowerShell 5.x 是 Windows 内置的，几乎所有 Windows 系统都有
    if let Ok(path) = which("powershell") {
        return path.to_string_lossy().into_owned();
    }

    // 3. 如果 PowerShell 5.x 不可用，尝试 PowerShell Core (pwsh)
    //    PowerShell 7+ 需要单独安装，不是所有系统都有
    if let Ok(path) = which("pwsh") {
        return path.to_string_lossy().into_owned();
    }

    // 4. 使用 COMSPEC 环境变量（通常是 cmd.exe）
    if let Ok(shell) = env::var("COMSPEC") {
        return shell;
    }

    // 5. 最后回退到 cmd.exe
    "cmd.exe".to_string()
}

#[cfg(not(windows))]
fn detect_unix_shell() -> String {
    // 1. 优先使用 SHELL 环境变量
    if let Ok(shell) = env::var("SHELL") {
        return shell;
    }

    // 2. 检查常见 Shell（按流行度排序）
    let shell_candidates = [
        "/bin/zsh",  // macOS 默认
        "/bin/bash", // Linux 常见默认
        "/bin/fish", // 现代 Shell
        "/bin/sh",   // POSIX 标准
    ];

    for shell in shell_candidates {
        if Path::new(shell).exists() {
            return shell.to_string();
        }
    }

    // 3. 最后回退
    "/bin/sh".to_string()
}

/// 根据 shell 类型获取 Shell 命令
pub fn get_shell_by_type(shell_type: Option<&str>) -> CommandBuilder {
    match shell_type {
        Some("cmd") => CommandBuilder::new("cmd.exe"),
        Some("powershell") => {
            #[cfg(windows)]
            {
                // 明确使用 Windows PowerShell 5.x，不使用 pwsh
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
                // 非 Windows 平台，使用默认 shell
                get_default_shell()
            }
        }
        Some("pwsh") => {
            #[cfg(windows)]
            {
                // 明确使用 PowerShell Core (pwsh)
                if let Ok(path) = which("pwsh") {
                    eprintln!("[INFO] [Shell] 使用 PowerShell 7: {}", path.display());
                    CommandBuilder::new(path.to_string_lossy().into_owned())
                } else {
                    eprintln!("[WARN] [Shell] PowerShell 7 未安装，降级到 PowerShell 5.x");
                    // 回退到 Windows PowerShell
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
                // Git Bash: 优先通过 PATH 查找，回退到常见安装路径
                if let Some(bash_path) = detect_gitbash() {
                    let mut cmd = CommandBuilder::new(bash_path);
                    // 添加 --login 参数以加载用户配置
                    cmd.arg("--login");
                    cmd
                } else {
                    // 回退到默认 shell
                    get_default_shell()
                }
            }
            #[cfg(not(windows))]
            {
                // 非 Windows 平台，使用 bash
                CommandBuilder::new("bash")
            }
        }
        Some("bash") => CommandBuilder::new("bash"),
        Some("zsh") => CommandBuilder::new("zsh"),
        Some(custom) if custom.starts_with("custom:") => {
            // 自定义 shell 路径，格式: "custom:/path/to/shell"
            let path = &custom[7..]; // 移除 "custom:" 前缀
            CommandBuilder::new(path)
        }
        _ => get_default_shell(), // None 或未知类型，使用默认
    }
}

/// 获取默认 Shell 命令
pub fn get_default_shell() -> CommandBuilder {
    CommandBuilder::new(detect_default_shell())
}

#[cfg(windows)]
fn detect_gitbash() -> Option<String> {
    // 1. 优先检查 Git Bash 标准安装路径
    //    这样可以避免误检测到 WSL bash（WSL bash 通常在 WindowsApps 目录）
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

    // 2. 回退：通过 PATH 查找 bash
    //    但排除 WSL bash（通常在 WindowsApps 目录）
    if let Ok(path) = which("bash.exe").or_else(|_| which("bash")) {
        let path_str = path.to_string_lossy();
        // 排除 WSL bash
        if !path_str.contains("WindowsApps") {
            return Some(path_str.into_owned());
        }
    }

    None
}

/// 获取 Shell 启动参数（用于登录 Shell 行为）
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
        // 只测试函数能成功返回，不检查具体内容
        // 因为 CommandBuilder 没有提供公开 API 来获取程序路径
        let _shell = get_default_shell();
        // 如果能到达这里，函数工作正常
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
        // 测试不会 panic
    }
    
    #[test]
    fn test_get_shell_by_type_powershell() {
        let _cmd = get_shell_by_type(Some("powershell"));
        // 测试不会 panic
    }
    
    #[test]
    fn test_get_shell_by_type_bash() {
        let _cmd = get_shell_by_type(Some("bash"));
        // 测试不会 panic
    }
    
    #[test]
    fn test_get_shell_by_type_zsh() {
        let _cmd = get_shell_by_type(Some("zsh"));
        // 测试不会 panic
    }
    
    #[test]
    fn test_get_shell_by_type_custom() {
        let _cmd = get_shell_by_type(Some("custom:/bin/sh"));
        // 测试不会 panic
    }
    
    #[test]
    fn test_get_shell_by_type_none() {
        let _cmd = get_shell_by_type(None);
        // 测试不会 panic
    }
    
    #[test]
    fn test_get_shell_by_type_unknown() {
        let _cmd = get_shell_by_type(Some("unknown_shell"));
        // 未知类型应该返回默认 shell
    }
}
