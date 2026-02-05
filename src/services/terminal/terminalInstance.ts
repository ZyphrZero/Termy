/**
 * 终端实例类 - 基于统一 Rust 服务器的 PtyClient 通信实现
 * 

 */

import { platform } from 'os';
import { exec } from 'child_process';
import { debugLog, debugWarn, errorLog } from '@/utils/logger';
import { t } from '@/i18n';
import type { ServerManager } from '@/services/server/serverManager';
import type { PtyClient } from '@/services/server/ptyClient';
import type { ShellEvent, ShellEventSource } from '@/services/server/types';
import { shell } from 'electron';

// xterm.js CSS（静态导入，esbuild 会处理）
import '@xterm/xterm/css/xterm.css';

// xterm.js 模块类型声明（动态导入）
type Terminal = import('@xterm/xterm').Terminal;
type FitAddon = import('@xterm/addon-fit').FitAddon;
type SearchAddon = import('@xterm/addon-search').SearchAddon;
type CanvasAddon = import('@xterm/addon-canvas').CanvasAddon;
type WebglAddon = import('@xterm/addon-webgl').WebglAddon;

// xterm.js 模块缓存
let xtermModules: {
  Terminal: typeof import('@xterm/xterm').Terminal;
  FitAddon: typeof import('@xterm/addon-fit').FitAddon;
  SearchAddon: typeof import('@xterm/addon-search').SearchAddon;
  CanvasAddon: typeof import('@xterm/addon-canvas').CanvasAddon;
  WebglAddon: typeof import('@xterm/addon-webgl').WebglAddon;
  WebLinksAddon: typeof import('@xterm/addon-web-links').WebLinksAddon;
} | null = null;

/**
 * 动态加载 xterm.js 模块（首次调用时加载，后续使用缓存）
 * @throws {Error} 如果模块加载失败
 */
async function loadXtermModules() {
  // 如果已缓存，直接返回
  if (xtermModules) {
    debugLog('[Terminal] 使用缓存的 xterm.js 模块');
    return xtermModules;
  }
  
  debugLog('[Terminal] 动态加载 xterm.js 模块...');
  
  try {
    const [
      { Terminal },
      { FitAddon },
      { SearchAddon },
      { CanvasAddon },
      { WebglAddon },
      { WebLinksAddon }
    ] = await Promise.all([
      import('@xterm/xterm'),
      import('@xterm/addon-fit'),
      import('@xterm/addon-search'),
      import('@xterm/addon-canvas'),
      import('@xterm/addon-webgl'),
      import('@xterm/addon-web-links')
    ]);
    
    // 验证所有模块都已成功加载
    if (!Terminal || !FitAddon || !SearchAddon || !CanvasAddon || !WebglAddon || !WebLinksAddon) {
      throw new Error('One or more xterm.js modules failed to load');
    }
    
    xtermModules = { Terminal, FitAddon, SearchAddon, CanvasAddon, WebglAddon, WebLinksAddon };
    debugLog('[Terminal] xterm.js 模块加载完成');
    
    return xtermModules;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    errorLog('[Terminal] xterm.js 模块加载失败:', error);
    
    // 清除可能的部分缓存
    xtermModules = null;
    
    throw new Error(t('terminalInstance.xtermLoadFailed', { message: errorMsg }));
  }
}

export interface TerminalOptions {
  shellType?: string;
  shellArgs?: string[];
  cwd?: string;
  env?: Record<string, string>;
  fontSize?: number;
  fontFamily?: string;
  cursorStyle?: 'block' | 'underline' | 'bar';
  cursorBlink?: boolean;
  scrollback?: number;
  preferredRenderer?: 'canvas' | 'webgl';
  useObsidianTheme?: boolean;
  backgroundColor?: string;
  foregroundColor?: string;
  backgroundImage?: string;
  backgroundImageOpacity?: number;
  backgroundImageSize?: 'cover' | 'contain' | 'auto';
  backgroundImagePosition?: string;
  enableBlur?: boolean;
  blurAmount?: number;
  textOpacity?: number;
}

/** 搜索状态变化回调 */
export type SearchStateCallback = (visible: boolean) => void;
/** 字体大小变化回调 */
export type FontSizeChangeCallback = (fontSize: number) => void;

export class TerminalInstance {
  readonly id: string;
  readonly shellType: string;

  private xterm!: Terminal;
  private fitAddon!: FitAddon;
  private searchAddon!: SearchAddon;
  private renderer: CanvasAddon | WebglAddon | null = null;
  private rendererType: 'canvas' | 'webgl' | null = null;
  
  // 使用 PtyClient 替代直接的 WebSocket
  private ptyClient: PtyClient | null = null;
  
  // 会话 ID (多会话支持)
  private sessionId: string | null = null;
  
  // 事件取消函数
  private outputUnsubscribe: (() => void) | null = null;
  private exitUnsubscribe: (() => void) | null = null;
  private errorUnsubscribe: (() => void) | null = null;
  private shellEventUnsubscribe: (() => void) | null = null;
  
  private containerEl: HTMLElement | null = null;
  private options: TerminalOptions;
  private title: string;
  private isInitialized = false;
  private isDestroyed = false;
  private titleChangeCallback: ((title: string) => void) | null = null;
  
  // 搜索相关
  private searchVisible = false;
  private searchStateCallback: SearchStateCallback | null = null;
  private lastSearchQuery = '';
  
  // 字体大小相关
  private currentFontSize: number;
  private fontSizeChangeCallback: FontSizeChangeCallback | null = null;
  private readonly minFontSize = 8;
  private readonly maxFontSize = 32;

  // 输入批处理
  private pendingInput: string[] = [];
  private inputFlushTimer: number | null = null;
  private readonly inputBatchIntervalMs = 4;

  // 右键菜单回调（用于拆分终端、新建终端等需要外部处理的操作）
  private contextMenuCallbacks: {
    onNewTerminal?: () => void;
    onSplitTerminal?: (direction: 'horizontal' | 'vertical') => void;
  } = {};

  // 当前工作目录（通过 shell prompt 输出提取）
  private currentCwd: string | null = null;

  // Shell 集成事件
  private shellEventCallback: ((event: ShellEvent) => void) | null = null;
  private commandHistory: Array<{
    startTime: number;
    endTime: number;
    durationMs: number;
    exitCode: number | null;
    source: ShellEventSource;
  }> = [];
  private activeCommandStart: number | null = null;

