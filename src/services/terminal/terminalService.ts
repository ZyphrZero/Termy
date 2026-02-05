/**
 * TerminalService - 基于统一 Rust 服务器的终端服务
 * 
 * 职责:
 * 1. 使用 ServerManager 管理统一服务器
 * 2. 管理所有终端实例
 * 3. 处理服务器崩溃和自动重启
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

// 预加载 TerminalInstance 模块，避免首次创建终端时的动态 import 延迟
let terminalInstanceModule: typeof import('./terminalInstance') | null = null;
const preloadTerminalInstance = async () => {
  if (!terminalInstanceModule) {
    terminalInstanceModule = await import('./terminalInstance');
  }
  return terminalInstanceModule;
};
// 立即开始预加载
void preloadTerminalInstance().catch((error) => {
  errorLog('[TerminalService] 预加载 TerminalInstance 失败:', error);
});

/**
 * TerminalService
 * 
 * 使用 ServerManager 管理统一服务器，不再独立管理 PTY 服务器进程
 */
export class TerminalService {
  private app: App;
  private settings: TerminalSettings;
  private serverManager: ServerManager;
  
  // 终端实例管理
  private terminals: Map<string, TerminalInstance> = new Map();
  
  // 关闭状态标志
  private isShuttingDown = false;

  constructor(app: App, settings: TerminalSettings, serverManager: ServerManager) {
    this.app = app;
    this.settings = settings;
    this.serverManager = serverManager;
    
    // 监听服务器事件
    this.setupServerEventHandlers();
  }

  /**
   * 设置服务器事件处理器
   */
  private setupServerEventHandlers(): void {
    // 监听服务器崩溃事件
    this.serverManager.on('server-error', (error) => {
      if (!this.isShuttingDown) {
        errorLog('[TerminalService] 服务器错误:', error);
        this.handleServerCrash();
      }
    });
    
    // 监听 WebSocket 断开事件
    this.serverManager.on('ws-disconnected', () => {
      if (!this.isShuttingDown) {
        debugLog('[TerminalService] WebSocket 断开');
        // 通知所有终端实例
        this.terminals.forEach(terminal => {
          terminal.handleServerCrash();
        });
      }
    });
    
    // 监听服务器重启成功
    this.serverManager.on('server-started', (port) => {
      debugLog(`[TerminalService] 服务器已启动，端口: ${port}`);
    });
  }

  /**
   * 处理服务器崩溃
   */
  private handleServerCrash(): void {
    // 通知所有终端实例
    this.terminals.forEach(terminal => {
      terminal.handleServerCrash();
    });
  }

  /**
   * 确保服务器运行
   * 
   * @returns 服务器端口号
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
   * 获取 PTY 客户端
   */
  getPtyClient(): PtyClient {
    return this.serverManager.pty();
  }

  /**
   * 创建新的终端实例
   * 
   * @returns 创建的终端实例
   * @throws Error 如果终端创建失败
   */
  async createTerminal(): Promise<TerminalInstance> {
    try {
      // 确保服务器运行
      await this.serverManager.ensureServer();
      
      debugLog('[TerminalService] 创建终端');

      // 使用预加载的模块
      const { TerminalInstance } = await preloadTerminalInstance();
      
      // 获取工作目录（如果启用了自动进入项目目录）
      let cwd: string | undefined;
      if (this.settings.autoEnterVaultDirectory) {
        cwd = this.getVaultPath();
        if (cwd) {
          debugLog(`[TerminalService] 自动进入项目目录: ${cwd}`);
        }
      }
      
      // 处理自定义 shell 路径
      const currentShell = getCurrentPlatformShell(this.settings);
      let shellType: string = currentShell;
      if (currentShell === 'custom') {
        const customPath = getCurrentPlatformCustomShellPath(this.settings);
        if (customPath) {
          shellType = `custom:${customPath}`;
        }
      }
      
      // 获取 shell 启动参数
      const shellArgs = this.settings.shellArgs.length > 0 ? this.settings.shellArgs : undefined;
      
      // 创建终端实例，传入 ServerManager
      const terminal = new TerminalInstance({
        shellType: shellType,
        shellArgs: shellArgs,
        cwd: cwd,
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
      
      // 初始化终端（使用 ServerManager）
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
   * 获取 Vault 路径
   * @returns Vault 的绝对路径，如果无法获取则返回 undefined
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
   * 获取终端实例
   * 
   * @param id 终端实例 ID
   * @returns 终端实例，如果不存在则返回 undefined
   */
  getTerminal(id: string): TerminalInstance | undefined {
    return this.terminals.get(id);
  }

  /**
   * 获取所有终端实例
   * 
   * @returns 所有终端实例数组
   */
  getAllTerminals(): TerminalInstance[] {
    return Array.from(this.terminals.values());
  }

  /**
   * 销毁指定的终端实例
   * 
   * @param id 终端实例 ID
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
        
        // 如果这是最后一个终端，停止服务器
        if (this.terminals.size === 0 && !this.isShuttingDown) {
          debugLog('[TerminalService] 最后一个终端已关闭，停止服务器');
          await this.serverManager.shutdown();
        }
      }
    }
  }

  /**
   * 销毁所有终端实例
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

    // 清空映射
    this.terminals.clear();

    // 如果有失败的终端，记录警告
    if (failedTerminals.length > 0) {
      debugWarn(`[TerminalService] 以下终端清理失败: ${failedTerminals.join(', ')}`);
    }
  }

  /**
   * 更新设置
   * 
   * @param settings 新的设置
   */
  updateSettings(settings: TerminalSettings): void {
    this.settings = settings;
  }

  /**
   * 获取服务器状态
   * 
   * @returns 服务器是否正在运行
   */
  isServerRunning(): boolean {
    return this.serverManager.isServerRunning();
  }

  /**
   * 获取服务器端口
   * 
   * @returns 服务器端口，如果未运行则返回 null
   */
  getServerPort(): number | null {
    return this.serverManager.getServerPort();
  }

  /**
   * 获取终端数量
   * 
   * @returns 当前终端实例数量
   */
  getTerminalCount(): number {
    return this.terminals.size;
  }

  /**
   * 关闭服务（插件卸载时调用）
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    
    debugLog('[TerminalService] 开始关闭终端服务');
    
    // 销毁所有终端
    this.destroyAllTerminals();
    
    // 确保服务器停止
    if (this.serverManager.isServerRunning()) {
      debugLog('[TerminalService] 停止服务器');
      await this.serverManager.shutdown();
    }
    
    debugLog('[TerminalService] 终端服务已关闭');
  }
}
