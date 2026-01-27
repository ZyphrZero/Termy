import type { WorkspaceLeaf } from 'obsidian';
import { Plugin, Platform } from 'obsidian';
import type { TerminalSettings } from './settings/settings';
import { DEFAULT_SETTINGS } from './settings/settings';
import { TerminalSettingTab } from './settings/settingsTab';
import type { TerminalService } from './services/terminal/terminalService';
import type { ServerManager } from './services/server/serverManager';
import { TERMINAL_VIEW_TYPE, TerminalView } from './ui/terminal/terminalView';
import { i18n, t } from './i18n';
import { debugLog, errorLog } from './utils/logger';
import { FeatureVisibilityManager } from './services/visibility';

// 导入终端样式
import './ui/terminal/terminalStyles.css';

/**
 * Obsidian Terminal 插件主类
 */
export default class TerminalPlugin extends Plugin {
  settings: TerminalSettings;
  featureVisibilityManager: FeatureVisibilityManager;
  
  // 延迟初始化的服务
  private _serverManager: ServerManager | null = null;
  private _terminalService: TerminalService | null = null;
  
  // 状态栏元素
  private _statusBarItem: HTMLElement | null = null;

  /**
   * 获取服务器管理器（延迟初始化）
   */
  async getServerManager(): Promise<ServerManager> {
    if (!this._serverManager) {
      debugLog('[TerminalPlugin] Initializing ServerManager...');
      
      const { ServerManager } = await import('./services/server/serverManager');
      
      const pluginDir = this.getPluginDir();
      const version = this.manifest.version;
      
      this._serverManager = new ServerManager(
        pluginDir,
        version
      );
      
      debugLog('[TerminalPlugin] ServerManager initialized');
    }
    return this._serverManager;
  }

  /**
   * 获取终端服务（延迟初始化）
   */
  async getTerminalService(): Promise<TerminalService> {
    if (!this._terminalService) {
      debugLog('[TerminalPlugin] Initializing TerminalService...');
      
      const { TerminalService } = await import('./services/terminal/terminalService');
      
      const serverManager = await this.getServerManager();
      this._terminalService = new TerminalService(
        this.app,
        this.settings,
        serverManager
      );
      
      debugLog('[TerminalPlugin] TerminalService initialized');
    }
    return this._terminalService;
  }

  /**
   * 插件加载时调用
   */
  async onload() {
    // 初始化 i18n 服务
    i18n.initialize();
    
    debugLog(t('plugin.loadingMessage'));

    // 加载设置
    await this.loadSettings();

    // 设置调试模式
    const { setDebugMode } = await import('./utils/logger');
    setDebugMode(this.settings.enableDebugLog);

    // 初始化功能可见性管理器
    this.featureVisibilityManager = new FeatureVisibilityManager(this);

    // 注册功能可见性配置
    this.registerFeatureVisibility();

    // 注册终端视图
    this.registerView(
      TERMINAL_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => {
        // 创建占位视图，实际初始化在用户打开时进行
        return new TerminalViewPlaceholder(leaf, this);
      }
    );

    // 注册所有命令
    this.registerCommands();

    // 初始化状态栏
    this.initStatusBar();

    // 注册新标签页中的"打开终端"选项
    if (this.settings.visibility.showInNewTab) {
      this.registerNewTabTerminalAction();
    }

    // 添加设置标签页
    this.addSettingTab(new TerminalSettingTab(this.app, this));

    debugLog(t('plugin.loadedMessage'));
  }

  /**
   * 插件卸载时调用
   */
  async onunload() {
    debugLog(t('plugin.unloadingMessage'));

    // 清理功能可见性管理器
    if (this.featureVisibilityManager) {
      this.featureVisibilityManager.cleanup();
    }

    // 清理终端服务
    if (this._terminalService) {
      try {
        // TerminalService 会自动清理所有终端实例
        debugLog('[TerminalPlugin] Cleaning up TerminalService...');
      } catch (error) {
        errorLog('Failed to cleanup TerminalService:', error);
      }
    }

    // 停止服务器
    if (this._serverManager) {
      try {
        await this._serverManager.shutdown();
        debugLog('[TerminalPlugin] ServerManager stopped');
      } catch (error) {
        errorLog('Failed to stop ServerManager:', error);
      }
    }

    debugLog(t('plugin.unloadedMessage'));
  }

