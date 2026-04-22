/**
 * TerminalService - terminal service built on the unified Rust server
 * 
 * Responsibilities:
 * 1. Use ServerManager to manage the unified server
 * 2. Manage all terminal instances
 * 3. Handle server crashes and automatic restarts
 * 

 */

import type { App} from 'obsidian';
import { Notice } from 'obsidian';
import type { TerminalSettings} from '@/settings/settings';
import { getCurrentPlatformShell, getCurrentPlatformCustomShellPath } from '@/settings/settings';
import type { TerminalInstance } from './terminalInstance';
import { debugLog, debugWarn, errorLog } from '@/utils/logger';
import { t } from '@/i18n';
import type { ServerManager } from '@/services/server/serverManager';
import type { PtyClient } from '@/services/server/ptyClient';

// Preload the TerminalInstance module to avoid dynamic import latency when creating the first terminal
let terminalInstanceModule: typeof import('./terminalInstance') | null = null;
const preloadTerminalInstance = async () => {
  if (!terminalInstanceModule) {
    terminalInstanceModule = await import('./terminalInstance');
  }
  return terminalInstanceModule;
};
// Start preloading immediately
void preloadTerminalInstance().catch((error) => {
  errorLog('[TerminalService] 预加载 TerminalInstance 失败:', error);
});

/**
 * TerminalService
 * 
 * Uses ServerManager to manage the unified server instead of managing the PTY server process independently
 */
export class TerminalService {
  private app: App;
  private settings: TerminalSettings;
  private serverManager: ServerManager;
  private getTerminalEnvironment: () => Record<string, string>;
  
  // Terminal instance registry
  private terminals: Map<string, TerminalInstance> = new Map();
  
  // Shutdown state flag
  private isShuttingDown = false;

  constructor(
    app: App,
    settings: TerminalSettings,
    serverManager: ServerManager,
    getTerminalEnvironment: () => Record<string, string> = () => ({}),
  ) {
    this.app = app;
    this.settings = settings;
    this.serverManager = serverManager;
    this.getTerminalEnvironment = getTerminalEnvironment;
    
    // Listen for server events
    this.setupServerEventHandlers();
  }

  /**
   * Set up server event handlers
   */
  private setupServerEventHandlers(): void {
    // Listen for server error events
    this.serverManager.on('server-error', (error) => {
      if (!this.isShuttingDown) {
        errorLog('[TerminalService] 服务器错误:', error);
        this.handleServerCrash();
      }
    });
    
    // Listen for WebSocket disconnect events
    this.serverManager.on('ws-disconnected', () => {
      if (!this.isShuttingDown) {
        debugLog('[TerminalService] WebSocket 断开');
        // Notify all terminal instances
        this.terminals.forEach(terminal => {
          terminal.handleServerCrash();
        });
      }
    });
    
    // Listen for successful server starts
    this.serverManager.on('server-started', (port) => {
      debugLog(`[TerminalService] 服务器已启动，端口: ${port}`);
    });
  }

  /**
   * Handle server crashes
   */
  private handleServerCrash(): void {
    // Notify all terminal instances
    this.terminals.forEach(terminal => {
      terminal.handleServerCrash();
    });
  }

  /**
   * Ensure the server is running
   * 
   * @returns The server port number
   */
  async ensureServer(): Promise<number> {
    await this.serverManager.ensureServer();
    const port = this.serverManager.getServerPort();
    if (port === null) {
      throw new Error(t('terminalService.serverNotRunning') || '服务器未运行');
    }
    return port;
  }

  /**
   * Get the PTY client
   */
  getPtyClient(): PtyClient {
    return this.serverManager.pty();
  }

