// Message router
// Dispatch messages to the PTY module based on the module field

use serde::{Deserialize, Serialize};
use thiserror::Error;
use crate::server::WsSender;

/// Logging macro
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
// Module types and message definitions
// ============================================================================

/// Module type
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModuleType {
    /// PTY terminal module
    Pty,
}

impl std::fmt::Display for ModuleType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ModuleType::Pty => write!(f, "pty"),
        }
    }
}

/// Unified message format
///
/// All client messages must include the `module` field to specify the target module
#[derive(Debug, Deserialize)]
pub struct ModuleMessage {
    /// Target module
    pub module: ModuleType,
    /// Message type
    #[serde(rename = "type")]
    pub msg_type: String,
    /// Message payload (keeps the raw JSON so each module can parse it)
    #[serde(flatten)]
    pub payload: serde_json::Value,
}

impl ModuleMessage {
    /// Get the message payload
    #[allow(dead_code)]
    pub fn get_payload(&self) -> &serde_json::Value {
        &self.payload
    }
    
    /// Get a field value from the payload
    pub fn get_field<T: serde::de::DeserializeOwned>(&self, field: &str) -> Option<T> {
        self.payload.get(field).and_then(|v| serde_json::from_value(v.clone()).ok())
    }
}

/// Server response message
#[derive(Debug, Serialize)]
pub struct ServerResponse {
    /// Source module
    pub module: ModuleType,
    /// Message type
    #[serde(rename = "type")]
    pub msg_type: String,
    /// Response payload
    #[serde(flatten)]
    pub payload: serde_json::Value,
}

impl ServerResponse {
    /// Create a new server response
    #[allow(dead_code)]
    pub fn new(module: ModuleType, msg_type: &str, payload: serde_json::Value) -> Self {
        Self {
            module,
            msg_type: msg_type.to_string(),
            payload,
        }
    }
    
    /// Create an error response
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
    
    /// Convert to a JSON string
    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| "{}".to_string())
    }
}

// ============================================================================
// Router errors
// ============================================================================

/// Router error types
#[derive(Debug, Error)]
pub enum RouterError {
    /// Unknown module
    #[error("Unknown module: {0}")]
    #[allow(dead_code)]
    UnknownModule(String),
    
    /// Invalid message format
    #[error("Invalid message format: {0}")]
    #[allow(dead_code)]
    InvalidMessage(String),
    
    /// Module handling error
    #[error("Module error: {0}")]
    ModuleError(String),
    
    /// JSON serialization/deserialization error
    #[error("JSON error: {0}")]
    JsonError(#[from] serde_json::Error),
}

// ============================================================================
// Module handler trait
// ============================================================================

/// Module handler trait
///
/// Each feature module implements this trait to handle messages
#[async_trait::async_trait]
pub trait ModuleHandler: Send + Sync {
    /// Get the module type
    #[allow(dead_code)]
    fn module_type(&self) -> ModuleType;
    
    /// Handle a message
    ///
    /// Return Some(response) when a reply should be sent
    /// Return None when no reply is needed, such as for async handling
    async fn handle(&self, msg: &ModuleMessage) -> Result<Option<ServerResponse>, RouterError>;
}

// ============================================================================
// Message router
// ============================================================================

/// Message router
/// 
/// Routes messages to the PTY module
pub struct MessageRouter {
    // PTY module handler
    pty_handler: crate::pty::PtyHandler,
}

impl MessageRouter {
    /// Create a new message router
    pub fn new() -> Self {
        Self {
            pty_handler: crate::pty::PtyHandler::new(),
        }
    }
    
    /// Set the WebSocket sender (used for PTY output)
    pub async fn set_ws_sender(&self, sender: WsSender) {
        self.pty_handler.set_ws_sender(sender).await;
    }
    
    /// Get a reference to the PTY handler (used to write data)
    pub fn pty_handler(&self) -> &crate::pty::PtyHandler {
        &self.pty_handler
    }
    
    /// Parse a message and extract the module type
    ///
    /// Returns a ModuleMessage or an error
    pub fn parse_message(&self, text: &str) -> Result<ModuleMessage, RouterError> {
        // First try to parse it as a ModuleMessage
        let msg: ModuleMessage = serde_json::from_str(text)?;
        
        log_debug!("解析消息: module={}, type={}", msg.module, msg.msg_type);
        
        Ok(msg)
    }
    
    /// Try to parse the module type from the raw JSON
    ///
    /// Used to extract module information when message parsing fails so the correct error response can be returned
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
    
    /// Route a message to the matching module
    ///
    /// Returns the module handling result or an error
    /// 
    pub async fn route(&self, msg: ModuleMessage) -> Result<Option<ServerResponse>, RouterError> {
        log_info!("路由消息到模块: {}, 类型: {}", msg.module, msg.msg_type);
        
        match msg.module {
            ModuleType::Pty => {
                // PTY module handling
                log_debug!("PTY 模块消息: {}", msg.msg_type);
                self.pty_handler.handle(&msg).await
            }
        }
    }
    
    /// Create an error response
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
    
    /// Check whether a module is implemented
    #[allow(dead_code)]
    pub fn is_module_implemented(&self, module: ModuleType) -> bool {
        match module {
            ModuleType::Pty => true,    // PTY module is implemented
        }
    }
}

impl Default for MessageRouter {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// Tests
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
        
        // Test reading a payload field
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
        
        // Unknown module
        assert_eq!(router.try_parse_module(r#"{"module": "unknown"}"#), None);
        
        // Missing module field
        assert_eq!(router.try_parse_module(r#"{"type": "test"}"#), None);
        
        // Invalid JSON
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
