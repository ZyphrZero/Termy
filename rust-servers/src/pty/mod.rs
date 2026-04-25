// PTY module
// Provides terminal session management

mod session;
mod shell;
mod osc_scanner;

pub use session::{PtySession, PtyReader, PtyWriter};
pub use shell::{get_shell_by_type, get_default_shell};

use crate::router::{ModuleHandler, ModuleMessage, ModuleType, RouterError, ServerResponse};
use crate::pty::osc_scanner::{OscEvent, OscScanner};
use crate::server::WsSender;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::Mutex as TokioMutex;
use tokio::time::{self, Duration, Instant};
use tokio_tungstenite::tungstenite::Message;
use futures_util::SinkExt;
use uuid::Uuid;

/// Logging macros
macro_rules! log_info {
    ($($arg:tt)*) => {
        eprintln!("[INFO] [PTY] {}", format!($($arg)*));
    };
}

macro_rules! log_error {
    ($($arg:tt)*) => {
        eprintln!("[ERROR] [PTY] {}", format!($($arg)*));
    };
}

macro_rules! log_debug {
    ($($arg:tt)*) => {
        if cfg!(debug_assertions) {
            eprintln!("[DEBUG] [PTY] {}", format!($($arg)*));
        }
    };
}

// ============================================================================
// PTY session context
// ============================================================================

/// Context for a single PTY session
///
/// Contains all resources required for one PTY session
struct PtySessionContext {
    /// PTY session
    session: Arc<TokioMutex<PtySession>>,
    /// PTY writer
    writer: Arc<Mutex<PtyWriter>>,
    /// Read task handle
    read_task: Option<tokio::task::JoinHandle<()>>,
}

impl PtySessionContext {
    /// Create a new session context
    fn new(
        session: Arc<TokioMutex<PtySession>>,
        writer: Arc<Mutex<PtyWriter>>,
    ) -> Self {
        Self {
            session,
            writer,
            read_task: None,
        }
    }
}

// ============================================================================
// PTY handler
// ============================================================================

/// PTY module handler
///
/// Manages the lifecycle of multiple PTY sessions and handles terminal-related messages
pub struct PtyHandler {
    /// Session registry: session_id -> PtySessionContext
    sessions: TokioMutex<HashMap<String, PtySessionContext>>,
    /// WebSocket sender (used to send PTY output)
    ws_sender: TokioMutex<Option<WsSender>>,
}

impl PtyHandler {
    /// Create a new PTY handler
    pub fn new() -> Self {
        Self {
            sessions: TokioMutex::new(HashMap::new()),
            ws_sender: TokioMutex::new(None),
        }
    }
    
    /// Set the WebSocket sender
    pub async fn set_ws_sender(&self, sender: WsSender) {
        let mut ws_sender = self.ws_sender.lock().await;
        *ws_sender = Some(sender);
    }
    
    /// Handle the init message and create a PTY session
    async fn handle_init(
        &self,
        shell_type: Option<String>,
        shell_args: Option<Vec<String>>,
        cwd: Option<String>,
        env: Option<HashMap<String, String>>,
        cols: Option<u16>,
        rows: Option<u16>,
    ) -> Result<Option<ServerResponse>, RouterError> {
        // Generate a unique session_id
        let session_id = Uuid::new_v4().to_string();
        let cols = cols.filter(|value| *value > 0).unwrap_or(80);
        let rows = rows.filter(|value| *value > 0).unwrap_or(24);
        
        log_info!(
            "初始化 PTY 会话: session_id={}, shell_type={:?}, cwd={:?}, size={}x{}",
            session_id,
            shell_type,
            cwd,
            cols,
            rows
        );
        
        // Create the PTY session
        let (pty_session, pty_reader, pty_writer) = PtySession::new(
            cols,
            rows,
            shell_type.as_deref(),
            shell_args.as_ref().map(|v| v.as_slice()),
            cwd.as_deref(),
            env.as_ref(),
        ).map_err(|e| RouterError::ModuleError(format!("创建 PTY 会话失败: {}", e)))?;
        
        // Create the session context
        let pty_session = Arc::new(TokioMutex::new(pty_session));
        let pty_reader = Arc::new(Mutex::new(pty_reader));
        let pty_writer = Arc::new(Mutex::new(pty_writer));

        let mut context = PtySessionContext::new(
            Arc::clone(&pty_session),
            Arc::clone(&pty_writer),
        );
        
        // Start the PTY output reader task
        let read_task = self.start_read_task(session_id.clone(), pty_reader, pty_writer, shell_type).await?;
        context.read_task = Some(read_task);
        
        // Store the session context
        {
            let mut sessions = self.sessions.lock().await;
            sessions.insert(session_id.clone(), context);
        }
        
        log_info!("PTY 会话创建成功: session_id={}", session_id);
        
        // Return a success response that includes the session_id
        Ok(Some(ServerResponse::new(
            ModuleType::Pty,
            "init_complete",
            serde_json::json!({
                "success": true,
                "session_id": session_id
            }),
        )))
    }
    
