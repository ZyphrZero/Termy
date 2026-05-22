/**
 * Wire types for the Codex CLI `app-server` JSON-RPC v2 protocol.
 *
 * These types mirror the canonical Rust shapes in
 * `codex/codex-rs/app-server-protocol/src/protocol/{common.rs, v2/*.rs}`.
 * We model only the fields Termy actually reads. Unknown fields are
 * preserved by JSON.parse and silently ignored by the adapter, so a
 * Codex upgrade that adds new fields never breaks the panel.
 *
 * Sections:
 *   1. JSON-RPC envelope (request / response / notification / error)
 *   2. Method params/results (initialize, thread/{start,resume,list,read},
 *      turn/{start,interrupt}, ...)
 *   3. Notification payloads (item/{started,completed,...},
 *      turn/{started,completed,plan/updated}, error, warning, ...)
 *   4. Server-to-client request payloads (item/commandExecution/requestApproval,
 *      item/fileChange/requestApproval, item/permissions/requestApproval, ...)
 *   5. Item types (ThreadItem discriminated union)
 *   6. JSONL on-disk types (legacy fallback when daemon is unavailable)
 */

// ─── 1. JSON-RPC Envelope ────────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result: unknown;
}

export interface JsonRpcError {
  jsonrpc: '2.0';
  id: number | string | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

// ─── 2. Method Params / Results ──────────────────────────────────

/** v1 `initialize`: declares client info and capability opt-ins. */
export interface InitializeParams {
  clientInfo: { name: string; title?: string | null; version: string };
  capabilities?: {
    experimentalApi?: boolean;
    requestAttestation?: boolean;
    optOutNotificationMethods?: string[] | null;
  };
}

export interface InitializeResponse {
  userAgent: string;
  codexHome: string;
  platformFamily: string;
  platformOs: string;
}

/** AskForApproval enum from `codex_protocol::protocol::AskForApproval`. */
export type AskForApproval = 'unlessTrusted' | 'onFailure' | 'onRequest' | 'never';

/** SandboxMode enum (config_types). */
export type SandboxMode = 'readOnly' | 'workspaceWrite' | 'dangerFullAccess';

/** v2 `thread/start` — start a fresh thread. */
export interface ThreadStartParams {
  model?: string;
  modelProvider?: string;
  cwd?: string;
  approvalPolicy?: AskForApproval;
  sandbox?: SandboxMode;
}

export interface ThreadStartResponse {
  thread: Thread;
  model: string;
  modelProvider: string;
  cwd: string;
}

/** v2 `thread/resume` — resume a persisted thread by id. */
export interface ThreadResumeParams {
  threadId: string;
  /** When true, returns metadata only and skips populating `turns`. */
  excludeTurns?: boolean;
  cwd?: string;
}

export interface ThreadResumeResponse {
  thread: Thread;
  model: string;
  modelProvider: string;
  cwd: string;
}

/** v2 `thread/list` — list threads filtered by cwd. */
export interface ThreadListParams {
  cursor?: string;
  limit?: number;
  sortKey?: 'created_at' | 'updated_at';
  sortDirection?: 'asc' | 'desc';
  /** Single path or an array of paths to match exactly. */
  cwd?: string | string[];
  archived?: boolean;
  searchTerm?: string;
}

export interface ThreadListResponse {
  data: Thread[];
  nextCursor?: string | null;
  backwardsCursor?: string | null;
}

/** v2 `thread/read` — read a single thread by id (with optional turns). */
export interface ThreadReadParams {
  threadId: string;
  includeTurns?: boolean;
}

export interface ThreadReadResponse {
  thread: Thread;
}

/** v2 `thread/turns/list` — paginated turn loading. */
export interface ThreadTurnsListParams {
  threadId: string;
  cursor?: string;
  limit?: number;
}

export interface ThreadTurnsListResponse {
  data: Turn[];
  nextCursor?: string | null;
}

/** v2 `turn/start` — submit a user turn on an existing thread. */
export interface TurnStartParams {
  threadId: string;
  input: UserInput[];
  cwd?: string;
  approvalPolicy?: AskForApproval;
}

export type UserInput =
  | { type: 'text'; text: string; textElements?: TextElement[] }
  | { type: 'image'; url: string; detail?: ImageDetail }
  | { type: 'localImage'; path: string; detail?: ImageDetail }
  | { type: 'skill'; name: string; path: string }
  | { type: 'mention'; name: string; path: string };

export interface TextElement {
  byteRange: { start: number; end: number };
  placeholder?: string | null;
}

export type ImageDetail = 'auto' | 'low' | 'high';

export interface TurnStartResponse {
  turn: Turn;
}

/** v2 `turn/interrupt` — abort a running turn. */
export interface TurnInterruptParams {
  threadId: string;
  turnId: string;
}

export type TurnInterruptResponse = Record<string, never>;

// ─── Thread / Turn data shapes ───────────────────────────────────

export interface Thread {
  id: string;
  sessionId: string;
  forkedFromId?: string | null;
  /** Usually the first user message. Used as the panel title. */
  preview: string;
  ephemeral: boolean;
  modelProvider: string;
  /** Unix timestamp in seconds. */
  createdAt: number;
  /** Unix timestamp in seconds. */
  updatedAt: number;
  status: ThreadStatus;
  path?: string | null;
  cwd: string;
  cliVersion: string;
  source?: unknown;
  threadSource?: unknown;
  agentNickname?: string | null;
  agentRole?: string | null;
  gitInfo?: GitInfo | null;
  /** Optional user-facing title overriding `preview`. */
  name?: string | null;
  /** Populated only by thread/resume, thread/fork, thread/read(includeTurns). */
  turns: Turn[];
}

export type ThreadStatus = string;

export interface GitInfo {
  sha?: string | null;
  branch?: string | null;
  originUrl?: string | null;
}

export interface Turn {
  id: string;
  items: ThreadItem[];
  itemsView?: 'notLoaded' | 'summary' | 'full';
  status: TurnStatus;
  error?: TurnError | null;
  startedAt?: number | null;
  completedAt?: number | null;
  durationMs?: number | null;
}

export type TurnStatus = 'completed' | 'interrupted' | 'failed' | 'inProgress';

export interface TurnError {
  message: string;
  codexErrorInfo?: unknown;
  additionalDetails?: string | null;
}

// ─── 3. Notification Payloads ────────────────────────────────────

/** `thread/started`. */
export interface ThreadStartedNotification {
  thread: Thread;
}

/** `turn/started`. */
export interface TurnStartedNotification {
  threadId: string;
  turn: Turn;
}

/** `turn/completed`. */
export interface TurnCompletedNotification {
  threadId: string;
  turn: Turn;
}

/** `item/started`. */
export interface ItemStartedNotification {
  item: ThreadItem;
  threadId: string;
  turnId: string;
  startedAt?: number;
}

/** `item/completed`. */
export interface ItemCompletedNotification {
  item: ThreadItem;
  threadId: string;
  turnId: string;
  completedAt?: number;
}

/** `item/agentMessage/delta` — streaming assistant text. */
export interface AgentMessageDeltaNotification {
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
}

/** `item/reasoning/textDelta` — streaming reasoning content. */
export interface ReasoningTextDeltaNotification {
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
  contentIndex: number;
}

/** `item/reasoning/summaryTextDelta` — streaming reasoning summary. */
export interface ReasoningSummaryTextDeltaNotification {
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
  summaryIndex: number;
}

/** `item/commandExecution/outputDelta` — base64-encoded stdout/stderr stream. */
export interface CommandExecutionOutputDeltaNotification {
  threadId: string;
  turnId: string;
  itemId: string;
  /** Base64-encoded chunk of combined stdout+stderr. */
  delta: string;
}

/** `turn/plan/updated`. */
export interface TurnPlanUpdatedNotification {
  threadId: string;
  turnId: string;
  explanation?: string | null;
  plan: TurnPlanStep[];
}

export interface TurnPlanStep {
  step: string;
  status: 'pending' | 'inProgress' | 'completed';
}

/** `turn/diff/updated`. */
export interface TurnDiffUpdatedNotification {
  threadId: string;
  turnId: string;
  diff: string;
}

/** `error`. */
export interface ErrorNotification {
  error: TurnError;
  willRetry: boolean;
  threadId: string;
  turnId: string;
}

/** `warning`. */
export interface WarningNotification {
  threadId?: string | null;
  message: string;
}

// ─── 4. Server → Client Request Payloads ─────────────────────────

/** `item/commandExecution/requestApproval`. */
export interface CommandExecutionRequestApprovalParams {
  threadId: string;
  turnId: string;
  itemId: string;
  command?: string;
  cwd?: string;
}

export type CommandExecutionApprovalDecision =
  | 'accept'
  | 'acceptForSession'
  | 'decline'
  | 'cancel';

export interface CommandExecutionRequestApprovalResponse {
  decision: CommandExecutionApprovalDecision;
}

/** `item/fileChange/requestApproval`. */
export interface FileChangeRequestApprovalParams {
  threadId: string;
  turnId: string;
  itemId: string;
}

export interface FileChangeRequestApprovalResponse {
  decision: 'accept' | 'acceptForSession' | 'decline' | 'cancel';
}

/** `item/permissions/requestApproval`. */
export interface PermissionsRequestApprovalParams {
  threadId: string;
  turnId: string;
  itemId: string;
}

export interface PermissionsRequestApprovalResponse {
  decision: 'accept' | 'decline' | 'cancel';
}

// ─── 5. ThreadItem Discriminated Union ───────────────────────────

/**
 * Subset of the canonical `ThreadItem` enum. We model the variants the
 * panel renders today; unknown variants pass through with `type` and
 * are gracefully degraded by the adapter.
 */
export type ThreadItem =
  | UserMessageItem
  | AgentMessageItem
  | ReasoningItem
  | PlanItem
  | CommandExecutionItem
  | FileChangeItem
  | McpToolCallItem
  | DynamicToolCallItem
  | WebSearchItem
  | ImageViewItem
  | ContextCompactionItem
  | { type: string; id: string; [extra: string]: unknown };

export interface UserMessageItem {
  type: 'userMessage';
  id: string;
  content: UserInput[];
}

export interface AgentMessageItem {
  type: 'agentMessage';
  id: string;
  text: string;
  phase?: string | null;
}

export interface ReasoningItem {
  type: 'reasoning';
  id: string;
  summary?: string[];
  content?: string[];
}

export interface PlanItem {
  type: 'plan';
  id: string;
  text: string;
}

export type CommandExecutionStatus = string;

export interface CommandExecutionItem {
  type: 'commandExecution';
  id: string;
  command: string;
  cwd: string;
  processId?: string | null;
  status: CommandExecutionStatus;
  /** Best-effort parsing of the command. */
  commandActions?: unknown[];
  /** Combined stdout+stderr, plain text. */
  aggregatedOutput?: string | null;
  exitCode?: number | null;
  durationMs?: number | null;
}

export type PatchApplyStatus = string;

export interface FileChangeItem {
  type: 'fileChange';
  id: string;
  changes: Array<{
    path: string;
    /** Variant discriminator: `add` / `delete` / `update` / `move`. */
    type: string;
    /** Unified diff text when present. */
    unifiedDiff?: string | null;
    [extra: string]: unknown;
  }>;
  status: PatchApplyStatus;
}

export type McpToolCallStatus = string;

export interface McpToolCallItem {
  type: 'mcpToolCall';
  id: string;
  server: string;
  tool: string;
  status: McpToolCallStatus;
  arguments?: unknown;
  result?: unknown;
  error?: unknown;
  durationMs?: number | null;
}

export type DynamicToolCallStatus = string;

export interface DynamicToolCallItem {
  type: 'dynamicToolCall';
  id: string;
  namespace?: string | null;
  tool: string;
  arguments?: unknown;
  status: DynamicToolCallStatus;
  contentItems?: unknown[];
  success?: boolean | null;
  durationMs?: number | null;
}

export interface WebSearchItem {
  type: 'webSearch';
  id: string;
  query: string;
  action?: unknown;
}

export interface ImageViewItem {
  type: 'imageView';
  id: string;
  path: string;
}

export interface ContextCompactionItem {
  type: 'contextCompaction';
  id: string;
}

// ─── 6. JSONL On-Disk Types (legacy fallback) ────────────────────

/**
 * Codex persists every session to `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`.
 * The Termy panel prefers the live `thread/list` RPC, but we keep the on-disk
 * reader as a fallback when the daemon cannot be spawned.
 */

export interface SessionMetaLine {
  type: 'session_meta';
  timestamp?: string;
  payload: {
    id: string;
    cwd: string;
    cli_version?: string;
    instructions?: string;
    [extra: string]: unknown;
  };
}

export interface ResponseItemLine {
  type: 'response_item';
  timestamp?: string;
  payload: {
    type: string;
    id?: string;
    role?: string;
    /** Codex content blocks: `'input_text'` (user/dev), `'output_text'` (assistant), or generic `'text'`. */
    content?: Array<{ type: string; text?: string; [extra: string]: unknown }> | null;
    /** Reasoning summary blocks (`type: 'summary_text'`). */
    summary?: Array<{ type: string; text?: string; [extra: string]: unknown }>;
    name?: string;
    arguments?: string;
    call_id?: string;
    output?: string;
    success?: boolean;
    [extra: string]: unknown;
  };
}

export interface EventMsgLine {
  type: 'event_msg';
  timestamp?: string;
  payload: {
    type: string;
    message?: string;
    role?: string;
    [extra: string]: unknown;
  };
}

export interface CompactedLine {
  type: 'compacted';
  timestamp?: string;
  payload: {
    replacement_history: ResponseItemLine[];
  };
}

export type CodexJsonlLine = SessionMetaLine | ResponseItemLine | EventMsgLine | CompactedLine;
