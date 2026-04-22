use crate::context_snapshot::{snapshot_as_value, SnapshotStore};
use serde_json::{json, Value};
use std::io::{self, BufRead, Write};

const JSON_RPC_VERSION: &str = "2.0";
const DEFAULT_PROTOCOL_VERSION: &str = "2024-11-05";
const SUPPORTED_PROTOCOL_VERSIONS: &[&str] = &[
    "2025-11-25",
    "2025-06-18",
    "2025-03-26",
    "2024-11-05",
    "2024-10-07",
];

pub struct McpStdioServer {
    snapshot_store: SnapshotStore,
    server_name: String,
    server_version: String,
}

impl McpStdioServer {
    pub fn new(snapshot_store: SnapshotStore, server_name: impl Into<String>, server_version: impl Into<String>) -> Self {
        Self {
            snapshot_store,
            server_name: server_name.into(),
            server_version: server_version.into(),
        }
    }

    pub fn run(&self) -> Result<(), Box<dyn std::error::Error>> {
        let stdin = io::stdin();
        let mut stdout = io::stdout().lock();

        for line in stdin.lock().lines() {
            let line = line?;
            if line.trim().is_empty() {
                continue;
            }

            let request: Value = match serde_json::from_str(&line) {
                Ok(value) => value,
                Err(error) => {
                    write_json_line(&mut stdout, &json!({
                        "jsonrpc": JSON_RPC_VERSION,
                        "id": Value::Null,
                        "error": {
                            "code": -32700,
                            "message": format!("Parse error: {}", error),
                        }
                    }))?;
                    continue;
                }
            };

            if let Some(response) = self.handle_message(&request) {
                write_json_line(&mut stdout, &response)?;
            }
        }

        Ok(())
    }

    fn handle_message(&self, request: &Value) -> Option<Value> {
        let Some(method) = request.get("method").and_then(Value::as_str) else {
            return Some(error_response(
                request.get("id").cloned().unwrap_or(Value::Null),
                -32600,
                "Invalid request: missing method",
            ));
        };

        let id = request.get("id").cloned();
        let params = request
            .get("params")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();

        match method {
            "initialize" => {
                let protocol_version = params
                    .get("protocolVersion")
                    .and_then(Value::as_str)
                    .filter(|version| SUPPORTED_PROTOCOL_VERSIONS.contains(version))
                    .unwrap_or(DEFAULT_PROTOCOL_VERSION);

                Some(success_response(
                    id.unwrap_or(Value::Null),
                    json!({
                        "protocolVersion": protocol_version,
                        "capabilities": {
                            "tools": {}
                        },
                        "serverInfo": {
                            "name": self.server_name,
                            "version": self.server_version,
                        },
                        "instructions": "Termy MCP server exposes the current Obsidian file, selection, open files, and workspace folders for Codex.",
                    }),
                ))
            }
            "notifications/initialized" | "notifications/cancelled" => None,
            "ping" => Some(success_response(
                id.unwrap_or(Value::Null),
                json!({}),
            )),
            "tools/list" => Some(success_response(
                id.unwrap_or(Value::Null),
                json!({
                    "tools": build_tools(),
                }),
            )),
            "tools/call" => {
                let tool_name = params
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let arguments = params
                    .get("arguments")
                    .cloned()
                    .unwrap_or_else(|| json!({}));

                Some(success_response(
                    id.unwrap_or(Value::Null),
                    self.handle_tool_call(tool_name, &arguments),
                ))
            }
            _ => id.map(|request_id| error_response(request_id, -32601, &format!("Method not found: {}", method))),
        }
    }

    fn handle_tool_call(&self, tool_name: &str, _arguments: &Value) -> Value {
        let snapshot = match self.snapshot_store.read() {
            Ok(snapshot) => snapshot,
            Err(message) => {
                return tool_result(
                    true,
                    json!({
                        "success": false,
                        "message": message,
                        "snapshotFile": self.snapshot_store.snapshot_file().display().to_string(),
                    }),
                    &message,
                )
            }
        };

        match tool_name {
            "get_current_context" => {
                let structured = snapshot_as_value(&snapshot);
                tool_result(false, structured.clone(), &serde_json::to_string_pretty(&structured).unwrap_or_default())
            }
            "get_active_file" => {
                let structured = json!({
                    "success": snapshot.active_file.is_some(),
                    "activeFile": snapshot.active_file,
                });
                tool_result(
                    false,
                    structured.clone(),
                    &serde_json::to_string_pretty(&structured).unwrap_or_default(),
                )
            }
            "get_current_selection" => {
                let structured = json!({
                    "success": snapshot.selection.is_some(),
                    "selection": snapshot.selection,
                });
                tool_result(
                    false,
                    structured.clone(),
                    &serde_json::to_string_pretty(&structured).unwrap_or_default(),
                )
            }
            "get_open_files" => {
                let structured = json!({
                    "success": true,
                    "openFiles": snapshot.open_files,
                });
                tool_result(
                    false,
                    structured.clone(),
                    &serde_json::to_string_pretty(&structured).unwrap_or_default(),
                )
            }
            "get_workspace_folders" => {
                let structured = json!({
                    "success": true,
                    "workspaceFolders": snapshot.workspace_folders,
                    "vaultRoot": snapshot.vault_root,
                });
                tool_result(
                    false,
                    structured.clone(),
                    &serde_json::to_string_pretty(&structured).unwrap_or_default(),
                )
            }
            _ => {
                let structured = json!({
                    "success": false,
                    "message": format!("Unknown tool: {}", tool_name),
                });
                tool_result(
                    true,
                    structured,
                    &format!("Unknown tool: {}", tool_name),
                )
            }
        }
    }
}

fn build_tools() -> Value {
    json!([
        build_tool(
            "get_current_context",
            "Return the latest Obsidian IDE context snapshot, including active file, open files, selection, and workspace folders.",
        ),
        build_tool(
            "get_active_file",
            "Return the active Obsidian file and whether the editor currently has focus.",
        ),
        build_tool(
            "get_current_selection",
            "Return the current primary selection from the active Obsidian editor.",
        ),
        build_tool(
            "get_open_files",
            "Return the currently open Obsidian markdown files.",
        ),
        build_tool(
            "get_workspace_folders",
            "Return the current Obsidian vault root and workspace folders.",
        ),
    ])
}

fn build_tool(name: &str, description: &str) -> Value {
    json!({
        "name": name,
        "description": description,
        "inputSchema": {
            "type": "object",
            "properties": {}
        },
        "annotations": {
            "readOnlyHint": true,
            "idempotentHint": true
        }
    })
}

fn tool_result(is_error: bool, structured_content: Value, text: &str) -> Value {
    let mut result = json!({
        "content": [
            {
                "type": "text",
                "text": text,
            }
        ],
        "structuredContent": structured_content,
    });

    if is_error {
        result["isError"] = Value::Bool(true);
    }

    result
}

fn success_response(id: Value, result: Value) -> Value {
    json!({
        "jsonrpc": JSON_RPC_VERSION,
        "id": id,
        "result": result,
    })
}

fn error_response(id: Value, code: i64, message: &str) -> Value {
    json!({
        "jsonrpc": JSON_RPC_VERSION,
        "id": id,
        "error": {
            "code": code,
            "message": message,
        }
    })
}

fn write_json_line(stdout: &mut impl Write, value: &Value) -> io::Result<()> {
    serde_json::to_writer(&mut *stdout, value)?;
    stdout.write_all(b"\n")?;
    stdout.flush()
}