  /**
   * 加载设置
   */
  async loadSettings() {
    const loaded = await this.loadData();
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...loaded,
      // 确保 visibility 配置存在
      visibility: {
        ...DEFAULT_SETTINGS.visibility,
        ...loaded?.visibility,
      }
    };
  }

  /**
   * 保存设置
   */
  async saveSettings() {
    await this.saveData(this.settings);
    
    // 更新调试模式
    const { setDebugMode } = await import('./utils/logger');
    setDebugMode(this.settings.enableDebugLog);
    
    // 更新终端服务设置
    if (this._terminalService) {
      this._terminalService.updateSettings(this.settings);
    }
  }

  /**
   * 注册功能可见性配置
   */
  private registerFeatureVisibility(): void {
    this.featureVisibilityManager.registerFeature({
      id: 'terminal',
      getVisibility: () => this.settings.visibility,
      ribbon: {
        icon: 'terminal-square',
        tooltip: t('ribbon.terminalTooltip'),
        callback: () => this.activateTerminalView(),
      },
      onVisibilityChange: () => {
        // 当终端可见性设置变更时，更新新标签页中的终端按钮
        this.injectTerminalButtonToEmptyViews();
        // 更新状态栏显示
        this.updateStatusBar();
      },
    });
  }

  /**
   * 更新功能可见性
   * 在设置变更后调用
   */
  updateFeatureVisibility(): void {
    this.featureVisibilityManager.updateAllVisibility();
  }

  /**
   * 初始化状态栏
   */
  private initStatusBar(): void {
    this._statusBarItem = this.addStatusBarItem();
    this._statusBarItem.addClass('terminal-status-bar');
    this._statusBarItem.setText('>_');
    this._statusBarItem.setAttr('aria-label', t('ribbon.terminalTooltip'));
    this._statusBarItem.style.cursor = 'pointer';
    
    // 添加点击事件
    this._statusBarItem.addEventListener('click', () => {
      this.activateTerminalView();
    });
    
    // 根据设置决定是否显示
    this.updateStatusBar();
  }

  /**
   * 更新状态栏显示状态
   */
  private updateStatusBar(): void {
    if (!this._statusBarItem) return;
    
    const shouldShow = this.settings.visibility.enabled && 
                       this.settings.visibility.showInStatusBar;
    
    this._statusBarItem.style.display = shouldShow ? '' : 'none';
  }

  /**
   * 激活终端视图
   */
  async activateTerminalView(): Promise<void> {
    const { workspace } = this.app;
    
    const leaf = this.getLeafForNewTerminal();

    // 如果启用锁定新实例，设置标签页为锁定状态
    if (this.settings.lockNewInstance) {
      leaf.setPinned(true);
    }

    await leaf.setViewState({
      type: TERMINAL_VIEW_TYPE,
      active: this.settings.focusNewInstance,
    });

    // 如果启用聚焦新实例，切换到新标签页
    if (this.settings.focusNewInstance) {
      workspace.setActiveLeaf(leaf, { focus: true });
    }
  }

  /**
   * 注册所有命令
   */
  private registerCommands(): void {
    // 打开终端
    this.addCommand({
      id: 'open-terminal',
      name: t('commands.openTerminal'),
      hotkeys: [{ modifiers: ['Ctrl'], key: 'o' }],
      checkCallback: (checking: boolean) => {
        // 检查可见性配置
        if (!this.featureVisibilityManager.isVisibleAt('terminal', 'showInCommandPalette')) {
          return false;
        }
        if (!checking) {
          this.activateTerminalView();
        }
        return true;
      }
    });

    // 清屏
    this.addCommand({
      id: 'terminal-clear',
      name: t('commands.terminalClear'),
      hotkeys: [{ modifiers: ['Ctrl', 'Shift'], key: 'r' }],
      checkCallback: (checking: boolean) => {
        if (!this.featureVisibilityManager.isVisibleAt('terminal', 'showInCommandPalette')) {
          return false;
        }
        const terminalView = this.getActiveTerminalView();
        const terminal = terminalView?.getTerminalInstance();
        if (terminal) {
          if (!checking) {
            terminal.getXterm().clear();
          }
          return true;
        }
        return false;
      }
    });

    // 复制
    this.addCommand({
      id: 'terminal-copy',
      name: t('commands.terminalCopy'),
      hotkeys: [{ modifiers: ['Ctrl', 'Shift'], key: 'c' }],
      checkCallback: (checking: boolean) => {
        if (!this.featureVisibilityManager.isVisibleAt('terminal', 'showInCommandPalette')) {
          return false;
        }
        const terminalView = this.getActiveTerminalView();
        const terminal = terminalView?.getTerminalInstance();
        if (terminal && terminal.getXterm().hasSelection()) {
          if (!checking) {
            const selection = terminal.getXterm().getSelection();
            navigator.clipboard.writeText(selection);
          }
          return true;
        }
        return false;
      }
    });

    // 粘贴
    this.addCommand({
      id: 'terminal-paste',
      name: t('commands.terminalPaste'),
      hotkeys: [{ modifiers: ['Ctrl', 'Shift'], key: 'v' }],
      checkCallback: (checking: boolean) => {
        if (!this.featureVisibilityManager.isVisibleAt('terminal', 'showInCommandPalette')) {
          return false;
        }
        const terminalView = this.getActiveTerminalView();
        const terminal = terminalView?.getTerminalInstance();
        if (terminal) {
          if (!checking) {
            navigator.clipboard.readText().then(text => {
              terminal.write(text);
            });
          }
          return true;
        }
        return false;
      }
    });

    // 增大字体
    this.addCommand({
      id: 'terminal-font-increase',
      name: t('commands.terminalFontIncrease'),
      hotkeys: [{ modifiers: ['Ctrl'], key: '=' }],
      checkCallback: (checking: boolean) => {
        if (!this.featureVisibilityManager.isVisibleAt('terminal', 'showInCommandPalette')) {
          return false;
        }
        const terminalView = this.getActiveTerminalView();
        const terminal = terminalView?.getTerminalInstance();
        if (terminal) {
          if (!checking) {
            terminal.increaseFontSize();
          }
          return true;
        }
        return false;
      }
    });

    // 减小字体
    this.addCommand({
      id: 'terminal-font-decrease',
      name: t('commands.terminalFontDecrease'),
      hotkeys: [{ modifiers: ['Ctrl'], key: '-' }],
      checkCallback: (checking: boolean) => {
        if (!this.featureVisibilityManager.isVisibleAt('terminal', 'showInCommandPalette')) {
          return false;
        }
        const terminalView = this.getActiveTerminalView();
        const terminal = terminalView?.getTerminalInstance();
        if (terminal) {
          if (!checking) {
            terminal.decreaseFontSize();
          }
          return true;
        }
        return false;
      }
    });

    // 重置字体
    this.addCommand({
      id: 'terminal-font-reset',
      name: t('commands.terminalFontReset'),
      hotkeys: [{ modifiers: ['Ctrl'], key: '0' }],
      checkCallback: (checking: boolean) => {
        if (!this.featureVisibilityManager.isVisibleAt('terminal', 'showInCommandPalette')) {
          return false;
        }
        const terminalView = this.getActiveTerminalView();
        const terminal = terminalView?.getTerminalInstance();
        if (terminal) {
          if (!checking) {
            terminal.resetFontSize();
          }
          return true;
        }
        return false;
      }
    });

    // 水平分屏
    this.addCommand({
      id: 'terminal-split-horizontal',
      name: t('commands.terminalSplitHorizontal'),
      hotkeys: [{ modifiers: ['Ctrl', 'Shift'], key: 'h' }],
      checkCallback: (checking: boolean) => {
        if (!this.featureVisibilityManager.isVisibleAt('terminal', 'showInCommandPalette')) {
          return false;
        }
        const terminalView = this.getActiveTerminalView();
        if (terminalView) {
          if (!checking) {
            terminalView.splitTerminal('horizontal');
          }
          return true;
        }
        return false;
      }
    });

    // 垂直分屏
    this.addCommand({
      id: 'terminal-split-vertical',
      name: t('commands.terminalSplitVertical'),
      hotkeys: [{ modifiers: ['Ctrl', 'Shift'], key: 'j' }],
      checkCallback: (checking: boolean) => {
        if (!this.featureVisibilityManager.isVisibleAt('terminal', 'showInCommandPalette')) {
          return false;
        }
        const terminalView = this.getActiveTerminalView();
        if (terminalView) {
          if (!checking) {
            terminalView.splitTerminal('vertical');
          }
          return true;
        }
        return false;
      }
    });

    // 清空缓冲区
    this.addCommand({
      id: 'terminal-clear-buffer',
      name: t('commands.terminalClearBuffer'),
      hotkeys: [{ modifiers: ['Ctrl', 'Shift'], key: 'k' }],
      checkCallback: (checking: boolean) => {
        if (!this.featureVisibilityManager.isVisibleAt('terminal', 'showInCommandPalette')) {
          return false;
        }
        const terminalView = this.getActiveTerminalView();
        const terminal = terminalView?.getTerminalInstance();
        if (terminal) {
          if (!checking) {
            terminal.clearBuffer();
          }
          return true;
        }
        return false;
      }
    });
  }

  /**
   * 获取当前活动的终端视图
   */
  private getActiveTerminalView(): TerminalView | null {
    const leaves = this.app.workspace.getLeavesOfType(TERMINAL_VIEW_TYPE);
    const activeLeaf = this.app.workspace.activeLeaf;
    
    // 优先返回当前活动的终端视图
    if (activeLeaf?.view.getViewType() === TERMINAL_VIEW_TYPE) {
      return activeLeaf.view as TerminalView;
    }
    
    // 否则返回第一个终端视图
    return leaves.length > 0 ? leaves[0].view as TerminalView : null;
  }

  /**
   * 注册新标签页中的"打开终端"选项
   * 通过监听 layout-change 事件，在空标签页中注入自定义按钮
   */
  private registerNewTabTerminalAction(): void {
    this.registerEvent(
      this.app.workspace.on('layout-change', () => {
        this.injectTerminalButtonToEmptyViews();
      })
    );

    // 初始注入
    this.injectTerminalButtonToEmptyViews();
  }

  /**
   * 向所有空标签页注入"打开终端"按钮
   * 根据 showInNewTab 设置决定是否注入或移除按钮
   */
  private injectTerminalButtonToEmptyViews(): void {
    const shouldShow = this.settings.visibility.enabled && 
                       this.settings.visibility.showInNewTab;
    
    // 查找所有空视图
    const emptyViews = document.querySelectorAll('.workspace-leaf-content[data-type="empty"] .view-content');
    
    emptyViews.forEach((emptyView) => {
      const existingButton = emptyView.querySelector('.terminal-plugin-terminal-action');
      
      if (!shouldShow) {
        // 如果不应该显示，移除已存在的按钮
        if (existingButton) {
          existingButton.remove();
        }
        return;
      }
      
      // 检查是否已经注入过
      if (existingButton) {
        return;
      }

      // 查找操作容器
      const actionsContainer = emptyView.querySelector('.empty-state-action-list');
      if (!actionsContainer) {
        return;
      }

      // 创建"打开终端"按钮
      const terminalAction = document.createElement('div');
      terminalAction.className = 'empty-state-action terminal-plugin-terminal-action';
      terminalAction.textContent = t('commands.openTerminal') + ' (Ctrl+O)';
      terminalAction.addEventListener('click', async () => {
        await this.activateTerminalView();
      });

      // 添加到操作列表
      actionsContainer.appendChild(terminalAction);
    });
  }

  /**
   * 获取用于新终端的 leaf
   */
  private getLeafForNewTerminal(): WorkspaceLeaf {
    const { workspace } = this.app;
    const { leftSplit, rightSplit } = workspace;

    // 如果启用"在现有终端附近创建"
    if (this.settings.createInstanceNearExistingOnes) {
      const existingLeaves = workspace.getLeavesOfType(TERMINAL_VIEW_TYPE);
      const existingLeaf = existingLeaves[existingLeaves.length - 1];

      if (existingLeaf) {
        const root = existingLeaf.getRoot();

        // 如果在左侧栏，继续在左侧栏创建
        if (root === leftSplit) {
          const leftLeaf = workspace.getLeftLeaf(false);
          if (leftLeaf) return leftLeaf;
        }

        // 如果在右侧栏，继续在右侧栏创建
        if (root === rightSplit) {
          const rightLeaf = workspace.getRightLeaf(false);
          if (rightLeaf) return rightLeaf;
        }

        // 如果在主区域，设置为活动 leaf 并创建新标签页
        workspace.setActiveLeaf(existingLeaf);
        return workspace.getLeaf('tab');
      }
    }

    // 根据 newInstanceBehavior 创建新的 leaf
    const behavior = this.settings.newInstanceBehavior;

    switch (behavior) {
      case 'replaceTab':
        // 替换当前标签页
        return workspace.getLeaf();

      case 'newTab':
        // 新标签页：在当前标签组中创建新标签页
        return workspace.getLeaf('tab');

      case 'newLeftTab': {
        // 左侧新标签页
        const leftLeaf = workspace.getLeftLeaf(false);
        return leftLeaf ?? workspace.getLeaf('split');
      }

      case 'newLeftSplit': {
        // 左侧新分屏
        const leftLeaf = workspace.getLeftLeaf(true);
        return leftLeaf ?? workspace.getLeaf('split');
      }

      case 'newRightTab': {
        // 右侧新标签页
        const rightLeaf = workspace.getRightLeaf(false);
        return rightLeaf ?? workspace.getLeaf('split');
      }

      case 'newRightSplit': {
        // 右侧新分屏
        const rightLeaf = workspace.getRightLeaf(true);
        return rightLeaf ?? workspace.getLeaf('split');
      }

      case 'newHorizontalSplit':
        // 水平分屏：在右侧创建分屏
        return workspace.getLeaf('split', 'horizontal');

      case 'newVerticalSplit':
        // 垂直分屏：在下方创建分屏
        return workspace.getLeaf('split', 'vertical');

      case 'newWindow':
        // 新窗口：在新窗口中打开
        return workspace.getLeaf('window');

      default:
        // 默认：水平分屏
        return workspace.getLeaf('split', 'vertical');
    }
  }

  /**
   * 获取插件目录的绝对路径
   * 
   * @returns 插件目录的绝对路径
   */
  private getPluginDir(): string {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adapter = this.app.vault.adapter as any;
    const vaultPath = adapter.getBasePath();
    
    const manifestDir = this.manifest.dir || `.obsidian/plugins/${this.manifest.id}`;
    
    // 使用简单的路径拼接，避免依赖 Node.js path 模块
    const separator = vaultPath.includes('\\') ? '\\' : '/';
    return `${vaultPath}${separator}${manifestDir.replace(/\//g, separator)}`;
  }
}

