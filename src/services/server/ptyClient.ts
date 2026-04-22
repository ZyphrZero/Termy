/**
 * PtyClient - PTY module client (multi-session support)
 * 
 * Provides terminal session management with support for multiple independent PTY sessions.
 * Each terminal instance maps to an independent session_id, and events are dispatched through the session-scoped API.
 */

import { ModuleClient } from './moduleClient';
import type {
  PtyConfig,
  ServerMessage,
  SessionEventListeners,
  ShellEvent,
  ShellEventSource,
  ShellEventType,
} from './types';
import { debugLog, errorLog } from '@/utils/logger';

type SessionEventHandler<K extends keyof SessionEventListeners> =
  SessionEventListeners[K] extends Set<infer Handler> ? Handler : never;

/**
 * PTY module client
 */
export class PtyClient extends ModuleClient {
  /** Session-scoped event listeners: sessionId -> event -> handlers */
  private sessionListeners: Map<string, SessionEventListeners> = new Map();
  
  /** Promise resolvers waiting for init_complete responses */
  private initResolvers: Map<string, { resolve: (sessionId: string) => void; reject: (error: Error) => void }> = new Map();
  
  /** Temporarily stores the init request ID for response correlation */
  private pendingInitId: string | null = null;

  constructor() {
    super('pty');
  }

