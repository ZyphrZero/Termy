import type { WorkspaceLeaf, Menu } from 'obsidian';
import { ItemView, Notice, setIcon } from 'obsidian';
import type { TerminalService } from '../../services/terminal/terminalService';
import type { TerminalInstance } from '../../services/terminal/terminalInstance';
import type { TerminalSettings } from '../../settings/settings';
import { errorLog } from '../../utils/logger';
import { clamp, normalizeBackgroundPosition, normalizeBackgroundSize, toCssUrl } from '../../utils/styleUtils';
import { t } from '../../i18n';
import { RenameTerminalModal } from './renameTerminalModal';

export const TERMINAL_VIEW_TYPE = 'terminal-view';

/**
 * 终端视图类
 */
export class TerminalView extends ItemView {
  protected terminalService: TerminalService | null;
  private terminalInstance: TerminalInstance | null = null;
  private terminalContainer: HTMLElement | null = null;
  private searchContainer: HTMLElement | null = null;
  private searchInput: HTMLInputElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private initPromise: Promise<TerminalInstance> | null = null;
  private initResolve: ((terminal: TerminalInstance) => void) | null = null;
  private initReject: ((error: Error) => void) | null = null;

  constructor(leaf: WorkspaceLeaf, terminalService: TerminalService | null) {
    super(leaf);
    this.terminalService = terminalService;
    this.initPromise = new Promise<TerminalInstance>((resolve, reject) => {
      this.initResolve = resolve;
      this.initReject = reject;
    });
  }

  getViewType(): string { return TERMINAL_VIEW_TYPE; }

  getDisplayText(): string {
    return this.terminalInstance?.getTitle() || t('terminal.defaultTitle');
  }

  getIcon(): string { return 'terminal'; }

  onPaneMenu(menu: Menu): void {
    // Obsidian 可能会传入包装对象，需要获取真实的视图实例
    const view = (this as TerminalView & { realView?: TerminalView }).realView ?? this;
    
    menu.addItem((item) => {
      item.setTitle(t('terminal.renameTerminal'))
        .setIcon('pencil')
        .onClick(() => {
          if (!view.terminalInstance) {
            new Notice(t('terminal.notInitialized'));
            return;
          }
          
          const currentTitle = view.terminalInstance.getTitle();
          
          new RenameTerminalModal(
            view.app,
            currentTitle,
            (newTitle: string) => {
              if (view.terminalInstance && newTitle.trim()) {
                const trimmedTitle = newTitle.trim();
                view.terminalInstance.setTitle(trimmedTitle);
                this.updateLeafHeader(view.leaf);
              }
            }
          ).open();
        });
    });
  }

  onOpen(): Promise<void> {
    // 使用 contentEl 而不是 containerEl.children[1]
    const container = this.contentEl;
    container.empty();
    container.addClass('terminal-view-container');

    // 创建搜索栏容器
    this.searchContainer = container.createDiv('terminal-search-container');
    this.createSearchUI();

    this.terminalContainer = container.createDiv('terminal-container');

    setTimeout(() => {
      if (!this.terminalInstance && this.terminalContainer) {
        void this.initializeTerminal();
      }
    }, 0);
    return Promise.resolve();
  }

