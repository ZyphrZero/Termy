/**
 * ServerManager - 统一服务器管理器
 * 
 * 职责:
 * 1. 管理统一 Rust 服务器进程的生命周期
 * 2. 管理单一 WebSocket 连接
 * 3. 提供模块化 API (pty/voice/llm/utils)
 * 4. 处理服务器崩溃和自动重启
 * 
 */

import type { ChildProcess } from 'child_process';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { Notice } from 'obsidian';
import { debugLog, debugWarn, errorLog } from '@/utils/logger';
import { t } from '@/i18n';
import type { 
  ServerInfo, 
  ServerEvents,
  ServerMessage} from './types';
import { 
  ServerErrorCode, 
  ServerManagerError
} from './types';
import { PtyClient } from './ptyClient';
import { BinaryDownloader, DownloadProgress } from './binaryDownloader';

/**
 * 事件监听器类型
 */
type EventListener<K extends keyof ServerEvents> = ServerEvents[K];

/**
 * websocket重连配置
 */
interface ReconnectConfig {
  /** 最大重连次数 */
  maxAttempts: number;
  /** 重连间隔 (ms) */
  interval: number;
}

/**
 * 统一服务器管理器
 * 
 * 替代 BinaryManager + TerminalService + VoiceServerManager
 */
export class ServerManager {
  /** 插件目录 */
  private pluginDir: string;
  
  /** 插件版本 */
  private version: string;
  
  /** 调试模式（仅控制日志输出） */
  private debugMode: boolean;
  
  /** 离线模式（跳过版本检测和自动下载） */
  private offlineMode: boolean;
  
  /** 二进制下载器 */
  private binaryDownloader: BinaryDownloader;
  
  /** 服务器进程 */
  private process: ChildProcess | null = null;
  
  /** WebSocket 连接 */
  private ws: WebSocket | null = null;
  
  /** 服务器端口 */
  private port: number | null = null;
  
  /** 是否正在关闭 */
  private isShuttingDown = false;
  
  /** 服务器重启尝试次数 */
  private restartAttempts = 0;
  
  /** 最大服务器重启次数 */
  private readonly maxRestartAttempts = 3;
  
  /** WebSocket 重连尝试次数 */
  private wsReconnectAttempts = 0;
  
  /** 重连配置 */
  private reconnectConfig: ReconnectConfig = {
    maxAttempts: 5,
    interval: 3000,
  };
  
  /** 是否正在重连 */
  private isReconnecting = false;
  
  /** 重连定时器 */
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  
  /** 服务器启动 Promise */
  private serverStartPromise: Promise<void> | null = null;
  
  /** WebSocket 连接 Promise */
  private wsConnectPromise: Promise<void> | null = null;

  /** 二进制更新 Promise */
  private binaryUpdatePromise: Promise<void> | null = null;
  
  /** 事件监听器 */
  private eventListeners: Map<keyof ServerEvents, Set<EventListener<keyof ServerEvents>>> = new Map();
  
  // 模块客户端 (懒加载)
  private _ptyClient: PtyClient | null = null;

  constructor(
    pluginDir: string,
    version: string = '0.0.0',
    downloadAcceleratorUrl: string = '',
    debugMode: boolean = false,
    offlineMode: boolean = false
  ) {
    this.pluginDir = pluginDir;
    this.version = version;
    this.debugMode = debugMode;
    this.offlineMode = offlineMode;
    this.binaryDownloader = new BinaryDownloader(pluginDir, version, downloadAcceleratorUrl);
  }

  // ============================================================================
  // 公共 API
  // ============================================================================

