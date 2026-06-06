/**
 * Wire-level types for the Agent Client Protocol (ACP) messages
 * Termy needs.
 *
 * We intentionally model only the subset Termy uses today. Unsupported
 * ACP variants are surfaced as explicit adapter errors so protocol
 * drift is visible during debugging instead of being silently hidden.
 *
 * Reference: https://agentclientprotocol.com/protocol/overview and
 * https://agentclientprotocol.com/protocol/schema
 */

/** Latest protocol major version this client understands. */
export const ACP_LATEST_PROTOCOL_VERSION = 1 as const;

/** JSON-RPC method names used by the client side of ACP. */
export const ACP_METHODS = {
  initialize: 'initialize',
  authenticate: 'authenticate',
  newSession: 'session/new',
  listSessions: 'session/list',
  loadSession: 'session/load',
  prompt: 'session/prompt',
  cancel: 'session/cancel',
  // Notifications received from the agent.
  sessionUpdate: 'session/update',
  requestPermission: 'session/request_permission',
} as const;

/* -----------------------------------------------------------------
 * Initialize
 * ---------------------------------------------------------------*/

export interface AcpInitializeParams {
  protocolVersion: number;
  clientCapabilities?: AcpClientCapabilities;
  clientInfo?: AcpImplementationInfo;
}

export interface AcpInitializeResult {
  protocolVersion: number;
  agentCapabilities?: AcpAgentCapabilities;
  agentInfo?: AcpImplementationInfo;
  authMethods?: AcpAuthMethod[];
}

export interface AcpImplementationInfo {
  name: string;
  title?: string;
  version?: string;
}

/**
 * Termy advertises a deliberately small capability surface for the
 * first iteration. We do **not** offer file-system or terminal
 * access yet — the vault root is not always equal to the agent's
 * working directory, and the safer default is to let the agent use
 * its own filesystem and process APIs. A later iteration will gate
 * these behind an opt-in setting.
 */
export interface AcpClientCapabilities {
  fs?: {
    readTextFile?: boolean;
    writeTextFile?: boolean;
  };
  terminal?: boolean;
}

export interface AcpAgentCapabilities {
  loadSession?: boolean;
  promptCapabilities?: {
    image?: boolean;
    audio?: boolean;
    embeddedContext?: boolean;
  };
  mcpCapabilities?: {
    http?: boolean;
    sse?: boolean;
  };
}

export interface AcpAuthMethod {
  id: string;
  name?: string;
  description?: string;
}

/* -----------------------------------------------------------------
 * Sessions
 * ---------------------------------------------------------------*/

export interface AcpNewSessionParams {
  /**
   * Absolute working directory for the session. Termy passes the
   * vault root by default — this is the same folder we already use
   * as `cwd` for AI launcher terminals, so context stays consistent.
   */
  cwd: string;
  mcpServers?: AcpMcpServerConfig[];
}

export interface AcpMcpServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Array<{ name: string; value: string }>;
}

export interface AcpNewSessionResult {
  sessionId: string;
}

export interface AcpListSessionsParams {
  cwd?: string;
  cursor?: string;
}

export interface AcpSessionInfo {
  sessionId: string;
  cwd: string;
  title?: string;
  updatedAt?: string;
}

export interface AcpListSessionsResult {
  sessions: AcpSessionInfo[];
  nextCursor?: string;
}

export interface AcpLoadSessionParams {
  /**
   * ID of the persisted conversation to restore. The agent replays
   * its history through `session/update` before responding.
   */
  sessionId: string;
  /** Absolute working directory for this restored session. */
  cwd: string;
  mcpServers: AcpMcpServerConfig[];
}

export interface AcpLoadSessionResult {
  configOptions?: unknown[] | null;
  modes?: Record<string, unknown> | null;
}

export type AcpStopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'max_turn_requests'
  | 'refusal'
  | 'cancelled';

export interface AcpPromptParams {
  sessionId: string;
  prompt: AcpContentBlock[];
}

export interface AcpPromptResult {
  stopReason: AcpStopReason;
}