    /// Start the PTY output reader task
    ///
    /// Returns the task handle, which the caller stores
    async fn start_read_task(
        &self,
        session_id: String,
        reader: Arc<Mutex<PtyReader>>,
        _writer: Arc<Mutex<PtyWriter>>,
        _shell_type: Option<String>,
    ) -> Result<tokio::task::JoinHandle<()>, RouterError> {
        const OUTPUT_BATCH_INTERVAL_MS: u64 = 4;
        const READ_BUFFER_SIZE: usize = 8192;

        let ws_sender = {
            let ws_sender_guard = self.ws_sender.lock().await;
            ws_sender_guard.clone()
        };
        
        let ws_sender = ws_sender.ok_or_else(|| RouterError::ModuleError("WebSocket sender not set".to_string()))?;
        
        // Start the reader task
        let task = tokio::spawn(async move {
            enum ReadEvent {
                Data(Vec<u8>),
                Eof,
                Error(String),
            }

            let (read_tx, mut read_rx) = tokio::sync::mpsc::channel::<ReadEvent>(32);
            let reader_for_thread = Arc::clone(&reader);

            tokio::task::spawn_blocking(move || {
                loop {
                    let mut reader = match reader_for_thread.lock() {
                        Ok(guard) => guard,
                        Err(_) => break,
                    };
                    let mut local_buf = vec![0u8; READ_BUFFER_SIZE];
                    match reader.read(&mut local_buf) {
                        Ok(0) => {
                            let _ = read_tx.blocking_send(ReadEvent::Eof);
                            break;
                        }
                        Ok(n) => {
                            local_buf.truncate(n);
                            if read_tx.blocking_send(ReadEvent::Data(local_buf)).is_err() {
                                break;
                            }
                        }
                        Err(e) => {
                            let _ = read_tx.blocking_send(ReadEvent::Error(e.to_string()));
                            break;
                        }
                    }
                }
            });

            let mut batch_buffer: Vec<u8> = Vec::new();
            let mut osc_scanner = OscScanner::new();
            let mut pending_shell_events: Vec<OscEvent> = Vec::new();

            loop {
                let first_event = match read_rx.recv().await {
                    Some(event) => event,
                    None => break,
                };

                let mut pending_exit = false;
                let mut pending_error: Option<String> = None;

                match first_event {
                    ReadEvent::Data(data) => {
                        pending_shell_events.extend(osc_scanner.scan(&data));
                        batch_buffer.extend_from_slice(&data);
                    }
                    ReadEvent::Eof => pending_exit = true,
                    ReadEvent::Error(e) => pending_error = Some(e),
                }

                if pending_error.is_none() && !pending_exit {
                    let deadline = Instant::now() + Duration::from_millis(OUTPUT_BATCH_INTERVAL_MS);
                    loop {
                        match time::timeout_at(deadline, read_rx.recv()).await {
                            Ok(Some(ReadEvent::Data(data))) => {
                                pending_shell_events.extend(osc_scanner.scan(&data));
                                batch_buffer.extend_from_slice(&data);
                            }
                            Ok(Some(ReadEvent::Eof)) => {
                                pending_exit = true;
                                break;
                            }
                            Ok(Some(ReadEvent::Error(e))) => {
                                pending_error = Some(e);
                                break;
                            }
                            Ok(None) => {
                                break;
                            }
                            Err(_) => {
                                break;
                            }
                        }
                    }
                }

                if !batch_buffer.is_empty() {
                    log_debug!(
                        "读取 PTY 输出(批处理): session_id={}, {} 字节",
                        session_id,
                        batch_buffer.len()
                    );

                    // Build a binary frame prefixed with the session_id
                    // Format: [session_id_length: u8][session_id: bytes][data: bytes]
                    let session_id_bytes = session_id.as_bytes();
                    let session_id_len = session_id_bytes.len() as u8;

                    let mut frame = Vec::with_capacity(1 + session_id_bytes.len() + batch_buffer.len());
                    frame.push(session_id_len);
                    frame.extend_from_slice(session_id_bytes);
                    frame.extend_from_slice(&batch_buffer);

                    let mut sender = ws_sender.lock().await;
                    if let Err(e) = sender.send(Message::Binary(frame.into())).await {
                        log_error!("发送 PTY 输出失败: session_id={}, {}", session_id, e);
                        break;
                    }
                }

                if !pending_shell_events.is_empty() {
                    for event in pending_shell_events.drain(..) {
                        let event_payload = serde_json::json!({
                            "session_id": session_id,
                            "event": event.event_name(),
                            "source": event.source_name(),
                            "exit_code": event.exit_code(),
                        });
                        let response = ServerResponse::new(
                            ModuleType::Pty,
                            "shell_event",
                            event_payload,
                        );
                        let mut sender = ws_sender.lock().await;
                        if let Err(e) = sender.send(Message::Text(response.to_json().into())).await {
                            log_error!("发送 shell_event 失败: session_id={}, {}", session_id, e);
                            break;
                        }
                    }
                }

                batch_buffer.clear();

                if let Some(e) = pending_error {
                    log_error!("PTY 输出读取错误: session_id={}, {}", session_id, e);
                    break;
                }

                if pending_exit {
                    // EOF: the process has exited
                    log_info!("PTY 输出结束: session_id={}", session_id);

                    // Send the exit event
                    let exit_response = ServerResponse::new(
                        ModuleType::Pty,
                        "exit",
                        serde_json::json!({
                            "session_id": session_id,
                            "code": 0
                        }),
                    );
                    let mut sender = ws_sender.lock().await;
                    if let Err(e) = sender.send(Message::Text(exit_response.to_json().into())).await {
                        log_error!("发送 exit 事件失败: session_id={}, {}", session_id, e);
                    }
                    break;
                }
            }
        });
        
        Ok(task)
    }
    