  /**
   * 确保服务器运行
   * 

   */
  async ensureServer(): Promise<void> {
    // 如果服务器已经运行，直接返回
    if (this.port !== null && this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    // 如果正在启动，等待启动完成
    if (this.serverStartPromise) {
      return this.serverStartPromise;
    }

    // 启动服务器
    this.serverStartPromise = this.startServer();
    return this.serverStartPromise;
  }

  /**
   * 确保二进制文件已更新（不启动服务器）
   */
  async ensureBinaryUpdated(): Promise<void> {
    if (this.offlineMode) {
      debugLog('[ServerManager] 离线模式已开启，跳过二进制版本检查与下载');
      return;
    }
    await this.ensureBinaryReady();
  }

  /**
   * 获取 PTY 客户端
   * 

   */
  pty(): PtyClient {
    if (!this._ptyClient) {
      this._ptyClient = new PtyClient();
      if (this.ws) {
        this._ptyClient.setWebSocket(this.ws);
      }
    }
    return this._ptyClient;
  }

  /**
   * 关闭服务器
   * 

   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    
    debugLog('[ServerManager] 关闭服务器...');
    
    // 取消重连定时器
    this.cancelReconnect();
    
    // 关闭 WebSocket 连接
    if (this.ws) {
      try {
        this.ws.close(1000, 'Shutdown');
      } catch (error) {
        debugWarn('[ServerManager] 关闭 WebSocket 时出错:', error);
      }
      this.ws = null;
    }
    
    // 停止服务器进程
    if (this.process) {
      try {
        this.process.kill('SIGTERM');
        
        // 等待进程退出
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            if (this.process && !this.process.killed) {
              debugWarn('[ServerManager] 强制终止服务器');
              this.process.kill('SIGKILL');
            }
            resolve();
          }, 1000);

          if (this.process) {
            this.process.once('exit', () => {
              clearTimeout(timeout);
              resolve();
            });
          }
        });
      } catch (error) {
        errorLog('[ServerManager] 停止服务器时出错:', error);
      } finally {
        this.process = null;
      }
    }
    
    // 清理状态
    this.port = null;
    this.serverStartPromise = null;
    this.wsConnectPromise = null;
    
    // 销毁模块客户端
    this._ptyClient?.destroy();
    
    this._ptyClient = null;
    
    this.emit('server-stopped');
    
    debugLog('[ServerManager] 服务器已关闭');
  }

  /**
   * 服务器是否运行中
   */
  isServerRunning(): boolean {
    return this.port !== null && this.process !== null;
  }

  /**
   * WebSocket 是否已连接
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * 是否正在重连
   */
  isReconnectingWebSocket(): boolean {
    return this.isReconnecting;
  }

  /**
   * 获取 WebSocket 重连尝试次数
   */
  getReconnectAttempts(): number {
    return this.wsReconnectAttempts;
  }

  /**
   * 获取服务器端口
   */
  getServerPort(): number | null {
    return this.port;
  }

  /**
   * 注册事件监听器
   */
  on<K extends keyof ServerEvents>(event: K, callback: ServerEvents[K]): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(callback as EventListener<keyof ServerEvents>);
  }

