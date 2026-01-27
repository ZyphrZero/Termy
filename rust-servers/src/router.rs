// 消息路由器
// 根据 module 字段将消息分发到 PTY 模块

use serde::{Deserialize, Serialize};
use thiserror::Error;
use crate::server::WsSender;

/// 日志宏
macro_rules! log_info {
    ($($arg:tt)*) => {
        eprintln!("[INFO] {}", format!($($arg)*));
    };
}

#[allow(unused_macros)]
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
// 模块类型和消息定义
// ============================================================================

/// 模块类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModuleType {
    /// PTY 终端模块
    Pty,
}

impl std::fmt::Display for ModuleType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ModuleType::Pty => write!(f, "pty"),
        }
    }
}

/// 统一消息格式
/// 
/// 所有客户端消息必须包含 `module` 字段来指定目标模块
#[derive(Debug, Deserialize)]
pub struct ModuleMessage {
    /// 目标模块
    pub module: ModuleType,
    /// 消息类型
    #[serde(rename = "type")]
    pub msg_type: String,
    /// 消息负载 (保留原始 JSON 以便各模块解析)
    #[serde(flatten)]
    pub payload: serde_json::Value,
}

impl ModuleMessage {
    /// 获取消息负载
    #[allow(dead_code)]
    pub fn get_payload(&self) -> &serde_json::Value {
        &self.payload
    }
    
    /// 获取负载中的字段值
    pub fn get_field<T: serde::de::DeserializeOwned>(&self, field: &str) -> Option<T> {
        self.payload.get(field).and_then(|v| serde_json::from_value(v.clone()).ok())
    }
}

/// 服务器响应消息
#[derive(Debug, Serialize)]
pub struct ServerResponse {
    /// 来源模块
    pub module: ModuleType,
    /// 消息类型
    #[serde(rename = "type")]
    pub msg_type: String,
    /// 响应负载
    #[serde(flatten)]
    pub payload: serde_json::Value,
}

impl ServerResponse {
    /// 创建新的服务器响应
    #[allow(dead_code)]
    pub fn new(module: ModuleType, msg_type: &str, payload: serde_json::Value) -> Self {
        Self {
            module,
            msg_type: msg_type.to_string(),
            payload,
        }
    }
    
    /// 创建错误响应
    pub fn error(module: ModuleType, code: &str, message: &str) -> Self {
        Self {
            module,
            msg_type: "error".to_string(),
            payload: serde_json::json!({
                "code": code,
                "message": message
            }),
        }
    }
    
    /// 转换为 JSON 字符串
    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| "{}".to_string())
    }
}

// ============================================================================
// 路由器错误
// ============================================================================

/// 路由器错误类型
#[derive(Debug, Error)]
pub enum RouterError {
    /// 未知模块
    #[error("Unknown module: {0}")]
    #[allow(dead_code)]
    UnknownModule(String),
    
    /// 无效的消息格式
    #[error("Invalid message format: {0}")]
    #[allow(dead_code)]
    InvalidMessage(String),
    
    /// 模块处理错误
    #[error("Module error: {0}")]
    ModuleError(String),
    
    /// JSON 序列化/反序列化错误
    #[error("JSON error: {0}")]
    JsonError(#[from] serde_json::Error),
}

// ============================================================================
// 模块处理器 trait
// ============================================================================

/// 模块处理器 trait
/// 
/// 各功能模块需要实现此 trait 来处理消息
#[async_trait::async_trait]
pub trait ModuleHandler: Send + Sync {
    /// 获取模块类型
    #[allow(dead_code)]
    fn module_type(&self) -> ModuleType;
    
    /// 处理消息
    /// 
    /// 返回 Some(response) 表示需要发送响应
    /// 返回 None 表示无需响应（如异步处理）
    async fn handle(&self, msg: &ModuleMessage) -> Result<Option<ServerResponse>, RouterError>;
}

// ============================================================================
// 消息路由器
// ============================================================================

/// 消息路由器
/// 
/// 负责将消息路由到 PTY 模块
pub struct MessageRouter {
    // PTY 模块处理器
    pty_handler: crate::pty::PtyHandler,
}

impl MessageRouter {
    /// 创建新的消息路由器
    pub fn new() -> Self {
        Self {
            pty_handler: crate::pty::PtyHandler::new(),
        }
    }
    
    /// 设置 WebSocket 发送器 (用于 PTY 输出)
    pub async fn set_ws_sender(&self, sender: WsSender) {
        self.pty_handler.set_ws_sender(sender).await;
    }
    
    /// 获取 PTY 处理器引用 (用于写入数据)
    pub fn pty_handler(&self) -> &crate::pty::PtyHandler {
        &self.pty_handler
    }
    
    /// 解析消息并提取模块类型
    /// 
    /// 返回 ModuleMessage 或错误
    pub fn parse_message(&self, text: &str) -> Result<ModuleMessage, RouterError> {
        // 首先尝试解析为 ModuleMessage
        let msg: ModuleMessage = serde_json::from_str(text)?;
        
        log_debug!("解析消息: module={}, type={}", msg.module, msg.msg_type);
        
        Ok(msg)
    }
    
    /// 尝试从原始 JSON 中解析模块类型
    /// 
    /// 用于在消息解析失败时提取模块信息以便返回正确的错误响应
    #[allow(dead_code)]
    pub fn try_parse_module(&self, text: &str) -> Option<ModuleType> {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(text) {
            if let Some(module_str) = value.get("module").and_then(|v| v.as_str()) {
                if module_str == "pty" {
                    return Some(ModuleType::Pty);
                }
            }
        }
        None
    }
    
