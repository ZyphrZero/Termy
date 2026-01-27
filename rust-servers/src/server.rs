// WebSocket 服务器实现
// 终端服务器的 WebSocket 服务器，处理 PTY 模块的消息

use tokio::net::TcpListener;
use tokio_tungstenite::{accept_async, tungstenite::Message};
use futures_util::{StreamExt, SinkExt};
use std::sync::Arc;
use tokio::sync::Mutex as TokioMutex;

use crate::router::{MessageRouter, ModuleType, RouterError, ServerResponse};

/// 日志宏
macro_rules! log_info {
    ($($arg:tt)*) => {
        eprintln!("[INFO] {}", format!($($arg)*));
    };
}

macro_rules! log_error {
    ($($arg:tt)*) => {
        eprintln!("[ERROR] {}", format!($($arg)*));
    };
}

macro_rules! log_debug {
    ($($arg:tt)*) => {
        if cfg!(debug_assertions) {
            eprintln!("[DEBUG] {}", format!($($arg)*));
        }
    };
}

// ============================================================================
// 服务器配置和实现
// ============================================================================

/// WebSocket 服务器配置
pub struct ServerConfig {
    pub port: u16,
}

/// WebSocket 服务器
pub struct Server {
    config: ServerConfig,
}

impl Server {
    pub fn new(config: ServerConfig) -> Self {
        Self { config }
    }

    /// 启动服务器
    pub async fn start(&self) -> Result<u16, Box<dyn std::error::Error>> {
        let addr = format!("127.0.0.1:{}", self.config.port);
        let listener = TcpListener::bind(&addr).await?;
        let local_addr = listener.local_addr()?;
        let port = local_addr.port();

        log_info!("服务器绑定到 {}", local_addr);

        // 输出端口信息到 stdout (JSON 格式)
        // TypeScript 端会解析这个 JSON 来获取端口号
        println!(
            r#"{{"port": {}, "pid": {}}}"#,
            port,
            std::process::id()
        );

        // 主循环：接受 WebSocket 连接
        tokio::spawn(async move {
            log_info!("正在监听 WebSocket 连接...");
            while let Ok((stream, addr)) = listener.accept().await {
                log_debug!("接受来自 {} 的连接", addr);
                tokio::spawn(async move {
                    if let Err(e) = handle_connection(stream).await {
                        log_error!("连接处理错误: {}", e);
                    }
                });
            }
        });

        Ok(port)
    }
}

// ============================================================================
// 连接处理
// ============================================================================

/// WebSocket 发送器类型别名
pub type WsSender = Arc<TokioMutex<futures_util::stream::SplitSink<
    tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>,
    Message
>>>;

/// 处理单个 WebSocket 连接
async fn handle_connection(
    stream: tokio::net::TcpStream,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // 升级到 WebSocket
    let ws_stream = accept_async(stream).await?;
    
    log_info!("WebSocket 连接已建立");
    
    // 分离读写流
    let (ws_sender, mut ws_receiver) = ws_stream.split();
    let ws_sender: WsSender = Arc::new(TokioMutex::new(ws_sender));
    
    // 创建消息路由器
    let router = Arc::new(MessageRouter::new());
    
    // 设置 WebSocket 发送器 (用于 PTY 输出)
    router.set_ws_sender(Arc::clone(&ws_sender)).await;
    
    // 消息处理循环
    while let Some(msg_result) = ws_receiver.next().await {
        match msg_result {
            Ok(msg) => {
                log_debug!("收到消息类型: {:?}", std::mem::discriminant(&msg));
                
                match msg {
                    Message::Text(text) => {
                        // 处理文本消息
                        if let Err(e) = handle_text_message(
                            &text,
                            &router,
                            &ws_sender
                        ).await {
                            log_error!("消息处理错误: {}", e);
                        }
                    }
                    Message::Binary(data) => {
                        // 二进制数据 - 写入 PTY
                        // 格式: [session_id_length: u8][session_id: bytes][data: bytes]
                        log_debug!("收到二进制数据: {} 字节", data.len());
                        
                        if data.len() < 2 {
                            log_error!("二进制数据格式错误: 数据太短");
                            continue;
                        }
                        
                        let session_id_len = data[0] as usize;
                        if data.len() < 1 + session_id_len {
                            log_error!("二进制数据格式错误: session_id 长度不足");
                            continue;
                        }
                        
                        let session_id = match std::str::from_utf8(&data[1..1 + session_id_len]) {
                            Ok(s) => s,
                            Err(e) => {
                                log_error!("二进制数据格式错误: session_id 不是有效 UTF-8: {}", e);
                                continue;
                            }
                        };
                        
                        let pty_data = &data[1 + session_id_len..];
                        log_debug!("写入 PTY: session_id={}, {} 字节", session_id, pty_data.len());
                        
                        if let Err(e) = router.pty_handler().write_data(session_id, pty_data).await {
                            log_error!("写入 PTY 失败: session_id={}, {}", session_id, e);
                        }
                    }
                    Message::Close(_) => {
                        log_info!("客户端关闭连接");
                        break;
                    }
                    Message::Ping(data) => {
                        // 响应 Ping
                        let mut sender = ws_sender.lock().await;
                        sender.send(Message::Pong(data)).await?;
                    }
                    Message::Pong(_) => {
                        // 忽略 Pong
                    }
                    _ => {
                        log_debug!("忽略的消息类型");
                    }
                }
            }
            Err(e) => {
                log_error!("消息接收错误: {}", e);
                break;
            }
        }
    }
    
    log_info!("WebSocket 连接已关闭");
    
    // 清理所有 PTY 会话
    router.pty_handler().cleanup_all().await;
    
    Ok(())
}

