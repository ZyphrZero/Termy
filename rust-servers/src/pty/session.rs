// PTY 会话管理

use portable_pty::{native_pty_system, Child, MasterPty, PtySize};
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};

/// PTY 会话
pub struct PtySession {
    master: Box<dyn MasterPty + Send>,
    child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
}

/// PTY 读取器 (独立，无需锁)
pub struct PtyReader {
    reader: Box<dyn Read + Send>,
}

/// PTY 写入器 (独立，无需锁)
pub struct PtyWriter {
    writer: Box<dyn Write + Send>,
}

impl PtySession {
    /// 创建新的 PTY 会话，返回 (session, reader, writer)
    /// 
    /// # 参数
    /// - `cols`: 终端列数
    /// - `rows`: 终端行数
    /// - `shell_type`: 可选的 shell 类型 (cmd, powershell, wsl, bash, zsh, custom:/path)
    /// - `shell_args`: 可选的 shell 启动参数
    /// - `cwd`: 可选的工作目录
    /// - `env`: 可选的环境变量
    pub fn new(
        cols: u16, 
        rows: u16, 
        shell_type: Option<&str>,
        shell_args: Option<&[String]>,
        cwd: Option<&str>,
        env: Option<&std::collections::HashMap<String, String>>
    ) -> Result<(Self, PtyReader, PtyWriter), Box<dyn std::error::Error>> {
        // 获取 PTY 系统
        let pty_system = native_pty_system();
        
        // 创建 PTY 对
        let pair = pty_system.openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        
        // 根据 shell 类型获取命令
        let mut cmd = super::shell::get_shell_by_type(shell_type);
        
        // 添加启动参数
        if let Some(args) = shell_args {
            for arg in args {
                cmd.arg(arg);
            }
        }
        
        // 设置工作目录
        if let Some(cwd_path) = cwd {
            cmd.cwd(cwd_path);
        }
        
        // 设置环境变量
        // 确保 TERM 环境变量存在，否则 clear/vim 等命令无法正常工作
        let term_value = env
            .and_then(|e| e.get("TERM").cloned())
            .or_else(|| std::env::var("TERM").ok())
            .unwrap_or_else(|| "xterm-256color".to_string());
        cmd.env("TERM", term_value);
        
        // 设置 UTF-8 locale 环境变量，确保非 ASCII 字符正确显示
        // 优先级: 用户提供的值 > 系统环境变量 > UTF-8 默认值
        let locale_vars = ["LANG", "LC_ALL", "LC_CTYPE"];
        for var in &locale_vars {
            let value = env
                .and_then(|e| e.get(*var).cloned())
                .or_else(|| std::env::var(*var).ok())
                .unwrap_or_else(|| {
                    // macOS/Linux 默认使用 en_US.UTF-8 以支持 UTF-8 编码
                    "en_US.UTF-8".to_string()
                });
            cmd.env(*var, value);
        }
        
        // 设置其他自定义环境变量
        if let Some(env_vars) = env {
            for (key, value) in env_vars {
                // 跳过已处理的环境变量
                if key != "TERM" && !locale_vars.contains(&key.as_str()) {
                    cmd.env(key, value);
                }
            }
        }
        
        // 标记这是 Obsidian Termy
        cmd.env("TERM_PROGRAM", "obsidian-termy");
        
        // 启动 shell 进程
        let child = pair.slave.spawn_command(cmd)?;
        
        // 获取读取器和写入器 (独立，无需锁)
        let reader = PtyReader {
            reader: pair.master.try_clone_reader()?,
        };
        let writer = PtyWriter {
            writer: pair.master.take_writer()?,
        };
        
        let session = Self {
            master: pair.master,
            child: Arc::new(Mutex::new(child)),
        };
        
        Ok((session, reader, writer))
    }

    /// 调整 PTY 尺寸
    pub fn resize(&mut self, cols: u16, rows: u16) -> Result<(), Box<dyn std::error::Error>> {
        self.master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        Ok(())
    }
    
    /// 终止子进程
    pub fn kill(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        if let Ok(mut child) = self.child.lock() {
            child.kill()?;
        }
        Ok(())
    }
}

impl PtyReader {
    /// 从 PTY 读取数据
    pub fn read(&mut self, buf: &mut [u8]) -> Result<usize, Box<dyn std::error::Error>> {
        let n = self.reader.read(buf)?;
        Ok(n)
    }
}

impl PtyWriter {
    /// 向 PTY 写入数据
    pub fn write(&mut self, data: &[u8]) -> Result<(), Box<dyn std::error::Error>> {
        self.writer.write_all(data)?;
        self.writer.flush()?;
        Ok(())
    }
}
