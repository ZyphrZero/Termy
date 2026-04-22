use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexIdeContextSnapshot {
    pub schema_version: u32,
    pub source: String,
    pub updated_at: String,
    pub vault_root: Option<String>,
    #[serde(default)]
    pub workspace_folders: Vec<String>,
    pub active_file: Option<ActiveFileContext>,
    #[serde(default)]
    pub open_files: Vec<OpenFileContext>,
    pub selection: Option<SelectionContext>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveFileContext {
    pub file_path: String,
    pub vault_path: String,
    pub file_url: String,
    pub has_focus: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenFileContext {
    pub file_path: String,
    pub vault_path: String,
    pub file_url: String,
    pub is_active: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectionContext {
    pub text: String,
    pub is_empty: bool,
    pub from: SelectionPosition,
    pub to: SelectionPosition,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SelectionPosition {
    pub line: u32,
    pub ch: u32,
    pub offset: u32,
}

#[derive(Debug, Clone)]
pub struct SnapshotStore {
    snapshot_file: PathBuf,
}

impl SnapshotStore {
    pub fn new(snapshot_file: impl Into<PathBuf>) -> Self {
        Self {
            snapshot_file: snapshot_file.into(),
        }
    }

    pub fn snapshot_file(&self) -> &Path {
        &self.snapshot_file
    }

    pub fn read(&self) -> Result<CodexIdeContextSnapshot, String> {
        let raw = fs::read_to_string(&self.snapshot_file)
            .map_err(|error| format!("Failed to read snapshot file {}: {}", self.snapshot_file.display(), error))?;

        serde_json::from_str::<CodexIdeContextSnapshot>(&raw).map_err(|error| {
            format!(
                "Failed to parse snapshot file {}: {}",
                self.snapshot_file.display(),
                error
            )
        })
    }
}

pub fn snapshot_as_value(snapshot: &CodexIdeContextSnapshot) -> Value {
    json!(snapshot)
}
