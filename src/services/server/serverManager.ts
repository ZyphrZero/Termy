/**
 * ServerManager - unified server manager
 * 
 * Responsibilities:
 * 1. Manage the lifecycle of the unified Rust server process
 * 2. Manage a single WebSocket connection
 * 3. Provide modular APIs (pty/voice/llm/utils)
 * 4. Handle server crashes and automatic restarts
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
import { BinaryDownloader } from './binaryDownloader';
import type { BinaryDownloadConfig } from './binaryDownloadUrls';

type BinaryUpdateResult = 'skipped-offline' | 'already-ready' | 'downloaded' | 'updated';

/**
 * Event listener type
 */
type EventListener<K extends keyof ServerEvents> = ServerEvents[K];

/**
 * WebSocket reconnect config
 */
interface ReconnectConfig {
  /** Maximum reconnect attempts */
  maxAttempts: number;
  /** Reconnect interval (ms) */
  interval: number;
}

/**
 * Unified server manager
 * 
 * Replaces BinaryManager + TerminalService + VoiceServerManager
 */
export class ServerManager {
  /** Plugin directory */
  private pluginDir: string;
  
  /** Plugin version */
  private version: string;
  
  /** Debug mode (controls logging output only) */
  private debugMode: boolean;
  
  /** Offline mode (skips version checks and automatic downloads) */
  private offlineMode: boolean;
  
  /** Binary downloader */
  private binaryDownloader: BinaryDownloader;
  
  /** Server process */
  private process: ChildProcess | null = null;
  
  /** WebSocket connection */
  private ws: WebSocket | null = null;
  
  /** Server port */
  private port: number | null = null;
  
  /** Whether shutdown is in progress */
  private isShuttingDown = false;
  
  /** Server restart attempt count */
  private restartAttempts = 0;
  
  /** Maximum server restart attempts */
  private readonly maxRestartAttempts = 3;
  
  /** WebSocket reconnect attempt count */
  private wsReconnectAttempts = 0;
  
  /** Reconnect config */
  private reconnectConfig: ReconnectConfig = {
    maxAttempts: 5,
    interval: 3000,
  };
  
  /** Whether reconnection is in progress */
  private isReconnecting = false;
  
  /** Reconnect timer */
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  
  /** Server startup Promise */
  private serverStartPromise: Promise<void> | null = null;
  
  /** WebSocket connection Promise */
  private wsConnectPromise: Promise<void> | null = null;

  /** Binary update Promise */
  private binaryUpdatePromise: Promise<BinaryUpdateResult> | null = null;
  
  /** Event listeners */
  private eventListeners: Map<keyof ServerEvents, Set<EventListener<keyof ServerEvents>>> = new Map();
  
  // Module clients (lazy-loaded)
  private _ptyClient: PtyClient | null = null;

