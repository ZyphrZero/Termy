import type { View, WorkspaceLeaf } from 'obsidian';
import { FileSystemAdapter, Notice, Plugin, normalizePath } from 'obsidian';
import type { PresetScript, TerminalSettings } from './settings/settings';
import { PresetScriptModal } from './ui/terminal/presetScriptModal';
import { PRESET_SCRIPT_ICON_OPTIONS, renderPresetScriptIcon } from './ui/terminal/presetScriptIcons';
import { DEFAULT_SETTINGS } from './settings/settings';
import { TerminalSettingTab } from './settings/settingsTab';
import type { TerminalService } from './services/terminal/terminalService';
import type { ServerManager } from './services/server/serverManager';
import { TERMINAL_VIEW_TYPE, TerminalView } from './ui/terminal/terminalView';
import { i18n, t } from './i18n';
import { debugLog, errorLog } from './utils/logger';
import { createTermyLogoSvg } from './ui/icons';
import { FeatureVisibilityManager } from './services/visibility';

// 导入终端样式

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
  private _presetScriptsMenuEl: HTMLElement | null = null;
  private _presetScriptsMenuCleanup: (() => void) | null = null;

  // 已注册的预设脚本命令
  private registeredPresetScriptCommandIds: Set<string> = new Set();

  /**
   * 获取服务器管理器（延迟初始化）
   */
  async getServerManager(): Promise<ServerManager> {
    if (!this._serverManager) {
      debugLog('[TerminalPlugin] Initializing ServerManager...');
      
      const { ServerManager } = await import('./services/server/serverManager');
      
      const pluginDir = this.getPluginDir();
      const version = this.manifest.version;
      const downloadAcceleratorUrl = this.settings.serverConnection?.downloadAcceleratorUrl ?? '';
      const offlineMode = this.settings.serverConnection?.offlineMode ?? false;
      
      this._serverManager = new ServerManager(
        pluginDir,
        version,
        downloadAcceleratorUrl,
        this.settings.enableDebugLog,
        offlineMode
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

    // UI 初始化尽量延后到布局就绪
    this.app.workspace.onLayoutReady(() => {
      this.initStatusBar();
      if (this.settings.visibility.showInNewTab) {
        this.registerNewTabTerminalAction();
      }
    });

    // 添加设置标签页
    this.addSettingTab(new TerminalSettingTab(this.app, this));

    debugLog(t('plugin.loadedMessage'));
  }

  /**
   * 插件卸载时调用
   */
  onunload(): void {
    void this.handleUnload();
  }

  private async handleUnload(): Promise<void> {
    debugLog(t('plugin.unloadingMessage'));

    // 清理功能可见性管理器
    if (this.featureVisibilityManager) {
      this.featureVisibilityManager.cleanup();
    }

    // 清理终端服务（会自动清理所有终端实例）
    if (this._terminalService) {
      try {
        debugLog('[TerminalPlugin] Shutting down TerminalService...');
        await this._terminalService.shutdown();
        debugLog('[TerminalPlugin] TerminalService stopped');
      } catch (error) {
        errorLog('[TerminalPlugin] Failed to shutdown TerminalService:', error);
      }
    }

    // 停止服务器
    if (this._serverManager) {
      try {
        debugLog('[TerminalPlugin] Shutting down ServerManager...');
        await this._serverManager.shutdown();
        debugLog('[TerminalPlugin] ServerManager stopped');
      } catch (error) {
        errorLog('[TerminalPlugin] Failed to stop ServerManager:', error);
      }
    }

    debugLog(t('plugin.unloadedMessage'));
  }

  /**
   * 加载设置
   */
  async loadSettings() {
    const loaded = await this.loadData();
    const presetScripts = Array.isArray(loaded?.presetScripts)
      ? loaded.presetScripts
      : DEFAULT_SETTINGS.presetScripts;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...loaded,
      // 确保 visibility 配置存在
      visibility: {
        ...DEFAULT_SETTINGS.visibility,
        ...loaded?.visibility,
      },
      // 确保 serverConnection 配置存在
      serverConnection: {
        ...DEFAULT_SETTINGS.serverConnection,
        ...loaded?.serverConnection,
      },
      // 确保 presetScripts 配置存在
      presetScripts,
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
    
    // 更新 ServerManager 配置
    if (this._serverManager) {
      this._serverManager.updateDebugMode(this.settings.enableDebugLog);
      this._serverManager.updateOfflineMode(this.settings.serverConnection.offlineMode);
      this._serverManager.updateDownloadAcceleratorUrl(this.settings.serverConnection.downloadAcceleratorUrl);
    }

    // 更新终端服务设置
    if (this._terminalService) {
      this._terminalService.updateSettings(this.settings);
    }

    // 注册新增的预设脚本命令
    this.registerPresetScriptCommands();
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
        callback: () => {
          void this.activateTerminalView();
        },
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
    this._statusBarItem.addClass('is-clickable');
    this._statusBarItem.setAttr('aria-label', t('ribbon.terminalTooltip'));

    // 创建 SVG icon + 文字
    const iconEl = createTermyLogoSvg(18);
    iconEl.addClass('terminal-status-bar-icon');
    const labelEl = document.createElement('span');
    labelEl.addClass('terminal-status-bar-label');
    labelEl.textContent = 'Termy';
    this._statusBarItem.append(iconEl, labelEl);
    
    // 添加点击事件
    this._statusBarItem.addEventListener('click', (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      this.togglePresetScriptsMenu(event);
    });
    
    // 右键菜单：预设脚本
    this._statusBarItem.addEventListener('contextmenu', (event: MouseEvent) => {
      event.preventDefault();
      this.togglePresetScriptsMenu(event);
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
    
    this._statusBarItem.toggleClass('is-hidden', !shouldShow);
  }

  /**
   * 激活终端视图
   */
  async activateTerminalView(targetLeaf?: WorkspaceLeaf): Promise<void> {
    const { workspace } = this.app;
    
    const leaf = targetLeaf ?? this.getLeafForNewTerminal();

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
      checkCallback: (checking: boolean) => {
        // 检查可见性配置
        if (!this.featureVisibilityManager.isVisibleAt('terminal', 'showInCommandPalette')) {
          return false;
        }
        if (!checking) {
          void this.activateTerminalView();
        }
        return true;
      }
    });

    // 清屏
    this.addCommand({
      id: 'terminal-clear',
      name: t('commands.terminalClear'),
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
      checkCallback: (checking: boolean) => {
        if (!this.featureVisibilityManager.isVisibleAt('terminal', 'showInCommandPalette')) {
          return false;
        }
        const terminalView = this.getActiveTerminalView();
        const terminal = terminalView?.getTerminalInstance();
        if (terminal && terminal.getXterm().hasSelection()) {
          if (!checking) {
            const selection = terminal.getXterm().getSelection();
            void navigator.clipboard.writeText(selection).catch((error) => {
              errorLog('[TerminalPlugin] Copy failed:', error);
            });
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
      checkCallback: (checking: boolean) => {
        if (!this.featureVisibilityManager.isVisibleAt('terminal', 'showInCommandPalette')) {
          return false;
        }
        const terminalView = this.getActiveTerminalView();
        const terminal = terminalView?.getTerminalInstance();
        if (terminal) {
          if (!checking) {
            void navigator.clipboard.readText()
              .then((text) => {
                terminal.write(text);
              })
              .catch((error) => {
                errorLog('[TerminalPlugin] Paste failed:', error);
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
      checkCallback: (checking: boolean) => {
        if (!this.featureVisibilityManager.isVisibleAt('terminal', 'showInCommandPalette')) {
          return false;
        }
        const terminalView = this.getActiveTerminalView();
        if (terminalView) {
          if (!checking) {
            void terminalView.splitTerminal('horizontal');
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
      checkCallback: (checking: boolean) => {
        if (!this.featureVisibilityManager.isVisibleAt('terminal', 'showInCommandPalette')) {
          return false;
        }
        const terminalView = this.getActiveTerminalView();
        if (terminalView) {
          if (!checking) {
            void terminalView.splitTerminal('vertical');
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

    // 注册预设脚本命令
    this.registerPresetScriptCommands();
  }

  private registerPresetScriptCommands(): void {
    const scripts = this.settings.presetScripts ?? [];
    scripts.forEach((script) => {
      const commandId = this.getPresetScriptCommandId(script.id);
      if (this.registeredPresetScriptCommandIds.has(commandId)) return;

      this.registeredPresetScriptCommandIds.add(commandId);

      this.addCommand({
        id: commandId,
        name: `${t('commands.presetScriptPrefix')}${script.name || t('settingsDetails.terminal.presetScriptsUnnamed')}`,
        checkCallback: (checking: boolean) => {
          if (!this.featureVisibilityManager.isVisibleAt('terminal', 'showInCommandPalette')) {
            return false;
          }
          const currentScript = this.getPresetScriptById(script.id);
          if (!currentScript) return false;
          if (!(currentScript.showInStatusBar ?? true)) {
            return false;
          }
          if (!checking) {
            this.runPresetScript(currentScript).catch((error) => {
              const message = error instanceof Error ? error.message : String(error);
              new Notice(t('notices.presetScript.runFailed', { message }));
            });
          }
          return true;
        }
      });
    });
  }

  /**
   * 获取当前活动的终端视图
   */
  private getActiveTerminalView(): TerminalView | null {
    const activeView = this.app.workspace.getActiveViewOfType(TerminalView);
    
    // 优先返回当前活动的终端视图
    if (activeView) {
      return activeView;
    }
    
    // 否则返回第一个终端视图
    const leaves = this.app.workspace.getLeavesOfType(TERMINAL_VIEW_TYPE);
    const view = leaves.map((item) => item.view).find((item) => this.isTerminalView(item));
    return view ?? null;
  }

  private isTerminalView(view: View | null | undefined): view is TerminalView {
    return !!view && view.getViewType() === TERMINAL_VIEW_TYPE;
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
      terminalAction.textContent = t('commands.openTerminal');
      terminalAction.addEventListener('click', () => {
        const leaf = this.findLeafByEmptyView(emptyView);
        void this.activateTerminalView(leaf ?? undefined);
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

  private getPresetScriptById(scriptId: string): PresetScript | null {
    const scripts = this.settings.presetScripts ?? [];
    return scripts.find(script => script.id === scriptId) ?? null;
  }

  private findLeafByEmptyView(emptyView: Element): WorkspaceLeaf | null {
    const leaves = this.app.workspace.getLeavesOfType('empty');
    for (const leaf of leaves) {
      const view = leaf.view;
      if (this.hasContentEl(view) && view.contentEl === emptyView) {
        return leaf;
      }
    }
    return null;
  }

  private hasContentEl(view: unknown): view is { contentEl: Element } {
    return typeof view === 'object' && view !== null && 'contentEl' in view;
  }

  private getPresetScriptCommandId(scriptId: string): string {
    return `preset-script-${scriptId}`;
  }

  private createPresetScriptId(): string {
    const random = Math.random().toString(36).slice(2, 8);
    return `preset-${Date.now()}-${random}`;
  }

  private openPresetScriptCreateModal(): void {
    const scripts = this.settings.presetScripts ?? [];
    let newId = this.createPresetScriptId();
    while (scripts.some(script => script.id === newId)) {
      newId = this.createPresetScriptId();
    }
    const newScript: PresetScript = {
      id: newId,
      name: '',
      icon: PRESET_SCRIPT_ICON_OPTIONS[0] || 'terminal',
      command: '',
      terminalTitle: '',
      showInStatusBar: true,
      autoOpenTerminal: true,
      runInNewTerminal: false,
    };
    const modal = new PresetScriptModal(this.app, newScript, (updatedScript) => {
      scripts.push(updatedScript);
      this.settings.presetScripts = scripts;
      void this.saveSettings();
    }, true);
    modal.open();
  }

  private togglePresetScriptsMenu(event: MouseEvent): void {
    if (this._presetScriptsMenuEl) {
      this.closePresetScriptsMenu();
      return;
    }
    const anchorRect = this._statusBarItem?.getBoundingClientRect();
    if (anchorRect) {
      this.showPresetScriptsMenuAtRect(anchorRect);
    } else {
      this.showPresetScriptsMenuAtPoint(event.clientX, event.clientY);
    }
  }

  private showPresetScriptsMenuAtPoint(x: number, y: number): void {
    const menu = this.buildPresetScriptsMenu();
    if (!menu) return;
    menu.setCssStyles({ left: `${x}px`, top: `${y}px` });
    this.mountPresetScriptsMenu(menu);
    this.adjustPresetScriptsMenuPosition(menu);
  }

  private showPresetScriptsMenuAtRect(rect: DOMRect): void {
    const menu = this.buildPresetScriptsMenu();
    if (!menu) return;
    menu.setCssStyles({ left: `${rect.left}px`, top: `${rect.top}px` });
    this.mountPresetScriptsMenu(menu);
    const menuRect = menu.getBoundingClientRect();
    let top = rect.top - menuRect.height - 8;
    if (top < 8) {
      top = rect.bottom + 8;
    }
    let left = rect.left;
    if (left + menuRect.width > window.innerWidth - 8) {
      left = window.innerWidth - menuRect.width - 8;
    }
    if (left < 8) left = 8;
    menu.setCssStyles({ top: `${top}px`, left: `${left}px` });
  }

  private mountPresetScriptsMenu(menu: HTMLElement): void {
    this.closePresetScriptsMenu();
    document.body.appendChild(menu);
    this._presetScriptsMenuEl = menu;

    const onOutsideClick = (event: MouseEvent) => {
      if (!menu.contains(event.target as Node)) {
        this.closePresetScriptsMenu();
      }
    };
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        this.closePresetScriptsMenu();
      }
    };
    document.addEventListener('mousedown', onOutsideClick, true);
    document.addEventListener('keydown', onKeydown, true);
    this._presetScriptsMenuCleanup = () => {
      document.removeEventListener('mousedown', onOutsideClick, true);
      document.removeEventListener('keydown', onKeydown, true);
    };
  }

  private adjustPresetScriptsMenuPosition(menu: HTMLElement): void {
    const rect = menu.getBoundingClientRect();
    let left = rect.left;
    let top = rect.top;
    if (rect.right > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - rect.width - 8);
    }
    if (rect.bottom > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - rect.height - 8);
    }
    menu.setCssStyles({ left: `${left}px`, top: `${top}px` });
  }

  private buildPresetScriptsMenu(): HTMLElement | null {
    const scripts = (this.settings.presetScripts ?? []);
    const visibleScripts = scripts.filter(script => script.showInStatusBar ?? true);
    const menu = document.createElement('div');
    menu.className = 'preset-scripts-menu';
    menu.setAttribute('role', 'menu');

    if (visibleScripts.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'preset-scripts-menu-item is-disabled';
      empty.textContent = t('settingsDetails.terminal.presetScriptsEmpty');
      menu.appendChild(empty);
    }

    visibleScripts.forEach((script) => {
      const item = document.createElement('div');
      item.className = 'preset-scripts-menu-item';
      item.setAttribute('role', 'menuitem');

      const iconEl = document.createElement('div');
      iconEl.className = 'preset-scripts-menu-icon';
      renderPresetScriptIcon(iconEl, script.icon || 'terminal');

      const labelEl = document.createElement('div');
      labelEl.className = 'preset-scripts-menu-label';
      labelEl.textContent = script.name || t('settingsDetails.terminal.presetScriptsUnnamed');

      item.appendChild(iconEl);
      item.appendChild(labelEl);
      item.addEventListener('click', () => {
        this.closePresetScriptsMenu();
        this.runPresetScript(script).catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          new Notice(t('notices.presetScript.runFailed', { message }));
        });
      });

      menu.appendChild(item);
    });

    const addItem = document.createElement('div');
    addItem.className = 'preset-scripts-menu-item preset-scripts-menu-add';
    addItem.setAttribute('role', 'menuitem');
    addItem.textContent = `+ ${t('settingsDetails.terminal.presetScriptsAddMenu')}`;
    addItem.addEventListener('click', () => {
      this.closePresetScriptsMenu();
      this.openPresetScriptCreateModal();
    });
    menu.appendChild(addItem);

    return menu;
  }

  private closePresetScriptsMenu(): void {
    if (this._presetScriptsMenuCleanup) {
      this._presetScriptsMenuCleanup();
      this._presetScriptsMenuCleanup = null;
    }
    if (this._presetScriptsMenuEl) {
      this._presetScriptsMenuEl.remove();
      this._presetScriptsMenuEl = null;
    }
  }

  private async runPresetScript(script: PresetScript): Promise<void> {
    if (!script) {
      new Notice(t('notices.presetScript.notFound'));
      return;
    }

    const command = (script.command || '').trim();
    if (!command) {
      new Notice(t('notices.presetScript.emptyCommand'));
      return;
    }

    let terminalView = this.getActiveTerminalView();

    if (script.runInNewTerminal) {
      await this.activateTerminalView(this.getLeafForNewTerminal());
      terminalView = this.getActiveTerminalView();
    } else if (script.autoOpenTerminal && !terminalView) {
      await this.activateTerminalView();
      terminalView = this.getActiveTerminalView();
    }

    if (!terminalView) {
      new Notice(t('notices.presetScript.terminalUnavailable'));
      return;
    }

    const terminal = await terminalView.waitForTerminalInstance();
    const title = (script.terminalTitle || '').trim();
    if (title) {
      terminal.setTitle(title);
      this.updateLeafHeader(terminalView.leaf);
    }
    const normalizedCommand = this.normalizePresetScriptCommand(command);
    terminal.write(normalizedCommand);
    terminal.focus();
  }

  private normalizePresetScriptCommand(command: string): string {
    const normalized = command.replace(/\r?\n/g, '\r').trimEnd();
    return normalized.endsWith('\r') ? normalized : `${normalized}\r`;
  }

  private updateLeafHeader(leaf: WorkspaceLeaf): void {
    const leafWithHeader = leaf as WorkspaceLeaf & { updateHeader?: () => void };
    leafWithHeader.updateHeader?.();
  }

  /**
   * 获取插件目录的绝对路径
   * 
   * @returns 插件目录的绝对路径
   */
  private getPluginDir(): string {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      throw new Error('FileSystemAdapter is not available');
    }
    const vaultPath = normalizePath(adapter.getBasePath());
    const configDir = normalizePath(this.app.vault.configDir);
    const manifestDir = this.manifest.dir
      ? normalizePath(this.manifest.dir)
      : normalizePath(`${configDir}/plugins/${this.manifest.id}`);

    if (this.isAbsolutePath(manifestDir)) {
      return manifestDir;
    }

    return normalizePath(`${vaultPath}/${manifestDir}`);
  }

  private isAbsolutePath(path: string): boolean {
    return path.startsWith('/') || /^[A-Za-z]:\//.test(path);
  }
}

/**
 * 终端视图占位符
 * 用于延迟加载终端视图，避免启动时加载 xterm.js
 */
class TerminalViewPlaceholder extends TerminalView {
  private plugin: TerminalPlugin;
  private initialized = false;
  private initializing = false;

  constructor(leaf: WorkspaceLeaf, plugin: TerminalPlugin) {
    // 延迟注入 TerminalService，避免启动时加载 xterm.js
    super(leaf, null);
    this.plugin = plugin;
  }

  async onOpen() {
    if (this.initialized || this.initializing) return;
    this.initializing = true;

    // 显示加载提示
    this.contentEl.empty();
    this.contentEl.createEl('div', {
      text: t('terminal.loading'),
      cls: 'terminal-loading'
    });

    try {
      // 获取真实的 TerminalService
      const terminalService = await this.plugin.getTerminalService();

      this.setTerminalService(terminalService);

      // 清空占位内容并初始化终端视图
      this.contentEl.empty();
      await super.onOpen();
      this.initialized = true;
    } catch (error) {
      errorLog('[TerminalViewPlaceholder] Failed to initialize:', error);
      this.contentEl.empty();
      this.contentEl.createEl('div', { 
        text: t('terminal.initFailed', { message: error instanceof Error ? error.message : String(error) }),
        cls: 'terminal-error'
      });
    } finally {
      this.initializing = false;
    }
  }

  async onClose() {
    await super.onClose();
  }
}