    /// Handle the resize message and resize the terminal
    async fn handle_resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<Option<ServerResponse>, RouterError> {
        log_info!("调整终端尺寸: session_id={}, {}x{}", session_id, cols, rows);
        
        let sessions = self.sessions.lock().await;
        let context = sessions.get(session_id)
            .ok_or_else(|| RouterError::ModuleError(format!("SESSION_NOT_FOUND: {}", session_id)))?;
        
        let mut pty = context.session.lock().await;
        pty.resize(cols, rows)
            .map_err(|e| RouterError::ModuleError(format!("调整终端尺寸失败: {}", e)))?;
        
        Ok(None) // resize does not require a response
    }
    
    /// Write data to the PTY for the specified session
    pub async fn write_data(&self, session_id: &str, data: &[u8]) -> Result<(), RouterError> {
        let sessions = self.sessions.lock().await;
        let context = sessions.get(session_id)
            .ok_or_else(|| RouterError::ModuleError(format!("SESSION_NOT_FOUND: {}", session_id)))?;
        
        let mut w = context.writer.lock().unwrap();
        w.write(data)
            .map_err(|e| RouterError::ModuleError(format!("写入 PTY 失败: {}", e)))?;
        
        Ok(())
    }
    
    /// Destroy the specified session
    pub async fn handle_destroy(&self, session_id: &str) -> Result<(), RouterError> {
        log_info!("销毁 PTY 会话: session_id={}", session_id);
        
        let mut sessions = self.sessions.lock().await;
        if let Some(mut context) = sessions.remove(session_id) {
            // Terminate the PTY process
            if let Ok(mut session) = context.session.try_lock() {
                let _ = session.kill();
            }
            
            // End the reader task asynchronously without waiting for completion
            if let Some(task) = context.read_task.take() {
                tokio::spawn(async move {
                    let _ = task.await;
                    log_debug!("读取任务已终止");
                });
            }
            
            log_info!("PTY 会话已销毁: session_id={}", session_id);
            Ok(())
        } else {
            Err(RouterError::ModuleError(format!("SESSION_NOT_FOUND: {}", session_id)))
        }
    }
    
