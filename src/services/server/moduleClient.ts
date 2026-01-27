/**
 * ModuleClient - 模块客户端基类
 * 
 * 提供与统一服务器通信的基础功能
 */

import type { ModuleType, ClientMessage, ServerMessage } from './types';
import { debugLog, errorLog } from '@/utils/logger';

/**
 * 消息处理器类型
 */
export type MessageHandler = (msg: ServerMessage) => void;

/**
 * 模块客户端基类
 * 
 * 各模块客户端继承此类实现特定功能
 */
export abstract class ModuleClient {
  /** 模块类型 */
  protected readonly module: ModuleType;
  
  /** WebSocket 连接 (由 ServerManager 注入) */
  protected ws: WebSocket | null = null;
  
  /** 消息处理器 */
  private messageHandlers: Set<MessageHandler> = new Set();
  
  /** 是否已初始化 */
  private initialized = false;

  constructor(module: ModuleType) {
    this.module = module;
  }

  /**
   * 设置 WebSocket 连接
   * 由 ServerManager 调用
   */
  setWebSocket(ws: WebSocket | null): void {
    this.ws = ws;
    this.initialized = ws !== null;
    
    if (ws) {
      debugLog(`[${this.module}Client] WebSocket 已设置`);
    }
  }

  /**
   * 检查是否已连接
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * 发送消息到服务器
   * 
   * @param type 消息类型
   * @param payload 消息负载
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
   * 发送二进制数据
   * 
   * @param data 二进制数据
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
   * 处理来自服务器的消息
   * 由 ServerManager 调用
   * 
   * @param msg 服务器消息
   */
  handleMessage(msg: ServerMessage): void {
    // 只处理属于本模块的消息
    if (msg.module !== this.module) {
      return;
    }

    // 调用所有注册的处理器
    this.messageHandlers.forEach(handler => {
      try {
        handler(msg);
      } catch (error) {
        errorLog(`[${this.module}Client] 消息处理器错误:`, error);
      }
    });

    // 调用子类的消息处理方法
    this.onMessage(msg);
  }

  /**
   * 注册消息处理器
   * 
   * @param handler 消息处理器
   * @returns 取消注册的函数
   */
  protected addMessageHandler(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  /**
   * 子类实现的消息处理方法
   * 
   * @param msg 服务器消息
   */
  protected abstract onMessage(msg: ServerMessage): void;

  /**
   * 清理资源
   */
  destroy(): void {
    this.messageHandlers.clear();
    this.ws = null;
    this.initialized = false;
  }
}