/// 处理文本消息
async fn handle_text_message(
    text: &str,
    router: &Arc<MessageRouter>,
    ws_sender: &WsSender,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // 解析消息
    match router.parse_message(text) {
        Ok(msg) => {
            let module = msg.module;
            
            // 路由消息到对应模块
            match router.route(msg).await {
                Ok(Some(response)) => {
                    // 发送响应
                    send_response(ws_sender, &response).await?;
                }
                Ok(None) => {
                    // 模块处理成功但无需响应
                    log_debug!("模块处理完成，无响应");
                }
                Err(e) => {
                    // 模块处理错误，发送错误响应
                    log_error!("模块处理错误: {}", e);
                    let error_response = router.create_error_response(module, &e);
                    send_response(ws_sender, &error_response).await?;
                }
            }
        }
        Err(e) => {
            // 消息解析错误
            log_error!("消息解析错误: {}", e);
            
            // 尝试从原始 JSON 中提取 module 字段用于错误响应
            let module = extract_module_from_json(text);
            let error_response = create_parse_error_response(module, &e);
            send_response(ws_sender, &error_response).await?;
        }
    }
    
    Ok(())
}

/// 从 JSON 中提取 module 字段
fn extract_module_from_json(text: &str) -> ModuleType {
    // 尝试解析 JSON 并提取 module 字段
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(text) {
        if let Some(module_str) = value.get("module").and_then(|v| v.as_str()) {
            if module_str == "pty" {
                return ModuleType::Pty;
            }
        }
    }
    
    // 默认返回 Pty 模块
    ModuleType::Pty
}

/// 创建解析错误响应
fn create_parse_error_response(module: ModuleType, error: &RouterError) -> ServerResponse {
    ServerResponse::error(
        module,
        "PARSE_ERROR",
        &format!("消息解析失败: {}", error)
    )
}

/// 发送响应消息
pub async fn send_response(
    ws_sender: &WsSender,
    response: &ServerResponse,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let json = serde_json::to_string(response)?;
    let mut sender = ws_sender.lock().await;
    sender.send(Message::Text(json.into())).await?;
    Ok(())
}

/// 发送原始 JSON 消息
#[allow(dead_code)]
pub async fn send_json(
    ws_sender: &WsSender,
    json: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut sender = ws_sender.lock().await;
    sender.send(Message::Text(json.to_string().into())).await?;
    Ok(())
}

/// 发送二进制消息
#[allow(dead_code)]
pub async fn send_binary(
    ws_sender: &WsSender,
    data: Vec<u8>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut sender = ws_sender.lock().await;
    sender.send(Message::Binary(data.into())).await?;
    Ok(())
}