/**
 * 终端视图占位符
 * 用于延迟加载终端视图，避免启动时加载 xterm.js
 */
class TerminalViewPlaceholder extends TerminalView {
  private plugin: TerminalPlugin;
  private realView: TerminalView | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: TerminalPlugin) {
    // 创建一个临时的 TerminalService（不会被使用）
    super(leaf, null as any);
    this.plugin = plugin;
  }

  async onOpen() {
    // 显示加载提示
    this.contentEl.createEl('div', { 
      text: t('terminal.loading'),
      cls: 'terminal-loading'
    });

    try {
      // 获取真实的 TerminalService
      const terminalService = await this.plugin.getTerminalService();
      
      // 创建真实的终端视图
      this.realView = new TerminalView(this.leaf, terminalService);
      
      // 清空占位内容
      this.contentEl.empty();
      
      // 调用真实视图的 onOpen
      await this.realView.onOpen();
      
      // 将真实视图的内容移动到当前容器
      if (this.realView.containerEl) {
        while (this.realView.contentEl.firstChild) {
          this.contentEl.appendChild(this.realView.contentEl.firstChild);
        }
      }
    } catch (error) {
      errorLog('[TerminalViewPlaceholder] Failed to initialize:', error);
      this.contentEl.empty();
      this.contentEl.createEl('div', { 
        text: t('terminal.initFailed', { message: error instanceof Error ? error.message : String(error) }),
        cls: 'terminal-error'
      });
    }
  }

  async onClose() {
    if (this.realView) {
      await this.realView.onClose();
    }
  }

  getDisplayText(): string {
    if (this.realView) {
      return this.realView.getDisplayText();
    }
    return t('terminal.defaultTitle');
  }
}