    /// Clean up all sessions (called when the connection closes)
    pub async fn cleanup_all(&self) {
        log_info!("清理所有 PTY 会话");
        
        let mut sessions = self.sessions.lock().await;
        for (session_id, mut context) in sessions.drain() {
            log_info!("清理会话: {}", session_id);
            
            // Terminate the PTY process
            if let Ok(mut session) = context.session.try_lock() {
                let _ = session.kill();
            }
            
            // Wait for the reader task to finish
            if let Some(task) = context.read_task.take() {
                let _ = task.await;
            }
        }
        
        log_info!("所有 PTY 会话已清理");
    }
    
    /// Check whether any sessions are active
    pub async fn has_sessions(&self) -> bool {
        let sessions = self.sessions.lock().await;
        !sessions.is_empty()
    }
}

impl Default for PtyHandler {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait::async_trait]
impl ModuleHandler for PtyHandler {
    fn module_type(&self) -> ModuleType {
        ModuleType::Pty
    }
    
    async fn handle(&self, msg: &ModuleMessage) -> Result<Option<ServerResponse>, RouterError> {
        log_debug!("处理 PTY 消息: {}", msg.msg_type);
        
        match msg.msg_type.as_str() {
            "init" => {
                let shell_type: Option<String> = msg.get_field("shell_type");
                let shell_args: Option<Vec<String>> = msg.get_field("shell_args");
                let cwd: Option<String> = msg.get_field("cwd");
                let env: Option<HashMap<String, String>> = msg.get_field("env");
                let cols: Option<u16> = msg.get_field("cols");
                let rows: Option<u16> = msg.get_field("rows");
                
                self.handle_init(shell_type, shell_args, cwd, env, cols, rows).await
            }
            "resize" => {
                // resize requires a session_id
                let session_id: Option<String> = msg.get_field("session_id");
                let session_id = session_id.ok_or_else(|| {
                    RouterError::ModuleError("SESSION_ID_REQUIRED".to_string())
                })?;
                
                let cols: u16 = msg.get_field("cols").unwrap_or(80);
                let rows: u16 = msg.get_field("rows").unwrap_or(24);
                
                self.handle_resize(&session_id, cols, rows).await
            }
            "destroy" => {
                // destroy requires a session_id
                let session_id: Option<String> = msg.get_field("session_id");
                let session_id = session_id.ok_or_else(|| {
                    RouterError::ModuleError("SESSION_ID_REQUIRED".to_string())
                })?;
                
                self.handle_destroy(&session_id).await?;
                Ok(None)
            }
            "env" => {
                // In the original implementation, the env command only logged data; actual environment variables are set during init
                let cwd: Option<String> = msg.get_field("cwd");
                let env: Option<HashMap<String, String>> = msg.get_field("env");
                log_info!("收到 env 命令: cwd={:?}, env={:?}", cwd, env);
                Ok(None)
            }
            _ => {
                log_debug!("未知的 PTY 消息类型: {}", msg.msg_type);
                Err(RouterError::ModuleError(format!("未知的 PTY 消息类型: {}", msg.msg_type)))
            }
        }
    }
}