  /**
   * Initialize a PTY session
   * 
   * @param config PTY config
   * @returns Promise<string> Returns session_id
   */
  async init(config: PtyConfig = {}): Promise<string> {
    return new Promise((resolve, reject) => {
      // Generate a temporary ID for correlating the response
      const tempId = `init-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      this.pendingInitId = tempId;
      
      // Set timeout
      const timeout = setTimeout(() => {
        this.initResolvers.delete(tempId);
        if (this.pendingInitId === tempId) {
          this.pendingInitId = null;
        }
        reject(new Error('PTY init timeout'));
      }, 30000);
      
      // Wrap resolvers so the timeout is cleared
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
      
      // Send init message
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
   * Resize the terminal
   * 
   * @param sessionId Session ID
   * @param cols Number of columns
   * @param rows Number of rows
   */
  resize(sessionId: string, cols: number, rows: number): void {
    this.send('resize', { session_id: sessionId, cols, rows });
  }

  /**
   * Write text data
   * 
   * @param sessionId Session ID
   * @param data Text data
   */
  write(sessionId: string, data: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    // PTY text input: format [session_id_length][session_id][data]
    const sessionIdBytes = new TextEncoder().encode(sessionId);
    const dataBytes = new TextEncoder().encode(data);
    
    // Build the binary frame
    const frame = new Uint8Array(1 + sessionIdBytes.length + dataBytes.length);
    frame[0] = sessionIdBytes.length;
    frame.set(sessionIdBytes, 1);
    frame.set(dataBytes, 1 + sessionIdBytes.length);
    
    this.ws.send(frame);
  }

  /**
   * Write binary data
   * 
   * @param sessionId Session ID
   * @param data Binary data
   */
  writeBinary(sessionId: string, data: Uint8Array | ArrayBuffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    
    const sessionIdBytes = new TextEncoder().encode(sessionId);
    const dataArray = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    
    // Build the binary frame
    const frame = new Uint8Array(1 + sessionIdBytes.length + dataArray.length);
    frame[0] = sessionIdBytes.length;
    frame.set(sessionIdBytes, 1);
    frame.set(dataArray, 1 + sessionIdBytes.length);
    
    this.ws.send(frame);
  }

  /**
   * Destroy the specified session
   * 
   * @param sessionId Session ID
   */
  destroySession(sessionId: string): void {
    this.send('destroy', { session_id: sessionId });
    // Clear listeners for this session
    this.sessionListeners.delete(sessionId);
  }

  // ==================== Session-scoped event registration ====================

  /**
   * Register a session-scoped output handler
   * 
   * @param sessionId Session ID
   * @param handler Output handler
   * @returns Unregister function
   */
  onSessionOutput(sessionId: string, handler: (data: Uint8Array) => void): () => void {
    return this.onSession(sessionId, 'output', handler);
  }

  /**
   * Register a session-scoped exit handler
   * 
   * @param sessionId Session ID
   * @param handler Exit handler
   * @returns Unregister function
   */
  onSessionExit(sessionId: string, handler: (code: number) => void): () => void {
    return this.onSession(sessionId, 'exit', handler);
  }

  /**
   * Register a session-scoped error handler
   * 
   * @param sessionId Session ID
   * @param handler Error handler
   * @returns Unregister function
   */
  onSessionError(sessionId: string, handler: (code: string, message: string) => void): () => void {
    return this.onSession(sessionId, 'error', handler);
  }

  /**
   * Register a session-scoped Shell integration event handler
   * 
   * @param sessionId Session ID
   * @param handler Shell event handler
   * @returns Unregister function
   */
  onSessionShellEvent(sessionId: string, handler: (event: ShellEvent) => void): () => void {
    return this.onSession(sessionId, 'shellEvent', handler);
  }

  /**
   * Register a session-scoped event listener
   */
  private onSession<K extends keyof SessionEventListeners>(
    sessionId: string,
    event: K,
    handler: SessionEventHandler<K>
  ): () => void {
    if (!this.sessionListeners.has(sessionId)) {
      this.sessionListeners.set(sessionId, {
        output: new Set(),
        exit: new Set(),
        error: new Set(),
        shellEvent: new Set(),
      });
    }
    
    const listeners = this.sessionListeners.get(sessionId)!;
    // Use the event type to select the handler set and avoid union inference collapsing into an intersection signature
    const eventListeners = listeners[event] as Set<SessionEventHandler<K>>;
    eventListeners.add(handler);
    
    return () => {
      const sessionListeners = this.sessionListeners.get(sessionId);
      if (sessionListeners) {
        const eventListeners = sessionListeners[event] as Set<SessionEventHandler<K>>;
        eventListeners.delete(handler);
      }
    };
  }

  /**
   * Emit a session-scoped event - output
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
   * Emit a session-scoped event - exit
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
   * Emit a session-scoped event - error
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
   * Emit a session-scoped event - shell_event
   */
  private emitSessionShellEvent(sessionId: string, event: ShellEvent): void {
    const listeners = this.sessionListeners.get(sessionId);
    if (listeners) {
      listeners.shellEvent.forEach(handler => {
        try {
          handler(event);
        } catch (error) {
          errorLog(`[PtyClient] 会话事件处理器错误 (${sessionId}/shell_event):`, error);
        }
      });
    }
  }

  /**
   * Handle server messages
   */
  protected onMessage(msg: ServerMessage): void {
    const sessionId = msg.session_id as string | undefined;
    
    switch (msg.type) {
      case 'init_complete':
        // Handle init response
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
        // Output data (JSON-formatted output; binary data is handled in handleBinaryMessage)
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
          // Clear listeners for this session
          this.sessionListeners.delete(sessionId);
        }
        break;
        
      case 'error':
        if (sessionId) {
          const code = msg.code as string;
          const message = msg.message as string;
          this.emitSessionError(sessionId, code, message);
        } else if (this.pendingInitId) {
          // init error
          const resolver = this.initResolvers.get(this.pendingInitId);
          if (resolver) {
            resolver.reject(new Error(msg.message as string || 'PTY error'));
          }
        }
        break;

      case 'shell_event':
        if (sessionId && msg.event) {
          const type = msg.event as ShellEventType;
          const source = (msg.source as ShellEventSource) || 'osc133';
          const exitCode = typeof msg.exit_code === 'number' ? msg.exit_code : null;
          this.emitSessionShellEvent(sessionId, { type, source, exitCode });
        }
        break;
    }
  }

  /**
   * Handle binary messages (PTY output)
   * Called by ServerManager
   * 
   * Frame format: [session_id_length: u8][session_id: bytes][data: bytes]
   */
  handleBinaryMessage(data: ArrayBuffer): void {
    const bytes = new Uint8Array(data);
    
    if (bytes.length < 2) {
      errorLog('[PtyClient] 二进制消息太短');
      return;
    }
    
    // Parse session_id
    const sessionIdLength = bytes[0];
    if (bytes.length < 1 + sessionIdLength) {
      errorLog('[PtyClient] 二进制消息格式错误: session_id 长度不足');
      return;
    }
    
    const sessionIdBytes = bytes.slice(1, 1 + sessionIdLength);
    const sessionId = new TextDecoder().decode(sessionIdBytes);
    
    // Extract data
    const outputData = bytes.slice(1 + sessionIdLength);
    
    debugLog(`[PtyClient] 收到会话 ${sessionId} 的输出, 长度: ${outputData.length}`);
    
    // Emit the session-scoped event
    this.emitSessionOutput(sessionId, outputData);
  }

  /**
   * Clean up resources
   */
  override destroy(): void {
    this.sessionListeners.clear();
    this.initResolvers.clear();
    this.pendingInitId = null;
    super.destroy();
  }
}
