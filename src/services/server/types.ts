/**
 * 统一服务器类型定义
 * 
 * 定义 ServerManager 和各模块客户端使用的类型
 */

// ============================================================================
// 模块类型
// ============================================================================

/**
 * 模块类型
 * 与 Rust 端 ModuleType 保持一致
 */
export type ModuleType = 'pty';

// ============================================================================
// 服务器信息
// ============================================================================

/**
 * 服务器信息
 */
export interface ServerInfo {
  /** 监听端口 */
  port: number;
  /** 进程 PID */
  pid: number;
}

// ============================================================================
// 统一消息协议
// ============================================================================

/**
 * 客户端发送的消息基础格式
 */
export interface ClientMessage {
  /** 目标模块 */
  module: ModuleType;
  /** 消息类型 */
  type: string;
  /** 其他字段 */
  [key: string]: unknown;
}

/**
 * 服务器响应消息基础格式
 */
export interface ServerMessage {
  /** 来源模块 */
  module: ModuleType;
  /** 消息类型 */
  type: string;
  /** 其他字段 */
  [key: string]: unknown;
}

// ============================================================================
// 错误类型
// ============================================================================

/**
 * 服务器错误码
 */
export enum ServerErrorCode {
  /** 二进制文件未找到 */
  BINARY_NOT_FOUND = 'BINARY_NOT_FOUND',
  /** 服务器启动失败 */
  SERVER_START_FAILED = 'SERVER_START_FAILED',
  /** 连接失败 */
  CONNECTION_FAILED = 'CONNECTION_FAILED',
  /** 服务器崩溃 */
  SERVER_CRASHED = 'SERVER_CRASHED',
  /** WebSocket 错误 */
  WEBSOCKET_ERROR = 'WEBSOCKET_ERROR',
  /** 消息发送失败 */
  SEND_FAILED = 'SEND_FAILED',
}

/**
 * 服务器管理器错误
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
// 事件类型
// ============================================================================

/**
 * 服务器事件映射
 */
export interface ServerEvents {
  /** 服务器已启动 */
  'server-started': (port: number) => void;
  /** 服务器已停止 */
  'server-stopped': () => void;
  /** 服务器错误 */
  'server-error': (error: Error) => void;
  /** WebSocket 已连接 */
  'ws-connected': () => void;
  /** WebSocket 已断开 */
  'ws-disconnected': () => void;
  /** WebSocket 正在重连 */
  'ws-reconnecting': (attempt: number, delay: number) => void;
  /** WebSocket 重连失败（达到最大重试次数） */
  'ws-reconnect-failed': () => void;
}

// ============================================================================
// PTY 模块类型
// ============================================================================

/**
 * PTY 配置
 */
export interface PtyConfig {
  /** Shell 类型 */
  shell_type?: string;
  /** Shell 参数 */
  shell_args?: string[];
  /** 工作目录 */
  cwd?: string;
  /** 环境变量 */
  env?: Record<string, string>;
  /** 列数 */
  cols?: number;
  /** 行数 */
  rows?: number;
}

/**
 * PTY 初始化响应
 */
export interface PtyInitResponse {
  /** 会话 ID */
  session_id: string;
  /** 是否成功 */
  success: boolean;
}

/**
 * 会话级别事件监听器
 */
export interface SessionEventListeners {
  /** 输出数据处理器 */
  output: Set<(data: Uint8Array) => void>;
  /** 退出处理器 */
  exit: Set<(code: number) => void>;
  /** 错误处理器 */
  error: Set<(code: string, message: string) => void>;
}