  /**
   * 移除事件监听器
   */
  off<K extends keyof ServerEvents>(event: K, callback: ServerEvents[K]): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(callback as EventListener<keyof ServerEvents>);
    }
  }

  // ============================================================================
  // 私有方法
  // ============================================================================

  /**
   * 启动服务器
   */
  private async startServer(): Promise<void> {
    try {
      debugLog('[ServerManager] 启动统一服务器...');
      
      const binaryPath = this.getBinaryPath();
      
      await this.ensureBinaryReady();
      
      // 确保可执行权限 (Unix)
      await this.ensureExecutable(binaryPath);
      
      // 启动进程
      this.process = spawn(binaryPath, ['--port', '0'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          TERM: process.env.TERM || 'xterm-256color',
        },
        windowsHide: true,
        detached: false,
      });
      
      debugLog('[ServerManager] 服务器进程已启动, PID:', this.process.pid);
      
      // 监听进程错误
      this.process.on('error', (error) => {
        errorLog('[ServerManager] 服务器进程错误:', error);
        this.handleServerError(error);
      });
      
      // 等待端口信息
      const port = await this.waitForServerPort();
      this.port = port;
      this.restartAttempts = 0;
      
      debugLog(`[ServerManager] 服务器已启动，端口: ${port}`);
      
      // 设置退出处理器
      this.setupServerExitHandler();
      
      // 建立 WebSocket 连接
      await this.connectWebSocket();
      
      this.emit('server-started', port);
      
    } catch (error) {
      this.serverStartPromise = null;
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      errorLog('[ServerManager] 启动服务器失败:', errorMessage);
      
      new Notice(t('notices.serverStartFailed') || '服务器启动失败', 0);
      
      this.emit('server-error', error instanceof Error ? error : new Error(errorMessage));
      throw error;
    }
  }

  /**
   * 获取二进制文件路径
   */
  private getBinaryPath(): string {
    const platform = process.platform;
    const arch = process.arch;
    const ext = platform === 'win32' ? '.exe' : '';
    const filename = `terminal-server-${platform}-${arch}${ext}`;
    
    return path.join(this.pluginDir, 'binaries', filename);
  }

  private async ensureBinaryReady(): Promise<void> {
    if (this.offlineMode) {
      const binaryPath = this.getBinaryPath();
      if (!fs.existsSync(binaryPath)) {
        throw new ServerManagerError(
          ServerErrorCode.BINARY_NOT_FOUND,
          '离线模式已开启，未进行版本检查与下载，请确保服务器二进制已存在'
        );
      }
      return;
    }
    
    if (this.binaryUpdatePromise) {
      return this.binaryUpdatePromise;
    }

    this.binaryUpdatePromise = this.performBinaryUpdate();

    try {
      await this.binaryUpdatePromise;
    } finally {
      this.binaryUpdatePromise = null;
    }
  }

  private async performBinaryUpdate(): Promise<void> {
    const skipVersionCheck = this.offlineMode;
    const needsDownload = !this.binaryDownloader.binaryExists(skipVersionCheck);
    const needsUpdate = this.binaryDownloader.needsUpdate(skipVersionCheck);

    if (!needsDownload && !needsUpdate) {
      return;
    }

    const shouldRestart = needsUpdate && this.isServerRunning();
    if (shouldRestart) {
      debugLog('[ServerManager] 服务器运行中，更新前先停止服务器');
      await this.shutdown();
    }

    const messageKey = needsUpdate ? 'notices.updatingBinary' : 'notices.downloadingBinary';
    const defaultMessage = needsUpdate ? '正在更新服务器组件...' : '正在下载服务器组件...';

    debugLog(`[ServerManager] ${needsUpdate ? '二进制文件需要更新' : '二进制文件不存在'}，开始下载...`);

    const notice = new Notice(
      t(messageKey) || defaultMessage,
      0
    );

    let updateSucceeded = false;

    try {
      await this.binaryDownloader.download((progress) => {
        if (progress.stage === 'downloading') {
          notice.setMessage(
            `${t(messageKey) || defaultMessage} ${Math.round(progress.percent)}%`
          );
        } else if (progress.stage === 'verifying') {
          notice.setMessage(t('notices.verifyingBinary') || '正在验证文件...');
        }
      });

      notice.hide();
      const completeKey = needsUpdate ? 'notices.binaryUpdateComplete' : 'notices.binaryDownloadComplete';
      const completeMessage = needsUpdate ? '服务器组件更新完成' : '服务器组件下载完成';
      new Notice(t(completeKey) || completeMessage, 3000);
      updateSucceeded = true;

    } catch (downloadError) {
      notice.hide();
      throw new ServerManagerError(
        ServerErrorCode.BINARY_NOT_FOUND,
        `下载二进制文件失败: ${downloadError instanceof Error ? downloadError.message : String(downloadError)}`
      );
    } finally {
      if (shouldRestart) {
        this.resetShutdownState();
        if (updateSucceeded) {
          setTimeout(() => {
            this.ensureServer().catch((error) => {
              errorLog('[ServerManager] 更新后重启服务器失败:', error);
            });
          }, 0);
        }
      }
    }
  }

  /**
   * 确保文件可执行 (Unix)
   */
  private async ensureExecutable(filePath: string): Promise<void> {
    if (process.platform === 'win32') {
      return;
    }
    
    try {
      const stats = await fs.promises.stat(filePath);
      const isExecutable = (stats.mode & 0o111) !== 0;
      
      if (!isExecutable) {
        debugLog('[ServerManager] 添加可执行权限:', filePath);
        await fs.promises.chmod(filePath, 0o755);
      }
    } catch (error) {
      errorLog('[ServerManager] 设置可执行权限失败:', error);
    }
  }

  /**
   * 等待服务器输出端口信息
   */
  private async waitForServerPort(): Promise<number> {
    return new Promise((resolve, reject) => {
      if (!this.process || !this.process.stdout) {
        reject(new ServerManagerError(
          ServerErrorCode.SERVER_START_FAILED,
          '进程未启动'
        ));
        return;
      }

      let buffer = '';
      
      const timeout = setTimeout(() => {
        this.process?.stdout?.off('data', onData);
        reject(new ServerManagerError(
          ServerErrorCode.SERVER_START_FAILED,
          '等待端口信息超时'
        ));
      }, 10000);

      const onData = (chunk: Buffer) => {
        buffer += chunk.toString();
        
        try {
          const match = buffer.match(/\{[^}]+\}/);
          if (match) {
            const info: ServerInfo = JSON.parse(match[0]);
            if (info.port && typeof info.port === 'number') {
              clearTimeout(timeout);
              this.process?.stdout?.off('data', onData);
              debugLog('[ServerManager] 解析到服务器信息:', info);
              resolve(info.port);
            }
          }
        } catch {
          // JSON 解析失败，继续等待
        }
      };

      this.process.stdout.on('data', onData);
      
      // 监听 stderr 用于调试
      this.process.stderr?.on('data', (data: Buffer) => {
        debugLog('[ServerManager] stderr:', data.toString());
      });

      this.process.on('exit', (code) => {
        clearTimeout(timeout);
        if (code !== 0 && code !== null) {
          reject(new ServerManagerError(
            ServerErrorCode.SERVER_START_FAILED,
            `服务器启动失败，退出码: ${code}`
          ));
        }
      });
    });
  }

  /**
   * 建立 WebSocket 连接
   */
  private async connectWebSocket(): Promise<void> {
    if (this.wsConnectPromise) {
      return this.wsConnectPromise;
    }

    this.wsConnectPromise = new Promise((resolve, reject) => {
      if (!this.port) {
        this.wsConnectPromise = null;
        reject(new ServerManagerError(
          ServerErrorCode.CONNECTION_FAILED,
          '服务器端口未知'
        ));
        return;
      }

      const wsUrl = `ws://127.0.0.1:${this.port}`;
      debugLog('[ServerManager] 连接 WebSocket:', wsUrl);
      
      this.ws = new WebSocket(wsUrl);
      
      const timeout = setTimeout(() => {
        this.wsConnectPromise = null;
        reject(new ServerManagerError(
          ServerErrorCode.CONNECTION_FAILED,
          'WebSocket 连接超时'
        ));
      }, 5000);

      this.ws.onopen = () => {
        clearTimeout(timeout);
        debugLog('[ServerManager] WebSocket 已连接');
        
        // 重置重连计数
        this.wsReconnectAttempts = 0;
        this.isReconnecting = false;
        
        // 更新所有模块客户端的 WebSocket
        this.updateClientsWebSocket();
        
        this.emit('ws-connected');
        resolve();
      };

      this.ws.onclose = (event) => {
        debugLog('[ServerManager] WebSocket 已断开, code:', event.code, 'reason:', event.reason);
        this.wsConnectPromise = null;
        
        // 清除模块客户端的 WebSocket
        this._ptyClient?.setWebSocket(null);
        
        this.emit('ws-disconnected');
        
        // 如果不是主动关闭，尝试重连
        if (!this.isShuttingDown && this.port !== null) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = (event) => {
        clearTimeout(timeout);
        errorLog('[ServerManager] WebSocket 错误:', event);
        // 不在这里 reject，让 onclose 处理
      };

      this.ws.onmessage = (event) => {
        this.handleWebSocketMessage(event);
      };
    });

    return this.wsConnectPromise;
  }

  /**
   * 更新所有模块客户端的 WebSocket
   */
  private updateClientsWebSocket(): void {
    if (this.ws) {
      this._ptyClient?.setWebSocket(this.ws);
    }
  }

  /**
   * 处理 WebSocket 消息
   */
  private handleWebSocketMessage(event: MessageEvent): void {
    // 处理二进制消息 (PTY 输出)
    if (event.data instanceof ArrayBuffer) {
      this._ptyClient?.handleBinaryMessage(event.data);
      return;
    }
    
    if (event.data instanceof Blob) {
      event.data.arrayBuffer().then(buffer => {
        this._ptyClient?.handleBinaryMessage(buffer);
      });
      return;
    }
    
    // 处理 JSON 消息
    try {
      const msg: ServerMessage = JSON.parse(event.data);
      
      // 根据模块分发消息
      switch (msg.module) {
        case 'pty':
          this._ptyClient?.handleMessage(msg);
          break;
        default:
          debugWarn('[ServerManager] 未知模块消息:', msg);
      }
    } catch (error) {
      errorLog('[ServerManager] 解析消息失败:', error);
    }
  }

  /**
   * 处理 WebSocket 断开 - 调度重连
   */
  private scheduleReconnect(): void {
    // 如果已经在重连或正在关闭，跳过
    if (this.isReconnecting || this.isShuttingDown) {
      return;
    }
    
    // 检查是否超过最大重连次数
    if (this.wsReconnectAttempts >= this.reconnectConfig.maxAttempts) {
      errorLog(
        `[ServerManager] WebSocket 重连失败，已达到最大重试次数 (${this.reconnectConfig.maxAttempts})`
      );
      
      new Notice(
        t('notices.wsReconnectFailed') || 'WebSocket 连接断开，请重新加载插件',
        0
      );
      
      this.emit('ws-reconnect-failed');
      return;
    }
    
    this.isReconnecting = true;
    this.wsReconnectAttempts++;
    
    const delay = this.reconnectConfig.interval;
    
    debugLog(
      `[ServerManager] 将在 ${delay}ms 后尝试重连 WebSocket ` +
      `(${this.wsReconnectAttempts}/${this.reconnectConfig.maxAttempts})`
    );
    
    this.emit('ws-reconnecting', this.wsReconnectAttempts, delay);
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.attemptReconnect();
    }, delay);
  }

  /**
   * 执行 WebSocket 重连
   */
  private async attemptReconnect(): Promise<void> {
    if (this.isShuttingDown || !this.port) {
      this.isReconnecting = false;
      return;
    }
    
    debugLog('[ServerManager] 尝试重连 WebSocket...');
    
    try {
      await this.connectWebSocket();
      
      debugLog('[ServerManager] WebSocket 重连成功');
      new Notice(
        t('notices.wsReconnectSuccess') || 'WebSocket 重连成功',
        3000
      );
      
    } catch (error) {
      errorLog('[ServerManager] WebSocket 重连失败:', error);
      this.isReconnecting = false;
      
      // 继续尝试重连
      this.scheduleReconnect();
    }
  }

  /**
   * 取消重连
   */
  private cancelReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.isReconnecting = false;
    this.wsReconnectAttempts = 0;
  }

  /**
   * 设置服务器退出处理器
   * 

   */
  private setupServerExitHandler(): void {
    if (!this.process) {
      return;
    }

    this.process.on('exit', (code, signal) => {
      this.port = null;
      this.serverStartPromise = null;
      
      if (this.isShuttingDown) {
        debugLog(`[ServerManager] 服务器已停止: code=${code}, signal=${signal}`);
        return;
      }
      
      errorLog(`[ServerManager] 服务器退出: code=${code}, signal=${signal}`);
      
      const isAbnormalExit = code !== 0 && code !== null;
      
      if (isAbnormalExit) {
        new Notice(
          t('notices.serverCrashed', { 
            code: String(code), 
            signal: signal || 'N/A' 
          }) || `服务器崩溃: code=${code}, signal=${signal}`,
          5000
        );
      }

      // 尝试自动重启
      this.attemptRestart();
    });
  }

  /**
   * 尝试自动重启服务器
   */
  private attemptRestart(): void {
    if (this.restartAttempts < this.maxRestartAttempts) {
      this.restartAttempts++;
      debugLog(
        `[ServerManager] 尝试重启服务器 ` +
        `(${this.restartAttempts}/${this.maxRestartAttempts})`
      );
      
      const delay = 1000 * Math.pow(2, this.restartAttempts - 1);
      
      setTimeout(() => {
        this.ensureServer()
          .then(() => {
            new Notice(
              t('notices.serverRestartSuccess') || '服务器重启成功',
              3000
            );
          })
          .catch(err => {
            errorLog('[ServerManager] 服务器重启失败:', err);
            new Notice(
              t('notices.serverRestartFailed') || '服务器重启失败',
              0
            );
          });
      }, delay);
    } else {
      new Notice(
        t('notices.serverRestartFailed') || '服务器重启失败，已达到最大重试次数',
        0
      );
    }
  }

  /**
   * 处理服务器进程错误
   */
  private handleServerError(error: Error): void {
    const errorCode = (error as NodeJS.ErrnoException).code;
    
    if (errorCode === 'ENOENT') {
      new Notice(
        '❌ 无法启动服务器\n\n' +
        '错误: 二进制文件未找到\n' +
        '请重新加载插件',
        0
      );
    } else if (errorCode === 'EACCES') {
      new Notice(
        '❌ 无法启动服务器\n\n' +
        '错误: 权限不足\n' +
        '请检查文件权限',
        0
      );
    } else {
      new Notice(
        `❌ 服务器启动失败\n\n` +
        `错误: ${error.message}\n` +
        `请查看控制台获取详细信息`,
        0
      );
    }
    
    this.emit('server-error', error);
  }

  /**
   * 触发事件
   */
  private emit<K extends keyof ServerEvents>(
    event: K,
    ...args: Parameters<ServerEvents[K]>
  ): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach(listener => {
        try {
          (listener as (...args: Parameters<ServerEvents[K]>) => void)(...args);
        } catch (error) {
          errorLog(`[ServerManager] 事件处理器错误 (${event}):`, error);
        }
      });
    }
  }

  /**
   * 重置关闭状态（用于重新启用服务）
   */
  resetShutdownState(): void {
    this.isShuttingDown = false;
    this.restartAttempts = 0;
    this.wsReconnectAttempts = 0;
    this.isReconnecting = false;
  }

  /**
   * 手动触发重连（供外部调用）
   */
  async reconnect(): Promise<void> {
    if (this.isShuttingDown) {
      throw new ServerManagerError(
        ServerErrorCode.CONNECTION_FAILED,
        '服务器正在关闭'
      );
    }
    
    // 重置重连计数
    this.wsReconnectAttempts = 0;
    this.cancelReconnect();
    
    // 关闭现有连接
    if (this.ws) {
      this.ws.close(1000, 'Manual reconnect');
      this.ws = null;
    }
    
    // 如果服务器还在运行，直接重连 WebSocket
    if (this.port !== null && this.process !== null) {
      await this.connectWebSocket();
    } else {
      // 否则重启整个服务器
      await this.ensureServer();
    }
  }

  /**
   * 更新连接配置
   * @param config 连接配置
   */
  updateConnectionConfig(config: Partial<ReconnectConfig>): void {
    // 检查配置是否有变化
    const hasChanges = Object.entries(config).some(
      ([key, value]) => this.reconnectConfig[key as keyof ReconnectConfig] !== value
    );
    
    if (hasChanges) {
      Object.assign(this.reconnectConfig, config);
      debugLog('[ServerManager] 更新重连配置:', this.reconnectConfig);
    }
  }
  
  updateDebugMode(debugMode: boolean): void {
    this.debugMode = debugMode;
    debugLog('[ServerManager] 更新调试模式:', this.debugMode);
  }
  
  updateOfflineMode(offlineMode: boolean): void {
    this.offlineMode = offlineMode;
    debugLog('[ServerManager] 更新离线模式:', this.offlineMode);
  }
}