  constructor(
    pluginDir: string,
    version: string = '0.0.0',
    downloadConfig: BinaryDownloadConfig,
    debugMode: boolean = false,
    offlineMode: boolean = false
  ) {
    this.pluginDir = pluginDir;
    this.version = version;
    this.debugMode = debugMode;
    this.offlineMode = offlineMode;
    this.binaryDownloader = new BinaryDownloader(pluginDir, version, downloadConfig);
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Ensure the server is running
   * 

   */
  async ensureServer(): Promise<void> {
    // If the server is already running, return immediately
    if (this.port !== null && this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    // If startup is already in progress, wait for it to finish
    if (this.serverStartPromise) {
      return this.serverStartPromise;
    }

    // Start the server
    this.serverStartPromise = this.startServer();
    return this.serverStartPromise;
  }

  /**
   * Ensure the binary has been updated (without starting the server)
   */
  async ensureBinaryUpdated(): Promise<BinaryUpdateResult> {
    if (this.offlineMode) {
      debugLog('[ServerManager] 离线模式已开启，跳过二进制版本检查与下载');
      return 'skipped-offline';
    }
    return this.ensureBinaryReady();
  }

  /**
   * Get the PTY client
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
   * Shut down the server
   * 

   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    
    debugLog('[ServerManager] 关闭服务器...');
    
    // Cancel the reconnect timer
    this.cancelReconnect();
    
    // Close the WebSocket connection
    if (this.ws) {
      try {
        this.ws.close(1000, 'Shutdown');
      } catch (error) {
        debugWarn('[ServerManager] 关闭 WebSocket 时出错:', error);
      }
      this.ws = null;
    }
    
    // Stop the server process
    if (this.process) {
      try {
        this.process.kill('SIGTERM');
        
        // Wait for the process to exit
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
    
    // Clear state
    this.port = null;
    this.serverStartPromise = null;
    this.wsConnectPromise = null;
    
    // Destroy module clients
    this._ptyClient?.destroy();
    
    this._ptyClient = null;
    
    this.emit('server-stopped');
    
    debugLog('[ServerManager] 服务器已关闭');
  }

  /**
   * Whether the server is running
   */
  isServerRunning(): boolean {
    return this.port !== null && this.process !== null;
  }

  /**
   * Whether the WebSocket is connected
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Whether reconnection is in progress
   */
  isReconnectingWebSocket(): boolean {
    return this.isReconnecting;
  }

  /**
   * Get the WebSocket reconnect attempt count
   */
  getReconnectAttempts(): number {
    return this.wsReconnectAttempts;
  }

  /**
   * Get the server port
   */
  getServerPort(): number | null {
    return this.port;
  }

  /**
   * Register an event listener
   */
  on<K extends keyof ServerEvents>(event: K, callback: ServerEvents[K]): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(callback as EventListener<keyof ServerEvents>);
  }

  /**
   * Remove an event listener
   */
  off<K extends keyof ServerEvents>(event: K, callback: ServerEvents[K]): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(callback as EventListener<keyof ServerEvents>);
    }
  }

  // ============================================================================
  // Private methods
  // ============================================================================

  /**
   * Start the server
   */
  private async startServer(): Promise<void> {
    try {
      debugLog('[ServerManager] 启动统一服务器...');
      
      const binaryPath = this.getBinaryPath();
      
      await this.ensureBinaryReady();
      
      // Ensure executable permission (Unix)
      await this.ensureExecutable(binaryPath);
      
      // Start the process
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
      
      // Listen for process errors
      this.process.on('error', (error) => {
        errorLog('[ServerManager] 服务器进程错误:', error);
        this.handleServerError(error);
      });
      
      // Wait for port information
      const port = await this.waitForServerPort();
      this.port = port;
      this.restartAttempts = 0;
      
      debugLog(`[ServerManager] 服务器已启动，端口: ${port}`);
      
      // Set up the exit handler
      this.setupServerExitHandler();
      
      // Establish the WebSocket connection
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
   * Get the binary path
   */
  private getBinaryPath(): string {
    const platform = process.platform;
    const arch = process.arch;
    const ext = platform === 'win32' ? '.exe' : '';
    const filename = `termy-server-${platform}-${arch}${ext}`;
    
    return path.join(this.pluginDir, 'binaries', filename);
  }

  private async ensureBinaryReady(): Promise<BinaryUpdateResult> {
    if (this.offlineMode) {
      const binaryPath = this.getBinaryPath();
      if (!fs.existsSync(binaryPath)) {
        throw new ServerManagerError(
          ServerErrorCode.BINARY_NOT_FOUND,
          '离线模式已开启，未进行版本检查与下载，请确保服务器二进制已存在'
        );
      }
      return 'skipped-offline';
    }
    
    if (this.binaryUpdatePromise) {
      return this.binaryUpdatePromise;
    }

    this.binaryUpdatePromise = this.performBinaryUpdate();

    try {
      return await this.binaryUpdatePromise;
    } finally {
      this.binaryUpdatePromise = null;
    }
  }

  private async performBinaryUpdate(): Promise<BinaryUpdateResult> {
    const skipVersionCheck = this.offlineMode;
    const needsDownload = !this.binaryDownloader.binaryExists(skipVersionCheck);
    const needsUpdate = this.binaryDownloader.needsUpdate(skipVersionCheck);
    const binaryPath = this.getBinaryPath();
    const downloadConfig = this.binaryDownloader.getDownloadConfig();

    debugLog('[ServerManager] Binary readiness check:', {
      binaryPath,
      needsDownload,
      needsUpdate,
      offlineMode: this.offlineMode,
      downloadSource: downloadConfig.source,
      serverRunning: this.isServerRunning(),
    });

    if (!needsDownload && !needsUpdate) {
      debugLog('[ServerManager] 二进制文件已是最新，无需下载');
      return 'already-ready';
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
      return needsUpdate ? 'updated' : 'downloaded';

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
   * Ensure the file is executable (Unix)
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
   * Wait for the server to output port information
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
          // JSON parsing failed, keep waiting
        }
      };

      this.process.stdout.on('data', onData);
      
      // Listen to stderr for debugging
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
   * Establish the WebSocket connection
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
        
        // Reset the reconnect counter
        this.wsReconnectAttempts = 0;
        this.isReconnecting = false;
        
        // Update the WebSocket on all module clients
        this.updateClientsWebSocket();
        
        this.emit('ws-connected');
        resolve();
      };

      this.ws.onclose = (event) => {
        debugLog('[ServerManager] WebSocket 已断开, code:', event.code, 'reason:', event.reason);
        this.wsConnectPromise = null;
        
        // Clear the WebSocket on module clients
        this._ptyClient?.setWebSocket(null);
        
        this.emit('ws-disconnected');
        
        // If this was not an intentional shutdown, try to reconnect
        if (!this.isShuttingDown && this.port !== null) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = (event) => {
        clearTimeout(timeout);
        errorLog('[ServerManager] WebSocket 错误:', event);
        // Do not reject here; let onclose handle it
      };

      this.ws.onmessage = (event) => {
        this.handleWebSocketMessage(event);
      };
    });

    return this.wsConnectPromise;
  }

  /**
   * Update the WebSocket on all module clients
   */
  private updateClientsWebSocket(): void {
    if (this.ws) {
      this._ptyClient?.setWebSocket(this.ws);
    }
  }

  /**
   * Handle WebSocket messages
   */
  private handleWebSocketMessage(event: MessageEvent): void {
    // Handle binary messages (PTY output)
    if (event.data instanceof ArrayBuffer) {
      this._ptyClient?.handleBinaryMessage(event.data);
      return;
    }
    
    if (event.data instanceof Blob) {
      void event.data.arrayBuffer()
        .then(buffer => {
          this._ptyClient?.handleBinaryMessage(buffer);
        })
        .catch((error) => {
          errorLog('[ServerManager] 解析二进制消息失败:', error);
        });
      return;
    }
    
    // Handle JSON messages
    try {
      const msg: ServerMessage = JSON.parse(event.data);
      
      // Dispatch messages by module
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
   * Handle WebSocket disconnection and schedule reconnect
   */
  private scheduleReconnect(): void {
    // If reconnection is already in progress or shutdown is underway, skip
    if (this.isReconnecting || this.isShuttingDown) {
      return;
    }
    
    // Check whether the maximum reconnect attempts has been exceeded
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
      void this.attemptReconnect();
    }, delay);
  }

  /**
   * Perform WebSocket reconnect
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
      
      // Keep trying to reconnect
      this.scheduleReconnect();
    }
  }

  /**
   * Cancel reconnect
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
   * Set up the server exit handler
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

      // Try automatic restart
      this.attemptRestart();
    });
  }

  /**
   * Try to automatically restart the server
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
   * Handle server process errors
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
   * Emit an event
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
   * Reset the shutdown state (used when re-enabling the service)
   */
  resetShutdownState(): void {
    this.isShuttingDown = false;
    this.restartAttempts = 0;
    this.wsReconnectAttempts = 0;
    this.isReconnecting = false;
  }

  /**
   * Manually trigger reconnect (for external callers)
   */
  async reconnect(): Promise<void> {
    if (this.isShuttingDown) {
      throw new ServerManagerError(
        ServerErrorCode.CONNECTION_FAILED,
        '服务器正在关闭'
      );
    }
    
    // Reset the reconnect counter
    this.wsReconnectAttempts = 0;
    this.cancelReconnect();
    
    // Close the existing connection
    if (this.ws) {
      this.ws.close(1000, 'Manual reconnect');
      this.ws = null;
    }
    
    // If the server is still running, reconnect the WebSocket directly
    if (this.port !== null && this.process !== null) {
      await this.connectWebSocket();
    } else {
      // Otherwise restart the entire server
      await this.ensureServer();
    }
  }

  /**
   * Update connection config
   * @param config Connection config
   */
  updateConnectionConfig(config: Partial<ReconnectConfig>): void {
    // Check whether the config changed
    const hasChanges = Object.entries(config).some(
      ([key, value]) => this.reconnectConfig[key as keyof ReconnectConfig] !== value
    );
    
    if (hasChanges) {
      Object.assign(this.reconnectConfig, config);
      debugLog('[ServerManager] 更新重连配置:', this.reconnectConfig);
    }
  }
  
  updateDebugMode(debugMode: boolean): void {
    if (this.debugMode === debugMode) {
      return;
    }
    this.debugMode = debugMode;
    debugLog('[ServerManager] 更新调试模式:', this.debugMode);
  }
  
  updateOfflineMode(offlineMode: boolean): void {
    if (this.offlineMode === offlineMode) {
      return;
    }
    this.offlineMode = offlineMode;
    debugLog('[ServerManager] 更新离线模式:', this.offlineMode);
  }

  updateBinaryDownloadConfig(downloadConfig: BinaryDownloadConfig): void {
    const currentConfig = this.binaryDownloader?.getDownloadConfig?.();
    const nextConfig: BinaryDownloadConfig = {
      source: downloadConfig.source,
    };

    if (
      currentConfig
      && currentConfig.source === nextConfig.source
    ) {
      return;
    }
    this.binaryDownloader = new BinaryDownloader(this.pluginDir, this.version, nextConfig);
    debugLog('[ServerManager] 更新二进制下载配置:', nextConfig);
  }
}
