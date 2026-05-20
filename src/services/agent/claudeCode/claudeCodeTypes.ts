/**
 * Wire types for Claude Code's stream-json protocol and on-disk
 * JSONL session files.
 *
 * These are intentionally minimal — we only model the fields Termy
 * actually reads. Unknown fields are preserved by the JSON parser
 * and silently ignored by the adapter, so a CLI upgrade that adds
 * new fields never breaks the panel.
 *
 * Source of truth: `claude -p --verbose --output-format stream-json
 * --include-partial-messages` stdout, and the on-disk
 * `~/.claude/projects/<encoded>/<sid>.jsonl` files.
 */

/** Content block inside an assistant message. */
export interface ClaudeContentBlock {
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'image';
  text?: string;
  thinking?: string;
  signature?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

/**
 * Top-level message envelope. Both the on-disk JSONL and the
 * stream-json stdout share this shape for `type: 'user' | 'assistant'`.
 */
export interface ClaudeNativeMessage {
  type: 'user' | 'assistant' | 'system' | 'result' | 'stream_event' |
    'permission-mode' | 'ai-title' | 'file-history-snapshot' | 'attachment' |
    'queue-operation';
  subtype?: string;
  uuid?: string;
  timestamp?: string;
  session_id?: string;
  /** On-disk JSONL uses camelCase; stream-json stdout uses snake_case. */
  sessionId?: string;
  parent_tool_use_id?: string | null;
  message?: {
    role?: string;
    content?: string | ClaudeContentBlock[];
    model?: string;
    id?: string;
  };
  /** `result` messages carry these. */
  result?: string;
  stop_reason?: string;
  is_error?: boolean;
  duration_ms?: number;
  total_cost_usd?: number;
  usage?: Record<string, unknown>;
  /** `system/init` carries session metadata. */
  tools?: string[];
  model?: string;
  /** `ai-title` carries the generated title. */
  aiTitle?: string;
  /** `stream_event` wraps Anthropic API streaming events. */
  event?: ClaudeStreamEvent;
  /** `permission-mode` carries the mode string. */
  permissionMode?: string;
  /** Generic forward-compat. */
  [extra: string]: unknown;
}

/** Anthropic API streaming event (nested inside `stream_event`). */
export interface ClaudeStreamEvent {
  type: string;
  index?: number;
  content_block?: { type: string; text?: string; thinking?: string };
  delta?: {
    type: string;
    text?: string;
    thinking?: string;
    stop_reason?: string;
  };
  message?: Record<string, unknown>;
  usage?: Record<string, unknown>;
}