  constructor(options: TerminalOptions = {}) {
    this.id = `terminal-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    this.options = options;
    this.shellType = options.shellType || 'default';
    this.title = t('terminal.defaultTitle');
    this.currentFontSize = options.fontSize ?? 14;
  }

  /**
   * 初始化 xterm.js 实例（动态加载模块）
   * @throws {Error} 如果模块加载或初始化失败
   */
  private async initXterm(): Promise<void> {
    try {
      const { Terminal, FitAddon, SearchAddon, WebLinksAddon } = await loadXtermModules();
      
      this.xterm = new Terminal({
        cursorBlink: this.options.cursorBlink ?? true,
        cursorStyle: this.options.cursorStyle ?? 'block',
        fontSize: this.currentFontSize,
        fontFamily: this.options.fontFamily ?? 'Consolas, "Courier New", monospace',
        theme: this.getTheme(),
        scrollback: this.options.scrollback ?? 1000,
        allowTransparency: !!this.options.backgroundImage,
        convertEol: true,
        rightClickSelectsWord: true,
        allowProposedApi: true,
      });

      this.fitAddon = new FitAddon();
      this.searchAddon = new SearchAddon();
      
      this.xterm.loadAddon(this.fitAddon);
      this.xterm.loadAddon(this.searchAddon);
      
      // Ctrl+点击打开链接
      const webLinksAddon = new WebLinksAddon((event, uri) => {
        // 只在 Ctrl+点击（Windows/Linux）或 Cmd+点击（macOS）时打开链接
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          shell.openExternal(uri);
        }
      });
      this.xterm.loadAddon(webLinksAddon);
      
      debugLog('[Terminal] xterm.js 实例初始化完成');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      errorLog('[Terminal] xterm.js 初始化失败:', error);
      throw new Error(t('terminalInstance.xtermInitFailed', { message: errorMsg }));
    }
  }

  private getTheme() {
    const { useObsidianTheme, backgroundColor, foregroundColor, backgroundImage } = this.options;

    if (useObsidianTheme) {
      const isDark = document.body.classList.contains('theme-dark');
      return {
        background: isDark ? '#1e1e1e' : '#ffffff',
        foreground: isDark ? '#cccccc' : '#333333',
        cursor: isDark ? '#ffffff' : '#000000',
        cursorAccent: isDark ? '#000000' : '#ffffff',
        selectionBackground: isDark ? '#264f78' : '#add6ff',
      };
    }

    const bgColor = backgroundImage ? 'transparent' : (backgroundColor || '#000000');
    const isDark = backgroundColor ? this.isColorDark(backgroundColor) : true;
    
    return {
      background: bgColor,
      foreground: foregroundColor || '#FFFFFF',
      cursor: foregroundColor || '#FFFFFF',
      cursorAccent: backgroundColor || '#000000',
      selectionBackground: isDark ? 'rgba(255, 255, 255, 0.3)' : 'rgba(0, 0, 0, 0.3)',
    };
  }

  private isColorDark(color: string): boolean {
    const hex = color.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 < 128;
  }

  private disposeRenderer(): void {
    if (this.renderer) {
      try { this.renderer.dispose(); } catch { /* ignore */ }
      this.renderer = null;
    }
    this.rendererType = null;
  }

  private async loadRenderer(renderer: 'canvas' | 'webgl'): Promise<void> {
    const resolvedRenderer = this.resolveRenderer(renderer);
    await this.loadRendererInternal(resolvedRenderer);
  }

  private async loadRendererInternal(renderer: 'canvas' | 'webgl'): Promise<void> {
    if (!this.checkRendererSupport(renderer)) {
      throw new Error(t('terminalInstance.rendererNotSupported', { renderer: renderer.toUpperCase() }));
    }

    const { CanvasAddon, WebglAddon } = await loadXtermModules();

    this.disposeRenderer();

    try {
      if (renderer === 'canvas') {
        const canvasAddon = new CanvasAddon();
        this.xterm.loadAddon(canvasAddon);
        this.renderer = canvasAddon;
        this.rendererType = 'canvas';
        return;
      }

      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        errorLog('[Terminal] WebGL context lost, fallback to canvas renderer');
        void this.fallbackToCanvasRenderer();
      });
      this.xterm.loadAddon(webglAddon);
      this.renderer = webglAddon;
      this.rendererType = 'webgl';
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      errorLog(`[Terminal] ${renderer} renderer failed:`, error);
      throw new Error(t('terminalInstance.rendererLoadFailed', { renderer: renderer.toUpperCase(), message: errorMsg }));
    }
  }

  private checkRendererSupport(renderer: 'canvas' | 'webgl'): boolean {
    try {
      const canvas = document.createElement('canvas');
      if (renderer === 'canvas') {
        return !!canvas.getContext('2d');
      }
      return !!canvas.getContext('webgl2');
    } catch {
      return false;
    }
  }

  private async fallbackToCanvasRenderer(): Promise<void> {
    try {
      await this.loadRendererInternal('canvas');
      this.fit();
    } catch (error) {
      errorLog('[Terminal] Canvas renderer fallback failed:', error);
    }
  }


  /**
   * 使用 ServerManager 初始化终端
   * 

   */
  async initializeWithServerManager(serverManager: ServerManager): Promise<void> {
    if (this.isInitialized || this.isDestroyed) return;

    try {
      // 动态加载 xterm.js 模块
      await this.initXterm();
      
      // 确保服务器运行
      await serverManager.ensureServer();
      
      // 获取 PtyClient
      this.ptyClient = serverManager.pty();
      
      // 初始化 PTY 会话并获取 session_id
      this.sessionId = await this.ptyClient.init({
        shell_type: this.shellType === 'default' ? undefined : this.shellType,
        shell_args: this.options.shellArgs,
        cwd: this.options.cwd,
        env: {
          TERM: process.env.TERM || 'xterm-256color',
          ...this.options.env
        }
      });
      
      debugLog('[Terminal] 获取到 session_id:', this.sessionId);
      
      // 设置会话级别的事件处理器
      this.setupPtyClientHandlers();
      
      this.setupXtermHandlers();
      this.isInitialized = true;
      
      debugLog('[Terminal] 终端已初始化');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errorLog('[Terminal] Init failed:', error);
      if (this.xterm) {
        this.xterm.write(`\r\n\x1b[1;31m[Error] ${errorMessage}\x1b[0m\r\n`);
      }
      throw new Error(t('terminalInstance.startFailed', { message: errorMessage }));
    }
  }

  /**
   * 设置 PtyClient 事件处理器 (会话级别)
   */
  private setupPtyClientHandlers(): void {
    if (!this.ptyClient || !this.sessionId) return;
    
    // 处理输出数据 (会话级别)
    this.outputUnsubscribe = this.ptyClient.onSessionOutput(this.sessionId, (data: Uint8Array) => {
      const text = new TextDecoder().decode(data);
      this.extractCwdFromOutput(text);
      this.xterm.write(data);
    });
    
    // 处理退出事件 (会话级别)
    this.exitUnsubscribe = this.ptyClient.onSessionExit(this.sessionId, (code: number) => {
      debugLog('[Terminal] PTY 会话退出, code:', code);
      this.xterm.write(`\r\n\x1b[33m[会话已结束, 退出码: ${code}]\x1b[0m\r\n`);
    });
    
    // 处理错误事件 (会话级别)
    this.errorUnsubscribe = this.ptyClient.onSessionError(this.sessionId, (code: string, message: string) => {
      errorLog('[Terminal] PTY 错误:', code, message);
      this.xterm.write(`\r\n\x1b[1;31m[错误] ${message}\x1b[0m\r\n`);
    });

    // 处理 Shell 集成事件
    this.shellEventUnsubscribe = this.ptyClient.onSessionShellEvent(this.sessionId, (event: ShellEvent) => {
      this.handleShellEvent(event);
    });
  }

  private setupXtermHandlers(): void {
    // 处理用户输入
    this.xterm.onData((data) => {
      this.queueInput(data);
    });
    
    this.xterm.onBinary((data) => {
      if (this.ptyClient && this.sessionId) {
        this.flushPendingInput();
        const binaryData = Uint8Array.from(atob(data), c => c.charCodeAt(0));
        this.ptyClient.writeBinary(this.sessionId, binaryData);
      }
    });
    
    // 自定义键盘事件处理:实现智能 Ctrl+C 行为
    // - 有选中文本时:复制文本
    // - 无选中文本时:发送中断信号
    this.xterm.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      // 只处理 keydown 事件
      if (event.type !== 'keydown') {
        return true;
      }
      
      // Ctrl+C 智能处理
      if (event.ctrlKey && event.key === 'c') {
        const hasSelection = this.xterm.hasSelection();
        debugLog('[Terminal] Ctrl+C pressed, hasSelection:', hasSelection);
        
        if (hasSelection) {
          // 有选中文本,执行复制操作
          event.preventDefault();
          const selectedText = this.xterm.getSelection();
          debugLog('[Terminal] Copying selected text, length:', selectedText.length);
          navigator.clipboard.writeText(selectedText).then(() => {
            this.xterm.clearSelection();
          }).catch(error => {
            errorLog('[Terminal] Copy failed:', error);
          });
          return false; // 阻止默认行为
        }
        // 无选中文本,允许 xterm.js 发送中断信号 (\x03)
        debugLog('[Terminal] Sending interrupt signal (Ctrl+C)');
        return true;
      }
      
      // Ctrl+V 粘贴处理
      if (event.ctrlKey && event.key === 'v') {
        event.preventDefault();
        navigator.clipboard.readText().then(text => {
          if (text && this.ptyClient && this.sessionId) {
            this.ptyClient.write(this.sessionId, text);
          }
        }).catch(error => {
          errorLog('[Terminal] Paste failed:', error);
        });
        return false;
      }
      
      // 其他按键正常处理
      return true;
    });
  }

  private queueInput(data: string): void {
    if (this.isDestroyed) return;
    this.pendingInput.push(data);

    if (this.inputFlushTimer === null) {
      this.inputFlushTimer = window.setTimeout(() => {
        this.flushPendingInput();
      }, this.inputBatchIntervalMs);
    }
  }

  private flushPendingInput(): void {
    if (this.pendingInput.length === 0) {
      this.inputFlushTimer = null;
      return;
    }

    const merged = this.pendingInput.join('');
    this.pendingInput = [];
    this.inputFlushTimer = null;

    if (this.ptyClient && this.sessionId) {
      this.ptyClient.write(this.sessionId, merged);
    }
  }

  /**
   * 发送调整大小消息
   */
  private sendResize(cols: number, rows: number): void {
    if (this.ptyClient && this.sessionId) {
      this.ptyClient.resize(this.sessionId, cols, rows);
    }
  }

  fit(): void {
    if (!this.containerEl) return;

    try {
      const { clientWidth, clientHeight } = this.containerEl;
      if (clientWidth === 0 || clientHeight === 0) return;

      this.fitAddon.fit();
      this.sendResize(this.xterm.cols, this.xterm.rows);
    } catch (error) {
      debugWarn('[Terminal] Fit failed:', error);
    }
  }

  handleServerCrash(): void {
    if (this.isDestroyed) return;

    this.xterm.write('\r\n\x1b[1;31m[服务器已崩溃]\x1b[0m\r\n');
    this.xterm.write('\x1b[33m正在尝试重启服务器...\x1b[0m\r\n');
  }

  destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;

    if (this.inputFlushTimer !== null) {
      window.clearTimeout(this.inputFlushTimer);
      this.inputFlushTimer = null;
    }
    this.pendingInput = [];

    // 取消事件订阅
    this.outputUnsubscribe?.();
    this.exitUnsubscribe?.();
    this.errorUnsubscribe?.();
    this.shellEventUnsubscribe?.();
    
    this.outputUnsubscribe = null;
    this.exitUnsubscribe = null;
    this.errorUnsubscribe = null;
    this.shellEventUnsubscribe = null;

    // 销毁 PTY 会话
    if (this.ptyClient && this.sessionId) {
      this.ptyClient.destroySession(this.sessionId);
    }

    this.detach();

    if (this.renderer) {
      try { this.renderer.dispose(); } catch { /* ignore */ }
      this.renderer = null;
    }
    this.rendererType = null;

    // 清理引用
    this.ptyClient = null;
    this.sessionId = null;

    try { this.xterm.dispose(); } catch { /* ignore */ }
  }

  attachToElement(container: HTMLElement): void {
    if (this.isDestroyed) {
      throw new Error(t('terminalInstance.instanceDestroyed'));
    }

    if (this.containerEl === container) return;

    this.detach();
    this.containerEl = container;

    try {
      this.xterm.open(container);
    } catch (error) {
      errorLog('[Terminal] xterm.open() failed:', error);
      throw error;
    }

    // 设置右键菜单和键盘快捷键
    this.setupContextMenu(container);
    this.setupKeyboardShortcuts(container);

    const preferredRenderer = this.options.preferredRenderer || 'canvas';

    // 异步加载渲染器
    requestAnimationFrame(() => {
      void this.loadRenderer(preferredRenderer)
        .then(() => {
          this.fit();
        })
        .catch((error) => {
          const errorMsg = error instanceof Error ? error.message : String(error);
          this.xterm.write(`\r\n\x1b[1;31m[渲染器错误] ${errorMsg}\x1b[0m\r\n`);
        });
    });
  }

  private resolveRenderer(renderer: 'canvas' | 'webgl'): 'canvas' | 'webgl' {
    if (
      renderer === 'webgl'
      && !this.options.useObsidianTheme
      && this.options.backgroundImage
    ) {
      debugLog('[Terminal] Background image enabled, fallback to canvas renderer');
      return 'canvas';
    }
    return renderer;
  }

  /**
   * 设置键盘快捷键
   */
  private setupKeyboardShortcuts(container: HTMLElement): void {
    container.addEventListener('keydown', (e: KeyboardEvent) => {
      const isCtrlOrCmd = e.ctrlKey || e.metaKey;
      
      // Ctrl+Shift+A: 全选
      if (isCtrlOrCmd && e.shiftKey && e.key === 'A') {
        e.preventDefault();
        e.stopPropagation();
        this.xterm.selectAll();
        return;
      }
      
      // Ctrl+F: 搜索
      if (isCtrlOrCmd && e.key === 'f') {
        e.preventDefault();
        e.stopPropagation();
        this.toggleSearch();
        return;
      }
      
      // Escape: 关闭搜索
      if (e.key === 'Escape' && this.searchVisible) {
        e.preventDefault();
        this.hideSearch();
        return;
      }
      
      // Ctrl+加号/等号: 放大字体
      if (isCtrlOrCmd && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        this.increaseFontSize();
        return;
      }
      
      // Ctrl+减号: 缩小字体
      if (isCtrlOrCmd && e.key === '-') {
        e.preventDefault();
        this.decreaseFontSize();
        return;
      }
      
      // Ctrl+0: 重置字体大小
      if (isCtrlOrCmd && e.key === '0') {
        e.preventDefault();
        this.resetFontSize();
        return;
      }
    });

    // Ctrl+滚轮: 调整字体大小
    container.addEventListener('wheel', (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (e.deltaY < 0) {
          this.increaseFontSize();
        } else {
          this.decreaseFontSize();
        }
      }
    }, { passive: false });
  }

  /**
   * 设置终端右键菜单
   */
  private setupContextMenu(container: HTMLElement): void {
    container.addEventListener('contextmenu', (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      
      // 计算鼠标点击位置对应的终端行列坐标
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      // 使用 xterm.js 的内部方法计算坐标
      const coords = this.getTerminalCoordinates(x, y);
      
      this.showContextMenu(e.clientX, e.clientY, coords);
    });
  }


  /**
   * 显示右键菜单
   */
  private showContextMenu(x: number, y: number, coords?: { col: number; row: number }): void {
    // 移除已存在的菜单
    const existingMenu = document.querySelector('.terminal-context-menu');
    if (existingMenu) {
      existingMenu.remove();
    }

    const menu = document.createElement('div');
    menu.className = 'terminal-context-menu';
    menu.setCssStyles({ left: `${x}px`, top: `${y}px` });

    const hasSelection = this.xterm.hasSelection();
    const selectedText = hasSelection ? this.xterm.getSelection() : '';

    // 复制
    menu.appendChild(this.createMenuItem(
      t('terminal.contextMenu.copy'),
      'copy',
      hasSelection,
      () => {
        if (!selectedText) return;
        void this.writeToClipboard(selectedText, () => {
          this.xterm.clearSelection();
        });
      },
      'Ctrl+Shift+C'
    ));

    // 复制为纯文本（去除 ANSI 转义序列）
    menu.appendChild(this.createMenuItem(
      t('terminal.contextMenu.copyAsPlainText'),
      'file-text',
      hasSelection,
      () => {
        if (!selectedText) return;
        const plainText = this.stripAnsiCodes(selectedText);
        void this.writeToClipboard(plainText, () => {
          this.xterm.clearSelection();
        });
      }
    ));

    // 粘贴
    menu.appendChild(this.createMenuItem(
      t('terminal.contextMenu.paste'),
      'clipboard-paste',
      true,
      () => {
        void this.pasteFromClipboard();
      },
      'Ctrl+Shift+V'
    ));

    menu.appendChild(this.createSeparator());

    // 全选所有内容
    menu.appendChild(this.createMenuItem(
      t('terminal.contextMenu.selectAll'),
      'select-all',
      true,
      () => this.xterm.selectAll(),
      'Ctrl+Shift+A'
    ));

    // 选择当前行
    if (coords) {
      menu.appendChild(this.createMenuItem(
        t('terminal.contextMenu.selectLine'),
        'minus',
        true,
        () => this.selectLine(coords.row)
      ));
    }

    // 搜索
    menu.appendChild(this.createMenuItem(
      t('terminal.contextMenu.search'),
      'search',
      true,
      () => this.toggleSearch(),
      'Ctrl+F'
    ));

    menu.appendChild(this.createSeparator());

    // 复制当前路径
    menu.appendChild(this.createMenuItem(
      t('terminal.contextMenu.copyPath'),
      'folder',
      true,
      () => {
        const cwd = this.getCwd();
        void this.writeToClipboard(cwd);
      }
    ));

    // 在文件管理器中打开
    menu.appendChild(this.createMenuItem(
      t('terminal.contextMenu.openInExplorer'),
      'folder-open',
      true,
      () => {
        const cwd = this.getCwd();
        this.openInFileManager(cwd);
      }
    ));

    menu.appendChild(this.createSeparator());

    // 新建终端
    menu.appendChild(this.createMenuItem(
      t('terminal.contextMenu.newTerminal'),
      'terminal',
      true,
      () => this.contextMenuCallbacks.onNewTerminal?.(),
      'Ctrl+O'
    ));

    // 拆分终端子菜单
    const splitSubmenu = this.createSubmenuItem(
      t('terminal.contextMenu.splitTerminal'),
      'columns',
      [
        {
          label: t('terminal.contextMenu.splitHorizontal'),
          icon: 'separator-horizontal',
          onClick: () => this.contextMenuCallbacks.onSplitTerminal?.('horizontal'),
          shortcut: 'Ctrl+Shift+H'
        },
        {
          label: t('terminal.contextMenu.splitVertical'),
          icon: 'separator-vertical',
          onClick: () => this.contextMenuCallbacks.onSplitTerminal?.('vertical'),
          shortcut: 'Ctrl+Shift+J'
        }
      ]
    );
    menu.appendChild(splitSubmenu);

    menu.appendChild(this.createSeparator());

    // 字体大小子菜单
    const fontSubmenu = this.createSubmenuItem(
      t('terminal.contextMenu.fontSize'),
      'type',
      [
        {
          label: t('terminal.contextMenu.fontIncrease'),
          icon: 'plus',
          onClick: () => this.increaseFontSize(),
          shortcut: 'Ctrl+='
        },
        {
          label: t('terminal.contextMenu.fontDecrease'),
          icon: 'minus',
          onClick: () => this.decreaseFontSize(),
          shortcut: 'Ctrl+-'
        },
        {
          label: t('terminal.contextMenu.fontReset'),
          icon: 'rotate-ccw',
          onClick: () => this.resetFontSize(),
          shortcut: 'Ctrl+0'
        }
      ]
    );
    menu.appendChild(fontSubmenu);

    // 清屏
    menu.appendChild(this.createMenuItem(
      t('terminal.contextMenu.clear'),
      'trash',
      true,
      () => this.clearScreen(),
      'Ctrl+Shift+R'
    ));

    // 清空缓冲区
    menu.appendChild(this.createMenuItem(
      t('terminal.contextMenu.clearBuffer'),
      'trash',
      true,
      () => this.clearBuffer(),
      'Ctrl+Shift+K'
    ));

    document.body.appendChild(menu);

    // 调整菜单位置
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.setCssStyles({ left: `${window.innerWidth - rect.width - 5}px` });
    }
    if (rect.bottom > window.innerHeight) {
      menu.setCssStyles({ top: `${window.innerHeight - rect.height - 5}px` });
    }

    // 点击其他地方关闭菜单
    const closeMenu = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
        document.removeEventListener('contextmenu', closeMenu);
      }
    };

    setTimeout(() => {
      document.addEventListener('click', closeMenu);
      document.addEventListener('contextmenu', closeMenu);
    }, 0);
  }

  private async writeToClipboard(text: string, onSuccess?: () => void): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      onSuccess?.();
    } catch (error) {
      errorLog('[Terminal] Clipboard write failed:', error);
    }
  }

  private async pasteFromClipboard(): Promise<void> {
    try {
      const text = await navigator.clipboard.readText();
      if (text && this.ptyClient && this.sessionId) {
        this.ptyClient.write(this.sessionId, text);
      }
    } catch (error) {
      errorLog('[Terminal] Paste failed:', error);
    }
  }

  /**
   * 创建菜单项
   */
  private createMenuItem(
    label: string,
    icon: string,
    enabled: boolean,
    onClick: () => void,
    shortcut?: string
  ): HTMLElement {
    const item = document.createElement('div');
    item.className = 'terminal-context-menu-item';
    if (!enabled) item.addClass('is-disabled');

    // 图标
    const iconEl = document.createElement('span');
    iconEl.className = 'terminal-context-menu-icon';
    if (!enabled) iconEl.addClass('is-disabled');
    const iconSvg = this.createIconElement(icon);
    if (iconSvg) iconEl.appendChild(iconSvg);
    item.appendChild(iconEl);

    // 文本
    const textEl = document.createElement('span');
    textEl.textContent = label;
    textEl.className = 'terminal-context-menu-text';
    item.appendChild(textEl);

    // 快捷键
    if (shortcut) {
      const shortcutEl = document.createElement('span');
      shortcutEl.textContent = shortcut;
      shortcutEl.className = 'terminal-context-menu-shortcut';
      item.appendChild(shortcutEl);
    }

    if (enabled) {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick();
        document.querySelector('.terminal-context-menu')?.remove();
      });
    }

    return item;
  }

  /**
   * 创建子菜单项
   */
  private createSubmenuItem(
    label: string,
    icon: string,
    items: Array<{ label: string; icon: string; onClick: () => void; shortcut?: string }>
  ): HTMLElement {
    const container = document.createElement('div');
    container.className = 'terminal-context-submenu-container';

    const item = document.createElement('div');
    item.className = 'terminal-context-menu-item';

    // 图标
    const iconEl = document.createElement('span');
    iconEl.className = 'terminal-context-menu-icon';
    const iconSvg = this.createIconElement(icon);
    if (iconSvg) iconEl.appendChild(iconSvg);
    item.appendChild(iconEl);

    // 文本
    const textEl = document.createElement('span');
    textEl.textContent = label;
    textEl.className = 'terminal-context-menu-text';
    item.appendChild(textEl);

    // 箭头
    const arrowEl = document.createElement('span');
    arrowEl.className = 'terminal-context-submenu-arrow';
    const arrowSvg = this.createIconElement('chevron-right');
    if (arrowSvg) arrowEl.appendChild(arrowSvg);
    item.appendChild(arrowEl);

    container.appendChild(item);

    // 子菜单
    const submenu = document.createElement('div');
    submenu.className = 'terminal-context-submenu';

    items.forEach(subItem => {
      submenu.appendChild(this.createMenuItem(subItem.label, subItem.icon, true, subItem.onClick, subItem.shortcut));
    });

    container.appendChild(submenu);

    // 悬停显示子菜单
    item.addEventListener('mouseenter', () => {
      submenu.addClass('is-visible');
      submenu.removeClass('is-flipped');

      // 调整子菜单位置
      const rect = submenu.getBoundingClientRect();
      if (rect.right > window.innerWidth) {
        submenu.addClass('is-flipped');
      }
    });

    container.addEventListener('mouseleave', () => {
      submenu.removeClass('is-visible');
    });

    return container;
  }

  /**
   * 创建分隔线
   */
  private createSeparator(): HTMLElement {
    const separator = document.createElement('div');
    separator.className = 'terminal-context-separator';
    return separator;
  }

  /**
   * 去除 ANSI 转义序列
   */
  private stripAnsiCodes(text: string): string {
    // eslint-disable-next-line no-control-regex -- 需要匹配 ANSI 控制序列
    return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
  }


  /**
   * 获取图标 SVG
   */
  private getIconSvg(icon: string): string {
    const icons: Record<string, string> = {
      'copy': '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>',
      'clipboard-paste': '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H9a1 1 0 0 0-1 1v2c0 .6.4 1 1 1h6c.6 0 1-.4 1-1V3c0-.6-.4-1-1-1Z"></path><path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2M16 4h2a2 2 0 0 1 2 2v2M11 14h10"></path><path d="m17 10 4 4-4 4"></path></svg>',
      'select-all': '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"></rect><path d="M9 3v18"></path><path d="M15 3v18"></path><path d="M3 9h18"></path><path d="M3 15h18"></path></svg>',
      'trash': '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>',
      'search': '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg>',
      'folder': '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"></path></svg>',
      'folder-open': '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5c0-1.1.9-2 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2"></path></svg>',
      'terminal': '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" x2="20" y1="19" y2="19"></line></svg>',
      'columns': '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"></rect><line x1="12" x2="12" y1="3" y2="21"></line></svg>',
      'separator-horizontal': '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" x2="21" y1="12" y2="12"></line><polyline points="8 8 12 4 16 8"></polyline><polyline points="16 16 12 20 8 16"></polyline></svg>',
      'separator-vertical': '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" x2="12" y1="3" y2="21"></line><polyline points="8 8 4 12 8 16"></polyline><polyline points="16 16 20 12 16 8"></polyline></svg>',
      'type': '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"></polyline><line x1="9" x2="15" y1="20" y2="20"></line><line x1="12" x2="12" y1="4" y2="20"></line></svg>',
      'plus': '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"></path><path d="M12 5v14"></path></svg>',
      'minus': '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"></path></svg>',
      'rotate-ccw': '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>',
      'chevron-right': '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"></path></svg>',
      'file-text': '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" x2="8" y1="13" y2="13"></line><line x1="16" x2="8" y1="17" y2="17"></line><line x1="10" x2="8" y1="9" y2="9"></line></svg>',
      'chevron-up': '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"></path></svg>',
      'chevron-down': '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"></path></svg>',
      'x': '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>',
    };
    return icons[icon] || '';
  }

  private createIconElement(icon: string): SVGElement | null {
    const svgText = this.getIconSvg(icon);
    if (!svgText) return null;
    const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    const svg = parsed.querySelector('svg');
    return svg ? (document.importNode(svg, true) as SVGElement) : null;
  }

  // ==================== 搜索功能 ====================

  /**
   * 切换搜索框显示状态
   */
  toggleSearch(): void {
    if (this.searchVisible) {
      this.hideSearch();
    } else {
      this.showSearch();
    }
  }

  /**
   * 显示搜索框
   */
  showSearch(): void {
    this.searchVisible = true;
    this.searchStateCallback?.(true);
  }

  /**
   * 隐藏搜索框
   */
  hideSearch(): void {
    this.searchVisible = false;
    this.searchAddon.clearDecorations();
    this.searchStateCallback?.(false);
    this.focus();
  }

  /**
   * 搜索文本
   */
  search(query: string, options?: { caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean }): boolean {
    if (!query) {
      this.searchAddon.clearDecorations();
      return false;
    }
    this.lastSearchQuery = query;
    
    // 获取当前主题的颜色来设置搜索高亮
    const isDark = document.body.classList.contains('theme-dark');
    
    return this.searchAddon.findNext(query, {
      caseSensitive: options?.caseSensitive ?? false,
      wholeWord: options?.wholeWord ?? false,
      regex: options?.regex ?? false,
      decorations: {
        matchBackground: isDark ? '#5a5a00' : '#ffff00',
        activeMatchBackground: isDark ? '#806000' : '#ff9900',
        matchOverviewRuler: isDark ? '#888800' : '#ffff00',
        activeMatchColorOverviewRuler: isDark ? '#aa6600' : '#ff9900',
      }
    });
  }

  /**
   * 搜索下一个
   */
  searchNext(): boolean {
    if (!this.lastSearchQuery) return false;
    return this.searchAddon.findNext(this.lastSearchQuery);
  }

  /**
   * 搜索上一个
   */
  searchPrevious(): boolean {
    if (!this.lastSearchQuery) return false;
    return this.searchAddon.findPrevious(this.lastSearchQuery);
  }

  /**
   * 清除搜索高亮
   */
  clearSearch(): void {
    this.searchAddon.clearDecorations();
    this.lastSearchQuery = '';
  }

  /**
   * 监听搜索状态变化
   */
  onSearchStateChange(callback: SearchStateCallback): void {
    this.searchStateCallback = callback;
  }

  /**
   * 获取搜索是否可见
   */
  isSearchVisible(): boolean {
    return this.searchVisible;
  }

  // ==================== Shell 集成 ====================

  private handleShellEvent(event: ShellEvent): void {
    if (event.type === 'command_start') {
      this.activeCommandStart = Date.now();
    }

    if (event.type === 'command_end') {
      const endTime = Date.now();
      const startTime = this.activeCommandStart ?? endTime;
      const durationMs = Math.max(0, endTime - startTime);
      this.commandHistory.push({
        startTime,
        endTime,
        durationMs,
        exitCode: event.exitCode,
        source: event.source,
      });
      this.activeCommandStart = null;
    }

    this.shellEventCallback?.(event);
  }

  /**
   * 监听 Shell 集成事件
   */
  onShellEvent(callback: (event: ShellEvent) => void): void {
    this.shellEventCallback = callback;
  }

  /**
   * 获取命令历史
   */
  getCommandHistory(): Array<{
    startTime: number;
    endTime: number;
    durationMs: number;
    exitCode: number | null;
    source: ShellEventSource;
  }> {
    return [...this.commandHistory];
  }

  // ==================== 字体大小调整 ====================

  /**
   * 增大字体
   */
  increaseFontSize(): void {
    if (this.currentFontSize < this.maxFontSize) {
      this.setFontSize(this.currentFontSize + 1);
    }
  }

  /**
   * 减小字体
   */
  decreaseFontSize(): void {
    if (this.currentFontSize > this.minFontSize) {
      this.setFontSize(this.currentFontSize - 1);
    }
  }

  /**
   * 重置字体大小
   */
  resetFontSize(): void {
    this.setFontSize(this.options.fontSize ?? 14);
  }

  /**
   * 设置字体大小
   */
  setFontSize(size: number): void {
    const newSize = Math.max(this.minFontSize, Math.min(this.maxFontSize, size));
    if (newSize !== this.currentFontSize) {
      this.currentFontSize = newSize;
      this.xterm.options.fontSize = newSize;
      this.fit();
      this.fontSizeChangeCallback?.(newSize);
    }
  }

  /**
   * 获取当前字体大小
   */
  getFontSize(): number {
    return this.currentFontSize;
  }

  /**
   * 监听字体大小变化
   */
  onFontSizeChange(callback: FontSizeChangeCallback): void {
    this.fontSizeChangeCallback = callback;
  }

  // ==================== 右键菜单回调设置 ====================

  /**
   * 设置新建终端回调
   */
  setOnNewTerminal(callback: () => void): void {
    this.contextMenuCallbacks.onNewTerminal = callback;
  }

  /**
   * 设置拆分终端回调
   */
  setOnSplitTerminal(callback: (direction: 'horizontal' | 'vertical') => void): void {
    this.contextMenuCallbacks.onSplitTerminal = callback;
  }

  // ==================== 其他公共方法 ====================

  /**
   * 写入数据到终端
   */
  write(data: string): void {
    if (this.ptyClient && this.sessionId) {
      this.ptyClient.write(this.sessionId, data);
    }
  }

  detach(): void {
    if (this.containerEl) {
      this.containerEl.empty();
      this.containerEl = null;
    }
  }

  focus(): void {
    if (!this.isDestroyed) this.xterm.focus();
  }

  isAlive(): boolean {
    return !this.isDestroyed && this.ptyClient !== null && this.ptyClient.isConnected();
  }

  getTitle(): string { return this.title; }

  getOptions(): Readonly<TerminalOptions> {
    return this.options;
  }

  setTitle(title: string): void {
    this.title = title;
    this.titleChangeCallback?.(title);
  }


  /**
   * 从 shell 输出中提取当前工作目录
   * 支持 OSC 序列和 PowerShell/CMD/Git Bash/Bash prompt 格式
   */
  private extractCwdFromOutput(data: string): void {
    // OSC 7 格式 (标准): \x1b]7;file://hostname/path\x07 或 \x1b]7;file://hostname/path\x1b\\
    // eslint-disable-next-line no-control-regex -- 需要匹配 ANSI 控制序列
    const osc7Match = data.match(/\x1b\]7;file:\/\/[^/]*([^\x07\x1b]+)[\x07\x1b]/);
    if (osc7Match) {
      try {
        const path = decodeURIComponent(osc7Match[1]);
        this.currentCwd = path;
        debugLog('[Terminal CWD] OSC7 matched:', path);
        return;
      } catch {
        // 解码失败，忽略
      }
    }
    
    // OSC 9;9 格式 (Windows Terminal/PowerShell): \x1b]9;9;path\x07
    // eslint-disable-next-line no-control-regex -- 需要匹配 ANSI 控制序列
    const osc9Match = data.match(/\x1b\]9;9;([^\x07\x1b]+)[\x07\x1b]/);
    if (osc9Match) {
      this.currentCwd = osc9Match[1];
      debugLog('[Terminal CWD] OSC9 matched:', this.currentCwd);
      return;
    }
    
    // OSC 0 格式 (窗口标题，Git Bash 使用): \x1b]0;MINGW64:/path\x07
    // eslint-disable-next-line no-control-regex -- 需要匹配 ANSI 控制序列
    const osc0Match = data.match(/\x1b\]0;(?:MINGW(?:64|32)|MSYS):([^\x07]+)\x07/);
    if (osc0Match) {
      let path = osc0Match[1];
      // 转换 Git Bash 路径格式到 Windows 格式
      if (/^\/[a-zA-Z]\//.test(path)) {
        const driveLetter = path[1].toUpperCase();
        path = `${driveLetter}:${path.substring(2).replace(/\//g, '\\')}`;
      }
      this.currentCwd = path;
      debugLog('[Terminal CWD] OSC0 (Git Bash) matched:', path);
      return;
    }
    
    // Prompt 解析 (fallback for Windows shells)
    // eslint-disable-next-line no-control-regex -- 需要匹配 ANSI 控制序列
    const cleanData = data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
    
    // PowerShell prompt: PS path>
    const psMatch = cleanData.match(/PS ([A-Za-z]:[^>\r\n]+)>/);
    if (psMatch) {
      this.currentCwd = psMatch[1].trimEnd();
      debugLog('[Terminal CWD] PowerShell prompt matched:', this.currentCwd);
      return;
    }
    
    // CMD prompt: path>
    const cmdMatch = cleanData.match(/^([A-Za-z]:\\[^>\r\n]*)>/m);
    if (cmdMatch) {
      this.currentCwd = cmdMatch[1].trimEnd();
      debugLog('[Terminal CWD] CMD prompt matched:', this.currentCwd);
      return;
    }
    
    // Git Bash prompt: user@host MINGW64 /path
    const gitBashMatch = cleanData.match(/(?:MINGW(?:64|32)|MSYS)\s+([/~][^\r\n$]*)/);
    if (gitBashMatch) {
      let path = gitBashMatch[1].trimEnd();
      if (/^\/[a-zA-Z]\//.test(path)) {
        const driveLetter = path[1].toUpperCase();
        path = `${driveLetter}:${path.substring(2).replace(/\//g, '\\')}`;
      } else if (path.startsWith('~')) {
        path = path.replace('~', process.env.USERPROFILE || '');
      }
      this.currentCwd = path;
      debugLog('[Terminal CWD] Git Bash prompt matched:', this.currentCwd);
      return;
    }
    
    // WSL prompt: user@host:/mnt/c/path$ 或 user@host:~$
    const wslMatch = cleanData.match(/:\s*(\/[^\s$#>\r\n]+)\s*[$#]/);
    if (wslMatch) {
      this.currentCwd = wslMatch[1];
      debugLog('[Terminal CWD] WSL prompt matched:', this.currentCwd);
    }
  }

  /**
   * 获取终端初始工作目录
   */
  getInitialCwd(): string {
    return this.options.cwd || process.env.HOME || process.env.USERPROFILE || process.cwd();
  }

  /**
   * 获取当前工作目录
   */
  getCwd(): string {
    return this.currentCwd || this.getInitialCwd();
  }

  onTitleChange(callback: (title: string) => void): void {
    this.titleChangeCallback = callback;
  }

  getXterm(): Terminal { return this.xterm; }
  getFitAddon(): FitAddon { return this.fitAddon; }
  getSearchAddon(): SearchAddon { return this.searchAddon; }

  getCurrentRenderer(): 'canvas' | 'webgl' {
    return this.rendererType ?? 'canvas';
  }

  /**
   * 将鼠标像素坐标转换为终端行列坐标
   */
  private getTerminalCoordinates(x: number, y: number): { col: number; row: number } {
    const fontSize = this.xterm.options.fontSize || 14;
    const lineHeight = Math.ceil(fontSize * 1.2); // xterm.js 默认行高约为字体大小的 1.2 倍
    
    // 计算字符宽度(等宽字体,宽度约为字体大小的 0.6 倍)
    const charWidth = fontSize * 0.6;
    
    const col = Math.floor(x / charWidth);
    const row = Math.floor(y / lineHeight);
    
    debugLog('[Terminal] Mouse coordinates:', { x, y, col, row, fontSize, charWidth, lineHeight });
    
    return { col, row };
  }

  /**
   * 将 WSL 路径转换为 Windows 路径
   * @param wslPath WSL 格式的路径 (如 /mnt/c/Users/...)
   * @returns Windows 格式的路径 (如 C:\Users\...)
   */
  private convertWslPathToWindows(wslPath: string): string {
    // 匹配 /mnt/x/... 格式的路径
    const wslMountMatch = wslPath.match(/^\/mnt\/([a-zA-Z])\/(.*)$/);
    if (wslMountMatch) {
      const driveLetter = wslMountMatch[1].toUpperCase();
      const restPath = wslMountMatch[2].replace(/\//g, '\\');
      return `${driveLetter}:\\${restPath}`;
    }
    return wslPath;
  }

  /**
   * 在文件管理器中打开指定路径
   * @param path 要打开的路径
   */
  private openInFileManager(targetPath: string): void {
    const currentPlatform = platform();
    
    debugLog('[Terminal] Opening in file manager, original path:', targetPath);
    
    let finalPath = targetPath;
    
    // 如果是 WSL 终端，需要将 WSL 路径转换为 Windows 路径
    if (currentPlatform === 'win32' && this.shellType === 'wsl' && targetPath.startsWith('/mnt/')) {
      finalPath = this.convertWslPathToWindows(targetPath);
      debugLog('[Terminal] Converted WSL path to Windows path:', { original: targetPath, converted: finalPath });
    }
    
    debugLog('[Terminal] Final path for file manager:', finalPath);
    
    if (currentPlatform === 'win32') {
      // Windows: 使用 explorer 命令，会前台打开窗口
      // 注意: explorer 即使成功也可能返回非零退出码，忽略错误
      exec(`explorer "${finalPath}"`);
    } else if (currentPlatform === 'darwin') {
      // macOS: 使用 open 命令
      exec(`open "${finalPath}"`, (error: Error | null) => {
        if (error) {
          errorLog('[Terminal] Failed to open in Finder:', error);
          shell.openPath(finalPath);
        }
      });
    } else {
      // Linux: 使用 xdg-open
      exec(`xdg-open "${finalPath}"`, (error: Error | null) => {
        if (error) {
          errorLog('[Terminal] Failed to open in file manager:', error);
          shell.openPath(finalPath);
        }
      });
    }
  }

  /**
   * 选中指定行的完整内容
   * @param row 行号
   */
  private selectLine(row: number): void {
    const buffer = this.xterm.buffer.active;
    
    // 确保行号有效
    if (row < 0 || row >= buffer.length) {
      debugLog('[Terminal] Invalid row:', row);
      return;
    }
    
    this.xterm.selectLines(row, row);
    debugLog('[Terminal] Selected line:', row);
  }

  /**
   * 清屏
   * 清除当前屏幕内容,但保留滚动历史
   */
  private clearScreen(): void {
    // 先发送 Ctrl+C 中断当前输入
    if (this.ptyClient && this.sessionId) {
      this.ptyClient.write(this.sessionId, '\x03');
    }
    
    // 等待一小段时间让中断生效,然后发送清屏命令
    setTimeout(() => {
      const clearCommand = platform() === 'win32' ? 'cls\r' : 'clear\r';
      if (this.ptyClient && this.sessionId) {
        this.ptyClient.write(this.sessionId, clearCommand);
      }
      debugLog('[Terminal] Screen cleared');
    }, 50);
  }

  /**
   * 清空缓冲区
   * 完全重置终端状态,清除所有内容和历史记录
   */
  clearBuffer(): void {
    // 先发送 Ctrl+C 中断当前输入
    if (this.ptyClient && this.sessionId) {
      this.ptyClient.write(this.sessionId, '\x03');
    }
    
    // 等待一小段时间让中断生效
    setTimeout(() => {
      // 发送清屏命令到 shell
      const clearCommand = platform() === 'win32' ? 'cls\r' : 'clear\r';
      if (this.ptyClient && this.sessionId) {
        this.ptyClient.write(this.sessionId, clearCommand);
      }
      
      // 清除 xterm.js 的滚动缓冲区和状态
      this.xterm.clear();
      this.xterm.reset();
      this.xterm.clearSelection();
      
      debugLog('[Terminal] Buffer cleared and terminal reset');
    }, 50);
  }

  updateTheme(): void {
    this.xterm.options.theme = this.getTheme();
    this.xterm.options.allowTransparency = !!this.options.backgroundImage;
    this.xterm.refresh(0, this.xterm.rows - 1);
  }

  updateOptions(options: Partial<TerminalOptions>): void {
    const previousScrollback = this.options.scrollback;
    this.options = { ...this.options, ...options };
    if (!this.isInitialized) {
      return;
    }
    if (options.scrollback !== undefined && options.scrollback !== previousScrollback) {
      this.xterm.options.scrollback = options.scrollback;
    }
    this.updateTheme();
  }
}
