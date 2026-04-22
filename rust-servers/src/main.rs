// Terminal Server Main Program
// Standalone terminal server that provides PTY functionality

mod server;
mod router;
mod context_snapshot;
mod mcp_stdio_server;

// Feature modules
pub mod pty;

use context_snapshot::SnapshotStore;
use mcp_stdio_server::McpStdioServer;
use server::{Server, ServerConfig};
use std::env;

const SERVER_VERSION: &str = match option_env!("TERMINAL_SERVER_VERSION") {
    Some(version) => version,
    None => env!("CARGO_PKG_VERSION"),
};

/// Logging macro
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

enum RunMode {
    Pty {
        port: u16,
    },
    Mcp {
        snapshot_file: String,
    },
}

/// Parse command-line arguments
fn parse_args() -> Result<RunMode, String> {
    let args: Vec<String> = env::args().collect();
    let mut port: u16 = 0;
    let mut mcp_mode = false;
    let mut snapshot_file: Option<String> = None;
    
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--mcp" => {
                mcp_mode = true;
            }
            "--snapshot-file" => {
                if i + 1 >= args.len() {
                    return Err("Missing value for --snapshot-file".to_string());
                }
                snapshot_file = Some(args[i + 1].clone());
                i += 1;
            }
            arg if arg.starts_with("--snapshot-file=") => {
                snapshot_file = Some(arg.trim_start_matches("--snapshot-file=").to_string());
            }
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
                eprintln!("  -p, --port <PORT>         监听端口 (0 表示随机端口) [默认: 0]");
                eprintln!("      --mcp                 以 Codex/Claude 可消费的 stdio MCP server 模式启动");
                eprintln!("      --snapshot-file PATH  MCP 模式下读取的 IDE 上下文快照文件");
                eprintln!("  -h, --help                显示帮助信息");
                eprintln!("  -V, --version             显示版本信息");
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
    
    if mcp_mode {
        let snapshot_file = snapshot_file
            .or_else(|| env::var("CODEX_IDE_CONTEXT_PATH").ok())
            .ok_or_else(|| {
                "MCP mode requires --snapshot-file <PATH> or CODEX_IDE_CONTEXT_PATH".to_string()
            })?;

        Ok(RunMode::Mcp { snapshot_file })
    } else {
        Ok(RunMode::Pty { port })
    }
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Parse command-line arguments
    match parse_args().map_err(|message| std::io::Error::new(std::io::ErrorKind::InvalidInput, message))? {
        RunMode::Mcp { snapshot_file } => {
            log_debug!("启动 MCP 模式: snapshot_file={}", snapshot_file);
            let snapshot_store = SnapshotStore::new(snapshot_file);
            let server = McpStdioServer::new(snapshot_store, "termy/obsidian-context-mcp", SERVER_VERSION);
            server.run()?;
        }
        RunMode::Pty { port } => {
            log_debug!("启动参数: port={}", port);

            // Create the server configuration
            let config = ServerConfig { port };

            // Create and start the server
            let server = Server::new(config);
            let port = server.start().await?;

            // Keep the main thread running
            log_info!("Terminal Server 已启动，监听端口: {}", port);
            
            // Wait for the Ctrl+C signal
            tokio::signal::ctrl_c().await?;
            log_info!("收到退出信号，正在关闭服务器...");
        }
    }

    Ok(())
}
