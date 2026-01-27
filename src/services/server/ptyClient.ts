/**
 * PtyClient - PTY 模块客户端 (多会话支持)
 * 
 * 提供终端会话管理功能，支持多个独立的 PTY 会话。
 * 每个终端实例对应一个独立的 session_id，事件通过会话级别 API 分发。
 */

import { ModuleClient } from './moduleClient';
import type { PtyConfig, ServerMessage, SessionEventListeners } from './types';
import { debugLog, errorLog } from '@/utils/logger';

/**
 * PTY 模块客户端
 */
export class PtyClient extends ModuleClient {
  /** 会话级别事件监听器: sessionId -> event -> handlers */
  private sessionListeners: Map<string, SessionEventListeners> = new Map();
  
  /** 等待 init_complete 响应的 Promise resolver */
  private initResolvers: Map<string, { resolve: (sessionId: string) => void; reject: (error: Error) => void }> = new Map();
  
  /** 临时存储 init 请求的 ID，用于关联响应 */
  private pendingInitId: string | null = null;

  constructor() {
    super('pty');
  }

  /**
   * 初始化 PTY 会话
   * 
   * @param config PTY 配置
   * @returns Promise<string> 返回 session_id
   */
  async init(config: PtyConfig = {}): Promise<string> {
    return new Promise((resolve, reject) => {
      // 生成临时 ID 用于关联响应
      const tempId = `init-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      this.pendingInitId = tempId;
      
      // 设置超时
      const timeout = setTimeout(() => {
        this.initResolvers.delete(tempId);
        if (this.pendingInitId === tempId) {
          this.pendingInitId = null;
        }
        reject(new Error('PTY init timeout'));
      }, 30000);
      
      // 包装 resolver 以清除超时
      const wrappedResolve = (sessionId: string) => {
        clearTimeout(timeout);
        this.initResolvers.delete(tempId);
        if (this.pendingInitId === tempId) {
          this.pendingInitId = null;
        }
        resolve(sessionId);
      };
      
      const wrappedReject = (error: Error) => {
        clearTimeout(timeout);
        this.initResolvers.delete(tempId);
        if (this.pendingInitId === tempId) {
          this.pendingInitId = null;
        }
        reject(error);
      };
      
      this.initResolvers.set(tempId, { resolve: wrappedResolve, reject: wrappedReject });
      
      // 发送 init 消息
      this.send('init', {
        shell_type: config.shell_type,
        shell_args: config.shell_args,
        cwd: config.cwd,
        env: config.env,
        cols: config.cols,
        rows: config.rows,
      });
    });
  }

  /**
   * 调整终端尺寸
   * 
   * @param sessionId 会话 ID
   * @param cols 列数
   * @param rows 行数
   */
  resize(sessionId: string, cols: number, rows: number): void {
    this.send('resize', { session_id: sessionId, cols, rows });
  }

  /**
   * 写入文本数据
   * 
   * @param sessionId 会话 ID
   * @param data 文本数据
   */
  write(sessionId: string, data: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    // PTY 文本输入：格式为 [session_id_length][session_id][data]
    const sessionIdBytes = new TextEncoder().encode(sessionId);
    const dataBytes = new TextEncoder().encode(data);
    
    // 构建二进制帧
    const frame = new Uint8Array(1 + sessionIdBytes.length + dataBytes.length);
    frame[0] = sessionIdBytes.length;
    frame.set(sessionIdBytes, 1);
    frame.set(dataBytes, 1 + sessionIdBytes.length);
    
    this.ws.send(frame);
  }

  /**
   * 写入二进制数据
   * 
   * @param sessionId 会话 ID
   * @param data 二进制数据
   */
  writeBinary(sessionId: string, data: Uint8Array | ArrayBuffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    
    const sessionIdBytes = new TextEncoder().encode(sessionId);
    const dataArray = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    
    // 构建二进制帧
    const frame = new Uint8Array(1 + sessionIdBytes.length + dataArray.length);
    frame[0] = sessionIdBytes.length;
    frame.set(sessionIdBytes, 1);
    frame.set(dataArray, 1 + sessionIdBytes.length);
    
    this.ws.send(frame);
  }

  /**
   * 销毁指定会话
   * 
   * @param sessionId 会话 ID
   */
  destroySession(sessionId: string): void {
    this.send('destroy', { session_id: sessionId });
    // 清理该会话的监听器
    this.sessionListeners.delete(sessionId);
  }

  // ==================== 会话级别事件注册 ====================

  /**
   * 注册会话级别的输出处理器
   * 
   * @param sessionId 会话 ID
   * @param handler 输出处理器
   * @returns 取消注册的函数
   */
  onSessionOutput(sessionId: string, handler: (data: Uint8Array) => void): () => void {
    return this.onSession(sessionId, 'output', handler);
  }

  /**
   * 注册会话级别的退出处理器
   * 
   * @param sessionId 会话 ID
   * @param handler 退出处理器
   * @returns 取消注册的函数
   */
  onSessionExit(sessionId: string, handler: (code: number) => void): () => void {
    return this.onSession(sessionId, 'exit', handler);
  }

  /**
   * 注册会话级别的错误处理器
   * 
   * @param sessionId 会话 ID
   * @param handler 错误处理器
   * @returns 取消注册的函数
   */
  onSessionError(sessionId: string, handler: (code: string, message: string) => void): () => void {
    return this.onSession(sessionId, 'error', handler);
  }

  /**
   * 注册会话级别事件监听器
   */
  private onSession<K extends keyof SessionEventListeners>(
    sessionId: string,
    event: K,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: any
  ): () => void {
    if (!this.sessionListeners.has(sessionId)) {
      this.sessionListeners.set(sessionId, {
        output: new Set(),
        exit: new Set(),
        error: new Set(),
      });
    }
    
    const listeners = this.sessionListeners.get(sessionId)!;
    listeners[event].add(handler);
    
    return () => {
      const sessionListeners = this.sessionListeners.get(sessionId);
      if (sessionListeners) {
        sessionListeners[event].delete(handler);
      }
    };
  }

  /**
   * 触发会话级别事件 - output
   */
  private emitSessionOutput(sessionId: string, data: Uint8Array): void {
    const listeners = this.sessionListeners.get(sessionId);
    if (listeners) {
      listeners.output.forEach(handler => {
        try {
          handler(data);
        } catch (error) {
          errorLog(`[PtyClient] 会话事件处理器错误 (${sessionId}/output):`, error);
        }
      });
    }
  }

  /**
   * 触发会话级别事件 - exit
   */
  private emitSessionExit(sessionId: string, code: number): void {
    const listeners = this.sessionListeners.get(sessionId);
    if (listeners) {
      listeners.exit.forEach(handler => {
        try {
          handler(code);
        } catch (error) {
          errorLog(`[PtyClient] 会话事件处理器错误 (${sessionId}/exit):`, error);
        }
      });
    }
  }

  /**
   * 触发会话级别事件 - error
   */
  private emitSessionError(sessionId: string, code: string, message: string): void {
    const listeners = this.sessionListeners.get(sessionId);
    if (listeners) {
      listeners.error.forEach(handler => {
        try {
          handler(code, message);
        } catch (error) {
          errorLog(`[PtyClient] 会话事件处理器错误 (${sessionId}/error):`, error);
        }
      });
    }
  }

  /**
   * 处理服务器消息
   */
  protected onMessage(msg: ServerMessage): void {
    const sessionId = msg.session_id as string | undefined;
    
    switch (msg.type) {
      case 'init_complete':
        // 处理 init 响应
        if (sessionId && this.pendingInitId) {
          const resolver = this.initResolvers.get(this.pendingInitId);
          if (resolver) {
            if (msg.success) {
              resolver.resolve(sessionId);
            } else {
              resolver.reject(new Error(msg.message as string || 'PTY init failed'));
            }
          }
        }
        break;
        
      case 'output':
        // 输出数据 (JSON 格式的输出，二进制数据在 handleBinaryMessage 中处理)
        if (sessionId && msg.data) {
          const data = msg.data as number[];
          const uint8Data = new Uint8Array(data);
          this.emitSessionOutput(sessionId, uint8Data);
        }
        break;
        
      case 'exit':
        if (sessionId) {
          const code = (msg.code as number) || 0;
          this.emitSessionExit(sessionId, code);
          // 清理该会话的监听器
          this.sessionListeners.delete(sessionId);
        }
        break;
        
      case 'error':
        if (sessionId) {
          const code = msg.code as string;
          const message = msg.message as string;
          this.emitSessionError(sessionId, code, message);
        } else if (this.pendingInitId) {
          // init 错误
          const resolver = this.initResolvers.get(this.pendingInitId);
          if (resolver) {
            resolver.reject(new Error(msg.message as string || 'PTY error'));
          }
        }
        break;
    }
  }

  /**
   * 处理二进制消息 (PTY 输出)
   * 由 ServerManager 调用
   * 
   * 帧格式: [session_id_length: u8][session_id: bytes][data: bytes]
   */
  handleBinaryMessage(data: ArrayBuffer): void {
    const bytes = new Uint8Array(data);
    
    if (bytes.length < 2) {
      errorLog('[PtyClient] 二进制消息太短');
      return;
    }
    
    // 解析 session_id
    const sessionIdLength = bytes[0];
    if (bytes.length < 1 + sessionIdLength) {
      errorLog('[PtyClient] 二进制消息格式错误: session_id 长度不足');
      return;
    }
    
    const sessionIdBytes = bytes.slice(1, 1 + sessionIdLength);
    const sessionId = new TextDecoder().decode(sessionIdBytes);
    
    // 提取数据
    const outputData = bytes.slice(1 + sessionIdLength);
    
    debugLog(`[PtyClient] 收到会话 ${sessionId} 的输出, 长度: ${outputData.length}`);
    
    // 触发会话级别事件
    this.emitSessionOutput(sessionId, outputData);
  }

  /**
   * 清理资源
   */
  override destroy(): void {
    this.sessionListeners.clear();
    this.initResolvers.clear();
    this.pendingInitId = null;
    super.destroy();
  }
}