  /**
   * Create a new terminal instance
   * 
   * @returns The created terminal instance
   * @throws Error if terminal creation fails
   */
  async createTerminal(): Promise<TerminalInstance> {
    try {
      // Ensure the server is running
      await this.serverManager.ensureServer();
      
      debugLog('[TerminalService] 创建终端');

      // Use the preloaded module
      const { TerminalInstance } = await preloadTerminalInstance();
      
      // Get the working directory if auto-entering the vault directory is enabled
      let cwd: string | undefined;
      if (this.settings.autoEnterVaultDirectory) {
        cwd = this.getVaultPath();
        if (cwd) {
          debugLog(`[TerminalService] 自动进入项目目录: ${cwd}`);
        }
      }
      
      // Handle a custom shell path
      const currentShell = getCurrentPlatformShell(this.settings);
      let shellType: string = currentShell;
      if (currentShell === 'custom') {
        const customPath = getCurrentPlatformCustomShellPath(this.settings);
        if (customPath) {
          shellType = `custom:${customPath}`;
        }
      }
      
      // Get shell startup arguments
      const shellArgs = this.settings.shellArgs.length > 0 ? this.settings.shellArgs : undefined;
      const terminalEnv = this.getTerminalEnvironment();
      
      // Create the terminal instance with the current settings
      const terminal = new TerminalInstance({
        shellType: shellType,
        shellArgs: shellArgs,
        cwd: cwd,
        env: Object.keys(terminalEnv).length > 0 ? terminalEnv : undefined,
        fontSize: this.settings.fontSize,
        fontFamily: this.settings.fontFamily,
        cursorStyle: this.settings.cursorStyle,
        cursorBlink: this.settings.cursorBlink,
        scrollback: this.settings.scrollback,
        preferredRenderer: this.settings.preferredRenderer,
        useObsidianTheme: this.settings.useObsidianTheme,
        backgroundColor: this.settings.backgroundColor,
        foregroundColor: this.settings.foregroundColor,
        backgroundImage: this.settings.backgroundImage,
        backgroundImageOpacity: this.settings.backgroundImageOpacity,
        backgroundImageSize: this.settings.backgroundImageSize,
        backgroundImagePosition: this.settings.backgroundImagePosition,
        enableBlur: this.settings.enableBlur,
        blurAmount: this.settings.blurAmount,
        textOpacity: this.settings.textOpacity,
      });
      
      // Initialize the terminal through ServerManager
      await terminal.initializeWithServerManager(this.serverManager);
      
      this.terminals.set(terminal.id, terminal);
      
      return terminal;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errorLog('[TerminalService] 创建终端实例失败:', errorMessage);
      
      new Notice(t('notices.terminal.createFailed', { message: errorMessage }), 5000);
      
      throw error;
    }
  }

  /**
   * Get the Vault path
   * @returns The absolute Vault path, or undefined if it cannot be resolved
   */
  private getVaultPath(): string | undefined {
    try {
      const adapter = this.app.vault.adapter as { getBasePath?: () => string };
      if (adapter && typeof adapter.getBasePath === 'function') {
        return adapter.getBasePath();
      }
    } catch (error) {
      debugWarn('[TerminalService] 无法获取 Vault 路径:', error);
    }
    return undefined;
  }

  /**
   * Get a terminal instance
   * 
   * @param id The terminal instance ID
   * @returns The terminal instance, or undefined if it does not exist
   */
  getTerminal(id: string): TerminalInstance | undefined {
    return this.terminals.get(id);
  }

  /**
   * Get all terminal instances
   * 
   * @returns An array of all terminal instances
   */
  getAllTerminals(): TerminalInstance[] {
    return Array.from(this.terminals.values());
  }

  /**
   * Destroy the specified terminal instance
   * 
   * @param id The terminal instance ID
   */
  async destroyTerminal(id: string): Promise<void> {
    const terminal = this.terminals.get(id);
    if (terminal) {
      try {
        terminal.destroy();
      } catch (error) {
        errorLog(`[TerminalService] 销毁终端 ${id} 失败:`, error);
      } finally {
        this.terminals.delete(id);
        
        // Stop the server if this was the last terminal
        if (this.terminals.size === 0 && !this.isShuttingDown) {
          debugLog('[TerminalService] 最后一个终端已关闭，停止服务器');
          await this.serverManager.shutdown();
        }
      }
    }
  }

  /**
   * Destroy all terminal instances
   */
  destroyAllTerminals(): void {
    const failedTerminals: string[] = [];

    for (const [id, terminal] of this.terminals.entries()) {
      try {
        terminal.destroy();
      } catch (error) {
        errorLog(`[TerminalService] 销毁终端 ${id} 失败:`, error);
        failedTerminals.push(id);
      }
    }

    // Clear the map
    this.terminals.clear();

    // Log a warning if any terminals failed to clean up
    if (failedTerminals.length > 0) {
      debugWarn(`[TerminalService] 以下终端清理失败: ${failedTerminals.join(', ')}`);
    }
  }

  /**
   * Update settings
   * 
   * @param settings The new settings
   */
  updateSettings(settings: TerminalSettings): void {
    this.settings = settings;
  }

  /**
   * Get the server status
   * 
   * @returns Whether the server is currently running
   */
  isServerRunning(): boolean {
    return this.serverManager.isServerRunning();
  }

  /**
   * Get the server port
   * 
   * @returns The server port, or null if the server is not running
   */
  getServerPort(): number | null {
    return this.serverManager.getServerPort();
  }

  /**
   * Get the terminal count
   * 
   * @returns The current number of terminal instances
   */
  getTerminalCount(): number {
    return this.terminals.size;
  }

  /**
   * Shut down the service (called when the plugin unloads)
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    
    debugLog('[TerminalService] 开始关闭终端服务');
    
    // Destroy all terminals
    this.destroyAllTerminals();
    
    // Ensure the server is stopped
    if (this.serverManager.isServerRunning()) {
      debugLog('[TerminalService] 停止服务器');
      await this.serverManager.shutdown();
    }
    
    debugLog('[TerminalService] 终端服务已关闭');
  }
}
