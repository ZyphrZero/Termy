/**
 * ModuleClient - base module client class
 * 
 * Provides the core functionality for communicating with the unified server
 */

import type { ModuleType, ClientMessage, ServerMessage } from './types';
import { debugLog, errorLog } from '@/utils/logger';

/**
 * Message handler type
 */
export type MessageHandler = (msg: ServerMessage) => void;

/**
 * Base module client class
 * 
 * Module-specific clients extend this class to implement their own functionality
 */
export abstract class ModuleClient {
  /** Module type */
  protected readonly module: ModuleType;
  
  /** WebSocket connection (injected by ServerManager) */
  protected ws: WebSocket | null = null;
  
  /** Message handlers */
  private messageHandlers: Set<MessageHandler> = new Set();

  constructor(module: ModuleType) {
    this.module = module;
  }

  /**
   * Set the WebSocket connection
   * Called by ServerManager
   */
  setWebSocket(ws: WebSocket | null): void {
    this.ws = ws;
    
    if (ws) {
      debugLog(`[${this.module}Client] WebSocket 已设置`);
    }
  }

  /**
   * Check whether connected
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Send a message to the server
   * 
   * @param type Message type
   * @param payload Message payload
   */
  protected send(type: string, payload: Record<string, unknown> = {}): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      errorLog(`[${this.module}Client] WebSocket 未连接，无法发送消息`);
      return;
    }

    const message: ClientMessage = {
      module: this.module,
      type,
      ...payload
    };

    try {
      this.ws.send(JSON.stringify(message));
      debugLog(`[${this.module}Client] 发送消息:`, type);
    } catch (error) {
      errorLog(`[${this.module}Client] 发送消息失败:`, error);
    }
  }

  /**
   * Send binary data
   * 
   * @param data Binary data
   */
  protected sendBinary(data: ArrayBuffer | Uint8Array): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      errorLog(`[${this.module}Client] WebSocket 未连接，无法发送二进制数据`);
      return;
    }

    try {
      this.ws.send(data);
    } catch (error) {
      errorLog(`[${this.module}Client] 发送二进制数据失败:`, error);
    }
  }

  /**
   * Handle messages from the server
   * Called by ServerManager
   * 
   * @param msg Server message
   */
  handleMessage(msg: ServerMessage): void {
    // Only handle messages for this module
    if (msg.module !== this.module) {
      return;
    }

    // Call all registered handlers
    this.messageHandlers.forEach(handler => {
      try {
        handler(msg);
      } catch (error) {
        errorLog(`[${this.module}Client] 消息处理器错误:`, error);
      }
    });

    // Call the subclass message handler
    this.onMessage(msg);
  }

  /**
   * Register a message handler
   * 
   * @param handler Message handler
   * @returns Unregister function
   */
  protected addMessageHandler(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  /**
   * Message handler implemented by subclasses
   * 
   * @param msg Server message
   */
  protected abstract onMessage(msg: ServerMessage): void;

  /**
   * Clean up resources
   */
  destroy(): void {
    this.messageHandlers.clear();
    this.ws = null;
  }
}