export interface AcpCancelParams {
  sessionId: string;
}

/* -----------------------------------------------------------------
 * Content blocks (subset)
 * ---------------------------------------------------------------*/

export type AcpContentBlock =
  | AcpTextBlock
  | AcpResourceLinkBlock
  | AcpResourceBlock
  | AcpImageBlock
  | AcpAudioBlock;

export interface AcpTextBlock {
  type: 'text';
  text: string;
}

export interface AcpResourceLinkBlock {
  type: 'resource_link';
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

export interface AcpResourceBlock {
  type: 'resource';
  resource: {
    uri: string;
    mimeType?: string;
    text?: string;
  };
}

export interface AcpImageBlock {
  type: 'image';
  data: string;
  mimeType: string;
}

export interface AcpAudioBlock {
  type: 'audio';
  data: string;
  mimeType: string;
}

/* -----------------------------------------------------------------
 * session/update notification
 * ---------------------------------------------------------------*/

export type AcpSessionUpdate =
  | AcpAgentMessageChunkUpdate
  | AcpAgentThoughtChunkUpdate
  | AcpUserMessageChunkUpdate
  | AcpToolCallUpdate
  | AcpToolCallProgressUpdate
  | AcpPlanUpdate
  | AcpAvailableCommandsUpdate
  | AcpModeUpdate;

export interface AcpSessionUpdateNotification {
  sessionId: string;
  update: AcpSessionUpdate;
}

export interface AcpAgentMessageChunkUpdate {
  sessionUpdate: 'agent_message_chunk';
  content: AcpContentBlock;
}

export interface AcpAgentThoughtChunkUpdate {
  sessionUpdate: 'agent_thought_chunk';
  content: AcpContentBlock;
}

export interface AcpUserMessageChunkUpdate {
  sessionUpdate: 'user_message_chunk';
  content: AcpContentBlock;
}

export interface AcpToolCallUpdate {
  sessionUpdate: 'tool_call';
  toolCallId: string;
  title: string;
  kind?: AcpToolKind;
  status?: AcpToolStatus;
  rawInput?: unknown;
  content?: AcpToolCallContent[];
  locations?: AcpToolCallLocation[];
}

export interface AcpToolCallProgressUpdate {
  sessionUpdate: 'tool_call_update';
  toolCallId: string;
  status?: AcpToolStatus;
  title?: string;
  content?: AcpToolCallContent[];
  rawOutput?: unknown;
  locations?: AcpToolCallLocation[];
}

export interface AcpPlanUpdate {
  sessionUpdate: 'plan';
  entries: AcpPlanEntry[];
}

export interface AcpAvailableCommandsUpdate {
  sessionUpdate: 'available_commands_update';
  availableCommands: Array<{ name: string; description?: string }>;
}

export interface AcpModeUpdate {
  sessionUpdate: 'current_mode_update';
  modeId: string;
}

export interface AcpPlanEntry {
  content: string;
  priority?: 'low' | 'medium' | 'high';
  status?: 'pending' | 'in_progress' | 'completed' | 'failed';
}

export type AcpToolStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';

export type AcpToolKind =
  | 'read'
  | 'edit'
  | 'delete'
  | 'move'
  | 'search'
  | 'execute'
  | 'think'
  | 'fetch'
  | 'other';

export type AcpToolCallContent =
  | { type: 'content'; content: AcpContentBlock }
  | { type: 'diff'; path: string; oldText?: string | null; newText: string }
  | { type: 'terminal'; terminalId: string };

export interface AcpToolCallLocation {
  path: string;
  line?: number;
}

/* -----------------------------------------------------------------
 * session/request_permission
 * ---------------------------------------------------------------*/

export interface AcpPermissionRequestParams {
  sessionId: string;
  toolCall?: AcpToolCallUpdate;
  options: AcpPermissionOption[];
}

export interface AcpPermissionOption {
  optionId: string;
  name: string;
  kind?: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';
}

export interface AcpPermissionResult {
  outcome:
    | { kind: 'selected'; optionId: string }
    | { kind: 'cancelled' };
}