    /// 路由消息到对应模块
    /// 
    /// 返回模块处理结果或错误响应
    /// 
    pub async fn route(&self, msg: ModuleMessage) -> Result<Option<ServerResponse>, RouterError> {
        log_info!("路由消息到模块: {}, 类型: {}", msg.module, msg.msg_type);
        
        match msg.module {
            ModuleType::Pty => {
                // PTY 模块处理
                log_debug!("PTY 模块消息: {}", msg.msg_type);
                self.pty_handler.handle(&msg).await
            }
        }
    }
    
    /// 创建错误响应
    /// 
    pub fn create_error_response(&self, module: ModuleType, error: &RouterError) -> ServerResponse {
        let (code, message) = match error {
            RouterError::UnknownModule(m) => ("UNKNOWN_MODULE", format!("未知模块: {}", m)),
            RouterError::InvalidMessage(m) => ("INVALID_MESSAGE", format!("无效消息: {}", m)),
            RouterError::ModuleError(m) => ("MODULE_ERROR", m.clone()),
            RouterError::JsonError(e) => ("JSON_ERROR", format!("JSON 错误: {}", e)),
        };
        
        ServerResponse::error(module, code, &message)
    }
    
    /// 检查模块是否已实现
    #[allow(dead_code)]
    pub fn is_module_implemented(&self, module: ModuleType) -> bool {
        match module {
            ModuleType::Pty => true,    // PTY 模块已实现
        }
    }
}

impl Default for MessageRouter {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// 测试
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_parse_pty_message() {
        let router = MessageRouter::new();
        let json = r#"{"module": "pty", "type": "init", "shell_type": "powershell"}"#;
        
        let msg = router.parse_message(json).unwrap();
        assert_eq!(msg.module, ModuleType::Pty);
        assert_eq!(msg.msg_type, "init");
        
        // 测试获取负载字段
        let shell_type: Option<String> = msg.get_field("shell_type");
        assert_eq!(shell_type, Some("powershell".to_string()));
    }
    
    #[test]
    fn test_parse_invalid_module() {
        let router = MessageRouter::new();
        let json = r#"{"module": "unknown", "type": "test"}"#;
        
        let result = router.parse_message(json);
        assert!(result.is_err());
    }
    
    #[test]
    fn test_parse_missing_module() {
        let router = MessageRouter::new();
        let json = r#"{"type": "test"}"#;
        
        let result = router.parse_message(json);
        assert!(result.is_err());
    }
    
    #[test]
    fn test_try_parse_module_valid() {
        let router = MessageRouter::new();
        
        assert_eq!(router.try_parse_module(r#"{"module": "pty"}"#), Some(ModuleType::Pty));
    }
    
    #[test]
    fn test_try_parse_module_invalid() {
        let router = MessageRouter::new();
        
        // 未知模块
        assert_eq!(router.try_parse_module(r#"{"module": "unknown"}"#), None);
        
        // 缺少 module 字段
        assert_eq!(router.try_parse_module(r#"{"type": "test"}"#), None);
        
        // 无效 JSON
        assert_eq!(router.try_parse_module("not json"), None);
    }
    
    #[test]
    fn test_server_response_error() {
        let response = ServerResponse::error(ModuleType::Pty, "TEST_ERROR", "Test error message");
        
        assert_eq!(response.module, ModuleType::Pty);
        assert_eq!(response.msg_type, "error");
        
        let payload = response.payload.as_object().unwrap();
        assert_eq!(payload.get("code").unwrap().as_str().unwrap(), "TEST_ERROR");
        assert_eq!(payload.get("message").unwrap().as_str().unwrap(), "Test error message");
    }
    
    #[test]
    fn test_server_response_new() {
        let payload = serde_json::json!({"key": "value"});
        let response = ServerResponse::new(ModuleType::Pty, "test_type", payload);
        
        assert_eq!(response.module, ModuleType::Pty);
        assert_eq!(response.msg_type, "test_type");
        assert_eq!(response.payload.get("key").unwrap().as_str().unwrap(), "value");
    }
    
    #[test]
    fn test_module_type_display() {
        assert_eq!(format!("{}", ModuleType::Pty), "pty");
    }
    
    #[test]
    fn test_create_error_response_unknown_module() {
        let router = MessageRouter::new();
        let error = RouterError::UnknownModule("test_module".to_string());
        let response = router.create_error_response(ModuleType::Pty, &error);
        
        assert_eq!(response.module, ModuleType::Pty);
        assert_eq!(response.msg_type, "error");
        
        let payload = response.payload.as_object().unwrap();
        assert_eq!(payload.get("code").unwrap().as_str().unwrap(), "UNKNOWN_MODULE");
        assert!(payload.get("message").unwrap().as_str().unwrap().contains("test_module"));
    }
    
    #[test]
    fn test_create_error_response_module_error() {
        let router = MessageRouter::new();
        let error = RouterError::ModuleError("Something went wrong".to_string());
        let response = router.create_error_response(ModuleType::Pty, &error);
        
        assert_eq!(response.module, ModuleType::Pty);
        assert_eq!(response.msg_type, "error");
        
        let payload = response.payload.as_object().unwrap();
        assert_eq!(payload.get("code").unwrap().as_str().unwrap(), "MODULE_ERROR");
        assert_eq!(payload.get("message").unwrap().as_str().unwrap(), "Something went wrong");
    }
    
    #[test]
    fn test_pty_module_is_implemented() {
        let router = MessageRouter::new();
        assert!(router.is_module_implemented(ModuleType::Pty));
    }
}
