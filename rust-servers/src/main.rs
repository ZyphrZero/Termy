// Terminal Server Main Program
// 独立的终端服务器，提供 PTY 功能

mod server;
mod router;

// 功能模块
pub mod pty;

use server::{Server, ServerConfig};
use std::env;

const SERVER_VERSION: &str = match option_env!("TERMINAL_SERVER_VERSION") {
    Some(version) => version,
    None => env!("CARGO_PKG_VERSION"),
};

/// 日志宏
macro_rules! log_info {
    ($($arg:tt)*) => {
        eprintln!("[INFO] {}", format!($($arg)*));
    };
}

macro_rules! log_debug {
    ($($arg:tt)*) => {
        if cfg!(debug_assertions) {
            eprintln!("[DEBUG] {}", format!($($arg)*));
        }
    };
}

/// 解析命令行参数
fn parse_args() -> u16 {
    let args: Vec<String> = env::args().collect();
    let mut port: u16 = 0;
    
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "-p" | "--port" => {
                if i + 1 < args.len() {
                    port = args[i + 1].parse().unwrap_or(0);
                    i += 1;
                }
            }
            arg if arg.starts_with("--port=") => {
                port = arg.trim_start_matches("--port=").parse().unwrap_or(0);
            }
            "-h" | "--help" => {
                eprintln!("Usage: termy-server [OPTIONS]");
                eprintln!("Options:");
                eprintln!("  -p, --port <PORT>  监听端口 (0 表示随机端口) [默认: 0]");
                eprintln!("  -h, --help         显示帮助信息");
                eprintln!("  -V, --version      显示版本信息");
                std::process::exit(0);
            }
            "-V" | "--version" => {
                println!("{}", SERVER_VERSION);
                std::process::exit(0);
            }
            _ => {}
        }
        i += 1;
    }
    
    port
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // 解析命令行参数
    let port = parse_args();

    log_debug!("启动参数: port={}", port);

    // 创建服务器配置
    let config = ServerConfig { port };

    // 创建并启动服务器
    let server = Server::new(config);
    let port = server.start().await?;

    // 保持主线程运行
    log_info!("Terminal Server 已启动，监听端口: {}", port);
    
    // 等待 Ctrl+C 信号
    tokio::signal::ctrl_c().await?;
    log_info!("收到退出信号，正在关闭服务器...");

    Ok(())
}
