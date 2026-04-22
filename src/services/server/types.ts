/**
 * Unified server type definitions
 * 
 * Defines the types used by ServerManager and the module clients
 */

// ============================================================================
// Module types
// ============================================================================

/**
 * Module type
 * Must stay in sync with the Rust-side ModuleType
 */
export type ModuleType = 'pty';

// ============================================================================
// Server info
// ============================================================================

/**
 * Server info
 */
export interface ServerInfo {
  /** Listening port */
  port: number;
  /** Process PID */
  pid: number;
}

// ============================================================================
// Unified message protocol
// ============================================================================

/**
 * Base format for client-to-server messages
 */
export interface ClientMessage {
  /** Target module */
  module: ModuleType;
  /** Message type */
  type: string;
  /** Other fields */
  [key: string]: unknown;
}

/**
 * Base format for server response messages
 */
export interface ServerMessage {
  /** Source module */
  module: ModuleType;
  /** Message type */
  type: string;
  /** Other fields */
  [key: string]: unknown;
}

// ============================================================================
// Error types
// ============================================================================

/**
 * Server error codes
 */
export enum ServerErrorCode {
  /** Binary not found */
  BINARY_NOT_FOUND = 'BINARY_NOT_FOUND',
  /** Server start failed */
  SERVER_START_FAILED = 'SERVER_START_FAILED',
  /** Connection failed */
  CONNECTION_FAILED = 'CONNECTION_FAILED',
  /** Server crashed */
  SERVER_CRASHED = 'SERVER_CRASHED',
  /** WebSocket error */
  WEBSOCKET_ERROR = 'WEBSOCKET_ERROR',
  /** Message send failed */
  SEND_FAILED = 'SEND_FAILED',
}

/**
 * Server manager error
 */
export class ServerManagerError extends Error {
  constructor(
    public code: ServerErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'ServerManagerError';
  }
}

// ============================================================================
// Event types
// ============================================================================

/**
 * Server event map
 */
export interface ServerEvents {
  /** Server started */
  'server-started': (port: number) => void;
  /** Server stopped */
  'server-stopped': () => void;
  /** Server error */
  'server-error': (error: Error) => void;
  /** WebSocket connected */
  'ws-connected': () => void;
  /** WebSocket disconnected */
  'ws-disconnected': () => void;
  /** WebSocket reconnecting */
  'ws-reconnecting': (attempt: number, delay: number) => void;
  /** WebSocket reconnect failed (max retries reached) */
  'ws-reconnect-failed': () => void;
}

// ============================================================================
// PTY module types
// ============================================================================

/**
 * PTY config
 */
export interface PtyConfig {
  /** Shell type */
  shell_type?: string;
  /** Shell arguments */
  shell_args?: string[];
  /** Working directory */
  cwd?: string;
  /** Environment variables */
  env?: Record<string, string>;
  /** Columns */
  cols?: number;
  /** Rows */
  rows?: number;
}

/**
 * PTY init response
 */
export interface PtyInitResponse {
  /** Session ID */
  session_id: string;
  /** Success flag */
  success: boolean;
}

/**
 * Session-scoped event listeners
 */
export interface SessionEventListeners {
  /** Output data handlers */
  output: Set<(data: Uint8Array) => void>;
  /** Exit handlers */
  exit: Set<(code: number) => void>;
  /** Error handlers */
  error: Set<(code: string, message: string) => void>;
  /** Shell integration event handlers */
  shellEvent: Set<(event: ShellEvent) => void>;
}

/**
 * Shell integration event types
 */
export type ShellEventType = 'prompt_start' | 'command_start' | 'command_executed' | 'command_end';

/**
 * Shell integration event sources
 */
export type ShellEventSource = 'osc133' | 'osc633';

/**
 * Shell integration event
 */
export interface ShellEvent {
  type: ShellEventType;
  source: ShellEventSource;
  exitCode: number | null;
}
