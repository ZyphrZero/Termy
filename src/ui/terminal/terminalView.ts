import type { WorkspaceLeaf, Menu } from 'obsidian';
import { ItemView, Notice } from 'obsidian';
import type { TerminalService } from '../../services/terminal/terminalService';
import type { TerminalInstance } from '../../services/terminal/terminalInstance';
import { errorLog } from '../../utils/logger';
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

  constructor(leaf: WorkspaceLeaf, terminalService: TerminalService | null) {
    super(leaf);
    this.terminalService = terminalService;
  }

  getViewType(): string { return TERMINAL_VIEW_TYPE; }

  getDisplayText(): string {
    return this.terminalInstance?.getTitle() || t('terminal.defaultTitle');
  }

  getIcon(): string { return 'terminal'; }

  onPaneMenu(menu: Menu): void {
    // Obsidian 可能会传入包装对象，需要获取真实的视图实例
    const view = (this as any).realView || this;
    
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
                (view.leaf as any).updateHeader();
              }
            }
          ).open();
        });
    });
  }

  async onOpen(): Promise<void> {
    // 使用 contentEl 而不是 containerEl.children[1]
    const container = this.contentEl;
    container.empty();
    container.addClass('terminal-view-container');
    
    Object.assign(container.style, {
      padding: '0', margin: '0', height: '100%', width: '100%',
      display: 'flex', flexDirection: 'column', overflow: 'hidden'
    });

    // 创建搜索栏容器
    this.searchContainer = container.createDiv('terminal-search-container');
    this.searchContainer.style.display = 'none';
    this.createSearchUI();

    this.terminalContainer = container.createDiv('terminal-container');
    Object.assign(this.terminalContainer.style, {
      flex: '1', minHeight: '0', overflow: 'hidden'
    });

    setTimeout(async () => {
      if (!this.terminalInstance && this.terminalContainer) {
        await this.initializeTerminal();
        this.setupResizeObserver();
      }
    }, 0);
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
    btn.innerHTML = this.getIconSvg(icon);
    btn.addEventListener('click', onClick);
    return btn;
  }

  /**
   * 获取图标 SVG
   */
  private getIconSvg(icon: string): string {
    const icons: Record<string, string> = {
      'chevron-up': '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"></path></svg>',
      'chevron-down': '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"></path></svg>',
      'x': '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>',
    };
    return icons[icon] || '';
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
      this.searchContainer.style.display = 'flex';
      this.searchInput?.focus();
      this.searchInput?.select();
    }
  }

  /**
   * 隐藏搜索栏
   */
  hideSearch(): void {
    if (this.searchContainer) {
      this.searchContainer.style.display = 'none';
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

      this.terminalInstance.onTitleChange(() => {
        (this.leaf as any).updateHeader();
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
        this.createNewTerminal();
      });

      this.terminalInstance.setOnSplitTerminal((direction) => {
        this.splitTerminal(direction);
      });

      this.applyBackgroundImage();
      this.applyTextOpacity();
      this.renderTerminal();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errorLog('[TerminalView] Init failed:', errorMessage);
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
    const plugin = (this.app as any).plugins?.plugins?.['obsidian-termy'];
    if (plugin && typeof plugin.activateTerminalView === 'function') {
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

  private applyBackgroundImage(): void {
    if (!this.terminalContainer || !this.terminalInstance) return;

    const options = (this.terminalInstance as any).options;
    
    if (options?.useObsidianTheme || !options?.backgroundImage) {
      return;
    }
    if (this.terminalInstance.getCurrentRenderer() === 'webgl') {
      return;
    }

    const {
      backgroundImage,
      backgroundImageOpacity = 0.5,
      backgroundImageSize = 'cover',
      backgroundImagePosition = 'center',
      enableBlur = false,
      blurAmount = 10
    } = options;

    this.terminalContainer.addClass('has-background-image');
    this.containerEl.querySelector('.terminal-view-container')?.addClass('has-background-image');

    this.ensureBackgroundLayer();

    const overlayOpacity = 1 - backgroundImageOpacity;
    const overlayGradient = `linear-gradient(rgba(0, 0, 0, ${overlayOpacity}), rgba(0, 0, 0, ${overlayOpacity}))`;

    this.terminalContainer.style.setProperty('--terminal-bg-overlay', overlayGradient);
    this.terminalContainer.style.setProperty('--terminal-bg-image', `url("${backgroundImage}")`);
    this.terminalContainer.style.setProperty('--terminal-bg-size', backgroundImageSize);
    this.terminalContainer.style.setProperty('--terminal-bg-position', backgroundImagePosition);

    if (enableBlur && blurAmount > 0) {
      this.terminalContainer.style.setProperty('--terminal-bg-blur', `${blurAmount}px`);
      this.terminalContainer.style.setProperty('--terminal-bg-scale', '1.05');
    } else {
      this.terminalContainer.style.setProperty('--terminal-bg-blur', '0px');
      this.terminalContainer.style.setProperty('--terminal-bg-scale', '1');
    }
  }

  private applyTextOpacity(): void {
    if (!this.terminalContainer || !this.terminalInstance) return;

    const options = (this.terminalInstance as any).options;
    
    if (options?.useObsidianTheme || !options?.backgroundImage) {
      return;
    }
    if (this.terminalInstance.getCurrentRenderer() === 'webgl') {
      return;
    }

    this.terminalContainer.style.setProperty('--terminal-text-opacity', String(options?.textOpacity ?? 1.0));
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

    const plugin = (this.app as any).plugins?.plugins?.['obsidian-termy'];
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

    if (this.terminalContainer) {
      this.resetBackgroundStyles();
    }
    this.containerEl.querySelector('.terminal-view-container')?.removeClass('has-background-image');

    this.applyBackgroundImage();
    this.applyTextOpacity();
  }

  private ensureBackgroundLayer(): void {
    if (!this.terminalContainer) return;
    const existingLayer = this.terminalContainer.querySelector('.terminal-background-image');
    if (existingLayer) return;

    const bgLayer = document.createElement('div');
    bgLayer.className = 'terminal-background-image';
    this.terminalContainer.prepend(bgLayer);
  }

  private resetBackgroundStyles(): void {
    if (!this.terminalContainer) return;
    this.terminalContainer.querySelector('.terminal-background-image')?.remove();
    this.terminalContainer.removeClass('has-background-image');
    this.terminalContainer.style.removeProperty('--terminal-text-opacity');
    this.terminalContainer.style.removeProperty('--terminal-bg-overlay');
    this.terminalContainer.style.removeProperty('--terminal-bg-image');
    this.terminalContainer.style.removeProperty('--terminal-bg-size');
    this.terminalContainer.style.removeProperty('--terminal-bg-position');
    this.terminalContainer.style.removeProperty('--terminal-bg-blur');
    this.terminalContainer.style.removeProperty('--terminal-bg-scale');
  }

  /**
   * 获取终端实例（供外部调用）
   */
  getTerminalInstance(): TerminalInstance | null {
    return this.terminalInstance;
  }
}