  /**
   * 创建搜索 UI
   */
  private createSearchUI(): void {
    if (!this.searchContainer) return;

    // 搜索输入框
    this.searchInput = document.createElement('input');
    this.searchInput.type = 'text';
    this.searchInput.placeholder = t('terminal.search.placeholder');
    this.searchInput.className = 'terminal-search-input';

    // 搜索输入事件
    this.searchInput.addEventListener('input', () => {
      this.performSearch();
    });

    this.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          this.terminalInstance?.searchPrevious();
        } else {
          this.terminalInstance?.searchNext();
        }
      } else if (e.key === 'Escape') {
        this.hideSearch();
      }
    });

    this.searchContainer.appendChild(this.searchInput);

    // 上一个按钮
    const prevBtn = this.createSearchButton('chevron-up', t('terminal.search.previous'), () => {
      this.terminalInstance?.searchPrevious();
    });
    this.searchContainer.appendChild(prevBtn);

    // 下一个按钮
    const nextBtn = this.createSearchButton('chevron-down', t('terminal.search.next'), () => {
      this.terminalInstance?.searchNext();
    });
    this.searchContainer.appendChild(nextBtn);

    // 关闭按钮
    const closeBtn = this.createSearchButton('x', t('terminal.search.close'), () => {
      this.hideSearch();
    });
    this.searchContainer.appendChild(closeBtn);
  }

  /**
   * 创建搜索按钮
   */
  private createSearchButton(icon: string, title: string, onClick: () => void): HTMLElement {
    const btn = document.createElement('button');
    btn.className = 'terminal-search-btn clickable-icon';
    btn.title = title;
    setIcon(btn, icon);
    btn.addEventListener('click', onClick);
    return btn;
  }

  /**
   * 执行搜索
   */
  private performSearch(): void {
    const query = this.searchInput?.value || '';
    this.terminalInstance?.search(query);
  }

  /**
   * 显示搜索栏
   */
  showSearch(): void {
    if (this.searchContainer) {
      this.searchContainer.addClass('is-visible');
      this.searchInput?.focus();
      this.searchInput?.select();
    }
  }

  /**
   * 隐藏搜索栏
   */
  hideSearch(): void {
    if (this.searchContainer) {
      this.searchContainer.removeClass('is-visible');
    }
    this.terminalInstance?.clearSearch();
    this.terminalInstance?.focus();
  }

  async onClose(): Promise<void> {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    if (this.terminalInstance) {
      try {
        await this.terminalService?.destroyTerminal(this.terminalInstance.id);
      } catch (error) {
        errorLog('[TerminalView] Destroy failed:', error);
      }
      this.terminalInstance = null;
    }

    this.containerEl.empty();
    this.disposeAppearanceStyle();
  }

  setTerminalService(terminalService: TerminalService): void {
    this.terminalService = terminalService;
  }

  private async initializeTerminal(): Promise<void> {
    try {
      if (!this.terminalService) {
        throw new Error('TerminalService not initialized');
      }

      this.terminalInstance = await this.terminalService.createTerminal();
      this.initResolve?.(this.terminalInstance);
      this.initResolve = null;
      this.initReject = null;

      this.terminalInstance.onTitleChange(() => {
        this.updateLeafHeader(this.leaf);
      });

      // 设置搜索状态回调
      this.terminalInstance.onSearchStateChange((visible) => {
        if (visible) {
          this.showSearch();
        } else {
          this.hideSearch();
        }
      });

      // 设置右键菜单回调
      this.terminalInstance.setOnNewTerminal(() => {
        void this.createNewTerminal();
      });

      this.terminalInstance.setOnSplitTerminal((direction) => {
        void this.splitTerminal(direction);
      });

      this.updateAppearanceStyles();
      this.renderTerminal();
      this.setupResizeObserver();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errorLog('[TerminalView] Init failed:', errorMessage);
      if (this.initReject) {
        this.initReject(error instanceof Error ? error : new Error(errorMessage));
        this.initResolve = null;
        this.initReject = null;
      }
      new Notice(t('notices.terminal.initFailed', { message: errorMessage }));
      this.leaf.detach();
    }
  }

  /**
   * 创建新终端
   */
  private async createNewTerminal(): Promise<void> {
    // 触发插件的 activateTerminalView 方法
    // 通过 workspace 获取插件实例
    const plugin = this.getTerminalPlugin();
    if (plugin) {
      await plugin.activateTerminalView();
    }
  }

  /**
   * 拆分终端（供命令使用）
   */
  async splitTerminal(direction: 'horizontal' | 'vertical'): Promise<void> {
    const { workspace } = this.app;
    const newLeaf = workspace.getLeaf('split', direction);
    
    await newLeaf.setViewState({
      type: TERMINAL_VIEW_TYPE,
      active: true,
    });

    workspace.setActiveLeaf(newLeaf, { focus: true });
  }

  private updateAppearanceStyles(): void {
    if (!this.terminalContainer || !this.terminalInstance) return;

    const options = this.terminalInstance.getOptions();
    const canUseBackgroundImage = !!options?.backgroundImage
      && !options?.useObsidianTheme
      && this.terminalInstance.getCurrentRenderer() !== 'webgl';

    if (canUseBackgroundImage) {
      this.terminalContainer.addClass('has-background-image');
      this.containerEl.querySelector('.terminal-view-container')?.addClass('has-background-image');
      this.ensureBackgroundLayer();
    } else {
      this.terminalContainer.removeClass('has-background-image');
      this.containerEl.querySelector('.terminal-view-container')?.removeClass('has-background-image');
      this.terminalContainer.querySelector('.terminal-background-image')?.remove();
    }

    const backgroundImageOpacity = options?.backgroundImageOpacity ?? 0.5;
    const overlayOpacity = canUseBackgroundImage
      ? clamp(1 - backgroundImageOpacity, 0, 1)
      : 0;
    const blurAmount = options?.blurAmount ?? 0;
    const blurEnabled = canUseBackgroundImage && !!options?.enableBlur && blurAmount > 0;

    this.applyAppearanceStyleRule({
      backgroundImage: canUseBackgroundImage ? toCssUrl(options?.backgroundImage) : 'none',
      overlayOpacity,
      backgroundSize: normalizeBackgroundSize(options?.backgroundImageSize),
      backgroundPosition: normalizeBackgroundPosition(options?.backgroundImagePosition),
      blur: blurEnabled ? `${blurAmount}px` : '0px',
      scale: blurEnabled ? '1.05' : '1',
      textOpacity: canUseBackgroundImage ? String(options?.textOpacity ?? 1.0) : '1',
    });
  }

  private renderTerminal(): void {
    if (!this.terminalContainer || !this.terminalInstance) {
      errorLog('[TerminalView] Render failed: missing container or instance');
      return;
    }

    const bgLayer = this.terminalContainer.querySelector('.terminal-background-image');
    this.terminalContainer.empty();
    if (bgLayer) this.terminalContainer.appendChild(bgLayer);

    try {
      this.terminalInstance.attachToElement(this.terminalContainer);
    } catch (error) {
      errorLog('[TerminalView] Attach failed:', error);
      new Notice(t('notices.terminal.renderFailed', { message: String(error) }));
      return;
    }

    setTimeout(() => {
      if (this.terminalInstance?.isAlive()) {
        this.terminalInstance.fit();
        this.terminalInstance.focus();
      }
    }, 100);
  }

  private setupResizeObserver(): void {
    if (!this.terminalContainer) return;

    let resizeTimeout: NodeJS.Timeout | null = null;

    this.resizeObserver = new ResizeObserver((entries) => {
      if (resizeTimeout) clearTimeout(resizeTimeout);

      resizeTimeout = setTimeout(() => {
        if (this.terminalInstance?.isAlive()) {
          const { width, height } = entries[0].contentRect;
          if (width > 0 && height > 0) {
            this.terminalInstance.fit();
          }
        }
      }, 100);
    });

    this.resizeObserver.observe(this.terminalContainer);
  }

  /**
   * 刷新主题/背景相关外观
   */
  refreshAppearance(): void {
    if (!this.terminalInstance) return;

    const plugin = this.getTerminalPlugin();
    if (!plugin) return;

    const settings = plugin.settings;

    this.terminalInstance.updateOptions({
      useObsidianTheme: settings.useObsidianTheme,
      backgroundColor: settings.backgroundColor,
      foregroundColor: settings.foregroundColor,
      backgroundImage: settings.backgroundImage,
      backgroundImageOpacity: settings.backgroundImageOpacity,
      backgroundImageSize: settings.backgroundImageSize,
      backgroundImagePosition: settings.backgroundImagePosition,
      enableBlur: settings.enableBlur,
      blurAmount: settings.blurAmount,
      textOpacity: settings.textOpacity,
      preferredRenderer: settings.preferredRenderer,
    });

    this.updateAppearanceStyles();
  }

  private ensureBackgroundLayer(): void {
    if (!this.terminalContainer) return;
    const existingLayer = this.terminalContainer.querySelector('.terminal-background-image');
    if (existingLayer) return;

    const bgLayer = document.createElement('div');
    bgLayer.className = 'terminal-background-image';
    this.terminalContainer.prepend(bgLayer);
  }

  private applyAppearanceStyleRule(vars: {
    backgroundImage: string;
    overlayOpacity: number;
    backgroundSize: string;
    backgroundPosition: string;
    blur: string;
    scale: string;
    textOpacity: string;
  }): void {
    if (!this.terminalContainer) return;
    const style = this.terminalContainer.style;
    style.setProperty('--terminal-bg-image', vars.backgroundImage);
    style.setProperty('--terminal-bg-overlay-opacity', String(vars.overlayOpacity));
    style.setProperty('--terminal-bg-size', vars.backgroundSize);
    style.setProperty('--terminal-bg-position', vars.backgroundPosition);
    style.setProperty('--terminal-bg-blur', vars.blur);
    style.setProperty('--terminal-bg-scale', vars.scale);
    style.setProperty('--terminal-text-opacity', vars.textOpacity);
  }

  private disposeAppearanceStyle(): void {
    if (!this.terminalContainer) return;
    const style = this.terminalContainer.style;
    style.removeProperty('--terminal-bg-image');
    style.removeProperty('--terminal-bg-overlay-opacity');
    style.removeProperty('--terminal-bg-size');
    style.removeProperty('--terminal-bg-position');
    style.removeProperty('--terminal-bg-blur');
    style.removeProperty('--terminal-bg-scale');
    style.removeProperty('--terminal-text-opacity');
  }

  /**
   * 获取终端实例（供外部调用）
   */
  getTerminalInstance(): TerminalInstance | null {
    return this.terminalInstance;
  }

  async waitForTerminalInstance(timeoutMs = 8000): Promise<TerminalInstance> {
    if (this.terminalInstance) return this.terminalInstance;
    if (!this.initPromise) {
      throw new Error(t('terminal.notInitialized'));
    }

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(t('terminal.notInitialized'))), timeoutMs);
    });

    return Promise.race([this.initPromise, timeoutPromise]);
  }

  private updateLeafHeader(leaf: WorkspaceLeaf): void {
    const leafWithHeader = leaf as WorkspaceLeaf & { updateHeader?: () => void };
    leafWithHeader.updateHeader?.();
  }

  private getTerminalPlugin(): { settings: TerminalSettings; activateTerminalView: () => Promise<void> } | null {
    const appWithPlugins = this.app as typeof this.app & {
      plugins?: { getPlugin?: (id: string) => unknown };
    };
    const plugin = appWithPlugins.plugins?.getPlugin?.('termy');
    if (!this.isTerminalPlugin(plugin)) return null;
    return plugin;
  }

  private isTerminalPlugin(value: unknown): value is { settings: TerminalSettings; activateTerminalView: () => Promise<void> } {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as { settings?: unknown; activateTerminalView?: unknown };
    return typeof candidate.activateTerminalView === 'function' && typeof candidate.settings === 'object';
  }
}
