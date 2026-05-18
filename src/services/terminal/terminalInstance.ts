/**
 * Terminal instance class - a PtyClient-based implementation built on the unified Rust server
 * 

 */

import { debugLog, debugWarn, errorLog } from '@/utils/logger';
import { getHomeDir, getPlatform, isWindows } from '@/utils/platform';
import { t } from '@/i18n';
import type { ServerManager } from '@/services/server/serverManager';
import type { PtyClient } from '@/services/server/ptyClient';
import type { PtyConfig, ShellEvent, ShellEventSource } from '@/services/server/types';
import type { DefaultShellOption } from './terminalService';
import { EnhancedKeyboardProtocol, formatPastedTerminalText } from './enhancedKeyboardProtocol';
import {
  createSynchronizedOutputCompatibilityState,
  filterSynchronizedOutputScrollbackPurge,
} from './aiTuiCompatibility';
import {
  buildClaudeCodeTuiEnv,
  decodeOsc52Clipboard,
  decodeTmuxPassthroughOsc52Clipboard,
  type ClaudeCodeExtendedKeyboardMode,
  XTVERSION_RESPONSE,
} from './claudeCodeTuiSupport';
import { ClaudeCodeSessionState } from './claudeCodeSessionState';
import { TerminalTitleState } from './terminalTitleState';
import { resolveTerminalContextMenuAction } from './terminalContextMenuRouter';
import {
  extractCmdCwd,
  extractCwdFromPromptLines,
  extractGitBashPromptCwd,
  extractGitBashWindowTitleCwd,
  extractPowerShellCwd,
  extractWslPromptCwd,
} from './promptCwdParsers';
import { shell } from 'electron';

// xterm.js CSS (static import handled by esbuild)
import '@xterm/xterm/css/xterm.css';

// xterm.js module type declarations (for dynamic import)
type Terminal = import('@xterm/xterm').Terminal;
type FitAddon = import('@xterm/addon-fit').FitAddon;
type SearchAddon = import('@xterm/addon-search').SearchAddon;
type CanvasAddon = import('@xterm/addon-canvas').CanvasAddon;
type WebglAddon = import('@xterm/addon-webgl').WebglAddon;
type IMarker = import('@xterm/xterm').IMarker;
type IDisposable = import('@xterm/xterm').IDisposable;

const XTERM_BACKGROUND_LAYER_SELECTOR = [
  '.xterm',
  '.xterm-viewport',
  '.xterm-scrollable-element',
  '.xterm-screen',
  '.xterm-canvas',
  'canvas',
].join(', ');
const XTERM_SCROLL_BACKGROUND_LAYER_SELECTOR = '.xterm-viewport, .xterm-scrollable-element';

// xterm.js module cache
let xtermModules: {
  Terminal: typeof import('@xterm/xterm').Terminal;
  FitAddon: typeof import('@xterm/addon-fit').FitAddon;
  SearchAddon: typeof import('@xterm/addon-search').SearchAddon;
  CanvasAddon: typeof import('@xterm/addon-canvas').CanvasAddon;
  WebglAddon: typeof import('@xterm/addon-webgl').WebglAddon;
  WebLinksAddon: typeof import('@xterm/addon-web-links').WebLinksAddon;
} | null = null;

/**
 * Dynamically load xterm.js modules (loaded on first use and cached afterward)
 * @throws {Error} If module loading fails
 */
async function loadXtermModules() {
  // Return cached modules immediately if available
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
    
    // Verify that all modules were loaded successfully
    if (!Terminal || !FitAddon || !SearchAddon || !CanvasAddon || !WebglAddon || !WebLinksAddon) {
      throw new Error('One or more xterm.js modules failed to load');
    }
    
    xtermModules = { Terminal, FitAddon, SearchAddon, CanvasAddon, WebglAddon, WebLinksAddon };
    debugLog('[Terminal] xterm.js 模块加载完成');
    
    return xtermModules;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    errorLog('[Terminal] xterm.js 模块加载失败:', error);
    
    // Clear any partial cache that may have been created
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

/** Search state change callback */
export type SearchStateCallback = (visible: boolean) => void;
/** Font size change callback */
export type FontSizeChangeCallback = (fontSize: number) => void;
/** Renderer change callback */
export type RendererChangeCallback = (renderer: 'canvas' | 'webgl') => void;

interface TerminalCommandMarker {
  marker: IMarker;
  exitCode: number | null;
}

export class TerminalInstance {
  readonly id: string;
  readonly shellType: string;

  private xterm!: Terminal;
  private fitAddon!: FitAddon;
  private searchAddon!: SearchAddon;
  private renderer: CanvasAddon | WebglAddon | null = null;
  private rendererType: 'canvas' | 'webgl' | null = null;
  
  // Use PtyClient instead of a direct WebSocket
  private ptyClient: PtyClient | null = null;
  
  // Session ID (multi-session support)
  private sessionId: string | null = null;
  
  // Event unsubscribe callbacks
  private outputUnsubscribe: (() => void) | null = null;
  private exitUnsubscribe: (() => void) | null = null;
  private errorUnsubscribe: (() => void) | null = null;
  private shellEventUnsubscribe: (() => void) | null = null;
  
  private containerEl: HTMLElement | null = null;
  private options: TerminalOptions;
  private titleState: TerminalTitleState;
  private isInitialized = false;
  private isDestroyed = false;
  private titleChangeCallbacks: Set<(title: string) => void> = new Set();
  
  // Search-related state
  private searchVisible = false;
  private searchStateCallbacks: Set<SearchStateCallback> = new Set();
  private lastSearchQuery = '';
  
  // Font size state
  private currentFontSize: number;
  private fontSizeChangeCallbacks: Set<FontSizeChangeCallback> = new Set();
  private readonly minFontSize = 8;
  private readonly maxFontSize = 32;

  // Renderer change listeners
  private rendererChangeCallbacks: Set<RendererChangeCallback> = new Set();

  // Input batching
  private pendingInput: string[] = [];
  private inputFlushTimer: number | null = null;
  private readonly inputBatchIntervalMs = 4;

  // Context menu callbacks for actions like split/new terminal that need external handling
  private contextMenuCallbacks: {
    onNewTerminal?: () => void;
    onSplitTerminal?: (direction: 'horizontal' | 'vertical') => void;
    onToggleAlwaysOnTop?: () => void;
    getAlwaysOnTopLabel?: () => string;
    getDefaultShellOptions?: () => DefaultShellOption[];
    onDefaultShellChange?: (shellType: DefaultShellOption['shellType']) => void;
  } = {};

  // Current working directory (extracted from shell prompt output)
  private currentCwd: string | null = null;

  // Shell integration events
  private shellEventCallback: ((event: ShellEvent) => void) | null = null;
  private commandHistory: Array<{
    startTime: number;
    endTime: number;
    durationMs: number;
    exitCode: number | null;
    source: ShellEventSource;
  }> = [];
  private activeCommandStart: number | null = null;
  private promptMarkers: IMarker[] = [];
  private commandMarkers: TerminalCommandMarker[] = [];
  private win32InputModeEnabled = false;
  private claudeCodeSessionState = new ClaudeCodeSessionState();
  private webSocketDisconnected = false;
  private sessionRecoveryNeeded = false;
  private sessionRecoveryInProgress = false;
  private pendingControlSequenceText = '';
  private synchronizedOutputCompatibilityState = createSynchronizedOutputCompatibilityState();
  private parserDisposables: IDisposable[] = [];
  private domEventCleanups: Array<() => void> = [];
  private hostWindow: Window | null = null;

  constructor(options: TerminalOptions = {}) {
    this.id = `terminal-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    this.options = options;
    this.shellType = options.shellType || 'default';
    this.titleState = new TerminalTitleState(t('terminal.defaultTitle'));
    this.currentFontSize = options.fontSize ?? 14;
  }

  /**
   * Initialize the xterm.js instance (modules loaded dynamically)
   * @throws {Error} If module loading or initialization fails
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
        allowTransparency: this.shouldUseTransparentTerminalBackground(),
        convertEol: false,
        rightClickSelectsWord: true,
        macOptionClickForcesSelection: true,
        rescaleOverlappingGlyphs: true,
        scrollOnEraseInDisplay: true,
        allowProposedApi: true,
      });

      this.fitAddon = new FitAddon();
      this.searchAddon = new SearchAddon();
      
      this.xterm.loadAddon(this.fitAddon);
      this.xterm.loadAddon(this.searchAddon);
      
      // Ctrl+click opens links
      const webLinksAddon = new WebLinksAddon((event, uri) => {
        // Only open links on Ctrl+click (Windows/Linux) or Cmd+click (macOS)
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          void shell.openExternal(uri).catch((error) => {
            errorLog('[Terminal] Failed to open external link:', error);
          });
        }
      });
      this.xterm.loadAddon(webLinksAddon);
      this.setupClaudeCodeTuiHandlers();
      
      debugLog('[Terminal] xterm.js 实例初始化完成');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      errorLog('[Terminal] xterm.js 初始化失败:', error);
      throw new Error(t('terminalInstance.xtermInitFailed', { message: errorMsg }));
    }
  }

  private getTheme() {
    const { useObsidianTheme, backgroundColor, foregroundColor } = this.options;

    if (useObsidianTheme) {
      const isDark = activeDocument.body.classList.contains('theme-dark');
      const computed = activeDocument.defaultView?.getComputedStyle(activeDocument.body);
      const bgFromVar = computed?.getPropertyValue('--background-primary').trim();
      const fgFromVar = computed?.getPropertyValue('--text-normal').trim();
      const cursorFromVar = computed?.getPropertyValue('--text-normal').trim();
      const selectionFromVar = computed?.getPropertyValue('--text-selection').trim();
      // Obsidian's --text-selection is often very translucent (e.g. hsla with
      // 0.15 alpha) which works for the editor but is nearly invisible in the
      // terminal's canvas/webgl renderer. Use a higher-contrast fallback that
      // still harmonizes with the theme.
      const selectionColor = isDark
        ? (selectionFromVar || '#264f78')
        : 'rgba(0, 120, 215, 0.3)';
      return {
        background: bgFromVar || (isDark ? '#1e1e1e' : '#ffffff'),
        foreground: fgFromVar || (isDark ? '#cccccc' : '#333333'),
        cursor: cursorFromVar || (isDark ? '#ffffff' : '#000000'),
        cursorAccent: bgFromVar || (isDark ? '#000000' : '#ffffff'),
        selectionBackground: selectionColor,
      };
    }

    const bgColor = this.shouldUseTransparentTerminalBackground()
      ? 'transparent'
      : (backgroundColor || '#000000');
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

  private shouldUseTransparentTerminalBackground(): boolean {
    if (!this.options.backgroundImage || this.options.useObsidianTheme) {
      return false;
    }

    // WebGL renderer cannot show a CSS background image behind the canvas
    // reliably, so the background image is silently ignored in WebGL mode and
    // the configured backgroundColor stays in effect.
    const preferredRenderer = this.options.preferredRenderer || 'canvas';
    return preferredRenderer !== 'webgl';
  }

  private syncBackgroundLayerStyles(themeBackground = this.getTheme().background): void {
    const terminalElement = this.xterm?.element;
    if (!terminalElement) {
      return;
    }

    const useTransparentBackground = this.shouldUseTransparentTerminalBackground();
    const transparentColor = 'transparent' as const;
    const syncLayer = (layer: HTMLElement): void => {
      if (useTransparentBackground) {
        layer.style.backgroundColor = transparentColor;
        return;
      }

      // Always re-sync to the active theme so previously applied colors
      // (e.g. an old custom backgroundColor) do not leak through after
      // switching themes or appearance options. Without this, the .xterm
      // root element retains its previous inline background and shows up
      // as a frame around the cell-aligned scrollable area.
      if (layer.matches(XTERM_SCROLL_BACKGROUND_LAYER_SELECTOR)) {
        layer.style.backgroundColor = themeBackground;
      } else {
        layer.style.removeProperty('background-color');
      }
    };

    syncLayer(terminalElement);
    terminalElement.querySelectorAll<HTMLElement>(XTERM_BACKGROUND_LAYER_SELECTOR).forEach(syncLayer);
  }

  private disposeRenderer(): void {
    if (this.renderer) {
      try { this.renderer.dispose(); } catch { /* ignore */ }
      this.renderer = null;
    }
    this.rendererType = null;
  }

  private async loadRenderer(renderer: 'canvas' | 'webgl'): Promise<void> {
    await this.loadRendererInternal(renderer);
  }

  private refreshRenderer(): void {
    if (!this.containerEl) {
      return;
    }

    const resolvedRenderer = this.options.preferredRenderer || 'canvas';
    if (this.rendererType === resolvedRenderer) {
      return;
    }

    void this.loadRenderer(resolvedRenderer)
      .then(() => {
        this.updateTheme();
        this.syncBackgroundLayerStyles();
        this.fit();
      })
      .catch((error) => {
        errorLog('[Terminal] Renderer refresh failed:', error);
      });
  }

  private reopenTerminalElement(): void {
    const container = this.containerEl;
    if (!container) {
      return;
    }

    const activeElement = container.ownerDocument.activeElement;
    const wasFocused = activeElement instanceof Node
      && !!this.xterm.element?.contains(activeElement);

    this.disposeRenderer();
    this.disposeDomEventHandlers();
    this.xterm.element?.remove();

    try {
      if (this.xterm.element) {
        container.appendChild(this.xterm.element);
      }
      this.xterm.open(container);
      this.setupDomEventHandlers(container);
      this.syncBackgroundLayerStyles();
    } catch (error) {
      errorLog('[Terminal] xterm.open() failed during appearance refresh:', error);
      return;
    }

    void this.loadRenderer(this.options.preferredRenderer || 'canvas')
      .then(() => {
        this.updateTheme();
        this.syncBackgroundLayerStyles();
        this.fit();
        if (wasFocused) {
          this.focus();
        }
      })
      .catch((error) => {
        errorLog('[Terminal] Renderer refresh failed after terminal reopen:', error);
      });
  }

  private async loadRendererInternal(renderer: 'canvas' | 'webgl'): Promise<void> {
    if (!this.checkRendererSupport(renderer)) {
      throw new Error(t('terminalInstance.rendererNotSupported', { renderer: renderer.toUpperCase() }));
    }

    const { CanvasAddon, WebglAddon } = await loadXtermModules();

    const previousRenderer = this.rendererType;
    this.disposeRenderer();

    try {
      if (renderer === 'canvas') {
        const canvasAddon = new CanvasAddon();
        this.xterm.loadAddon(canvasAddon);
        this.renderer = canvasAddon;
        this.rendererType = 'canvas';
        if (previousRenderer !== this.rendererType) {
          this.notifyRendererChanged();
        }
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
      if (previousRenderer !== this.rendererType) {
        this.notifyRendererChanged();
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      errorLog(`[Terminal] ${renderer} renderer failed:`, error);
      throw new Error(t('terminalInstance.rendererLoadFailed', { renderer: renderer.toUpperCase(), message: errorMsg }));
    }
  }

  private notifyRendererChanged(): void {
    if (!this.rendererType) return;
    const renderer = this.rendererType;
    this.rendererChangeCallbacks.forEach((callback) => {
      try {
        callback(renderer);
      } catch (error) {
        errorLog('[Terminal] Renderer change callback failed:', error);
      }
    });
  }

  private checkRendererSupport(renderer: 'canvas' | 'webgl'): boolean {
    try {
      const canvas = activeDocument.createElement('canvas');
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
   * Initialize the terminal with ServerManager
   * 

   */
  async initializeWithServerManager(serverManager: ServerManager): Promise<void> {
    if (this.isInitialized || this.isDestroyed) return;

    try {
      // Load xterm.js modules dynamically
      await this.initXterm();
      
      // Ensure the server is running
      await serverManager.ensureServer();
      
      await this.initializePtySession(serverManager, this.options.cwd);
      if (this.isDestroyed) return;
      
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
   * Set up PtyClient event handlers (session-level)
   */
  private setupPtyClientHandlers(): void {
    if (!this.ptyClient || !this.sessionId) return;
    
    // Handle output data (session-level)
    this.outputUnsubscribe = this.ptyClient.onSessionOutput(this.sessionId, (data: Uint8Array) => {
      const rawText = new TextDecoder().decode(data);
      const filteredText = filterSynchronizedOutputScrollbackPurge(
        rawText,
        this.synchronizedOutputCompatibilityState,
      );
      this.extractCwdFromOutput(filteredText);
      this.updateWin32InputMode(filteredText);
      this.xterm.write(filteredText);
    });
    
    // Handle exit events (session-level)
    this.exitUnsubscribe = this.ptyClient.onSessionExit(this.sessionId, (code: number) => {
      debugLog('[Terminal] PTY 会话退出, code:', code);
      this.xterm.write(`\r\n\x1b[33m[会话已结束, 退出码: ${code}]\x1b[0m\r\n`);
    });
    
    // Handle error events (session-level)
    this.errorUnsubscribe = this.ptyClient.onSessionError(this.sessionId, (code: string, message: string) => {
      errorLog('[Terminal] PTY 错误:', code, message);
      this.xterm.write(`\r\n\x1b[1;31m[错误] ${message}\x1b[0m\r\n`);
    });

    // Handle shell integration events
    this.shellEventUnsubscribe = this.ptyClient.onSessionShellEvent(this.sessionId, (event: ShellEvent) => {
      this.handleShellEvent(event);
    });
  }

  private buildPtyConfig(cwd: string | undefined): PtyConfig {
    const terminalEnv = buildClaudeCodeTuiEnv(
      process.env,
      this.options.env,
    );

    return {
      shell_type: this.shellType === 'default' ? undefined : this.shellType,
      shell_args: this.options.shellArgs,
      cwd,
      env: terminalEnv,
      cols: this.xterm.cols,
      rows: this.xterm.rows,
    };
  }

  private async initializePtySession(serverManager: ServerManager, cwd: string | undefined): Promise<void> {
    const ptyClient = serverManager.pty();
    this.resetSessionProtocolState();
    const sessionId = await ptyClient.init(this.buildPtyConfig(cwd));
    if (this.isDestroyed) {
      ptyClient.destroySession(sessionId);
      return;
    }

    this.ptyClient = ptyClient;
    this.sessionId = sessionId;
    debugLog('[Terminal] 获取到 session_id:', this.sessionId);
    this.setupPtyClientHandlers();
  }

  private resetSessionProtocolState(): void {
    this.win32InputModeEnabled = false;
    this.claudeCodeSessionState.reset();
    this.pendingControlSequenceText = '';
    this.synchronizedOutputCompatibilityState = createSynchronizedOutputCompatibilityState();
  }

  private disposePtyClientHandlers(): void {
    this.outputUnsubscribe?.();
    this.exitUnsubscribe?.();
    this.errorUnsubscribe?.();
    this.shellEventUnsubscribe?.();

    this.outputUnsubscribe = null;
    this.exitUnsubscribe = null;
    this.errorUnsubscribe = null;
    this.shellEventUnsubscribe = null;
  }

  private setupXtermHandlers(): void {
    const keyboardProtocol = new EnhancedKeyboardProtocol({
      queueInput: (data) => {
        this.queueInput(data);
      },
      flushPendingInput: () => {
        this.flushPendingInput();
      },
      writeBinary: (data) => {
        if (this.ptyClient && this.sessionId) {
          this.ptyClient.writeBinary(this.sessionId, data);
        }
      },
      hasSelection: () => this.xterm.hasSelection(),
      getSelection: () => this.xterm.getSelection(),
      clearSelection: () => {
        this.xterm.clearSelection();
      },
      readClipboardText: () => navigator.clipboard.readText(),
      writeClipboardText: (text) => navigator.clipboard.writeText(text),
      insertText: (text) => {
        if (text) {
          this.write(text);
        }
      },
      pasteText: (text) => {
        if (text) {
          this.pasteText(text);
        }
      },
      onError: (message, error) => {
        errorLog(`[Terminal] ${message}:`, error);
      },
    }, () => ({
      shiftEnterMode: this.win32InputModeEnabled ? 'win32-input-mode' : 'newline',
      extendedKeyboardMode: this.getClaudeCodeExtendedKeyboardMode(),
    }));

    this.xterm.onData((data) => {
      keyboardProtocol.handleData(data);
    });

    this.xterm.onBinary((data) => {
      keyboardProtocol.handleBinary(data);
    });

    this.xterm.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      return keyboardProtocol.handleKeyboardEvent(event);
    });
  }

  private setupClaudeCodeTuiHandlers(): void {
    this.parserDisposables.push(
      this.xterm.parser.registerCsiHandler({ prefix: '>', final: 'q' }, (params) => {
        if (!this.isXtversionQuery(params)) {
          return false;
        }

        this.observeClaudeCodeXtversionQuery();
        this.write(XTVERSION_RESPONSE);
        return true;
      }),
      this.xterm.parser.registerOscHandler(52, (data) => {
        return this.handleOsc52ClipboardData(data, 'OSC 52');
      }),
      this.xterm.parser.registerCsiHandler({ prefix: '>', final: 'm' }, (params) => {
        if (params[0] !== 4) {
          return false;
        }

        this.observeClaudeCodeModifyOtherKeysMode(params[1] === 2);
        return true;
      }),
      this.xterm.parser.registerDcsHandler({ final: 't' }, (data) => {
        const text = decodeTmuxPassthroughOsc52Clipboard(data);
        if (text !== null) {
          this.writeClipboardFromTerminal(text, 'tmux OSC 52 passthrough');
          return true;
        }

        return false;
      }),
    );
  }

  private getClaudeCodeExtendedKeyboardMode(): ClaudeCodeExtendedKeyboardMode {
    return this.claudeCodeSessionState.getExtendedKeyboardMode();
  }

  private observeClaudeCodeXtversionQuery(): void {
    this.claudeCodeSessionState.observeXtversionQuery();
    this.applyTitleChange(this.titleState.setAutomaticTitle('Claude Code'));
  }

  private observeClaudeCodeModifyOtherKeysMode(enabled: boolean): void {
    this.claudeCodeSessionState.observeModifyOtherKeysMode(enabled);
    this.applyTitleChange(
      enabled
        ? this.titleState.setAutomaticTitle('Claude Code')
        : this.titleState.clearAutomaticTitle()
    );
  }

  private observeShellPrompt(): void {
    this.claudeCodeSessionState.observeShellPrompt();
    this.applyTitleChange(this.titleState.clearAutomaticTitle());
  }

  private applyTitleChange(changed: boolean): void {
    if (changed) {
      const title = this.titleState.getTitle();
      this.titleChangeCallbacks.forEach((callback) => callback(title));
    }
  }

  private isXtversionQuery(params: (number | number[])[]): boolean {
    const firstParam = params[0];
    return firstParam === undefined || firstParam === 0;
  }

  private handleOsc52ClipboardData(data: string, source: string): boolean {
    const text = decodeOsc52Clipboard(data);
    if (text === null) {
      return false;
    }

    this.writeClipboardFromTerminal(text, source);
    return true;
  }

  private writeClipboardFromTerminal(text: string, source: string): void {
    if (!navigator.clipboard?.writeText) {
      debugWarn(`[Terminal] ${source} clipboard write is unavailable`);
      return;
    }

    void navigator.clipboard.writeText(text).catch((error) => {
      errorLog(`[Terminal] ${source} clipboard write failed:`, error);
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

  private clearPendingInput(): void {
    if (this.inputFlushTimer !== null) {
      window.clearTimeout(this.inputFlushTimer);
      this.inputFlushTimer = null;
    }
    this.pendingInput = [];
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

  private updateWin32InputMode(data: string): void {
    if (!isWindows()) {
      return;
    }

    const buffer = `${this.pendingControlSequenceText}${data}`;
    // eslint-disable-next-line no-control-regex -- Need to match ANSI control sequences
    const modeRegex = /\x1b\[\?9001([hl])/g;
    let match: RegExpExecArray | null = null;
    while ((match = modeRegex.exec(buffer)) !== null) {
      this.win32InputModeEnabled = match[1] === 'h';
    }

    this.pendingControlSequenceText = buffer.slice(-32);
  }

  /**
   * Send a resize message
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

    this.webSocketDisconnected = false;
    this.sessionRecoveryNeeded = true;
    this.clearPendingInput();
    this.xterm.write('\r\n\x1b[1;31m[服务器已崩溃]\x1b[0m\r\n');
    this.xterm.write('\x1b[33m正在尝试重启服务器...\x1b[0m\r\n');
  }

  handleWebSocketDisconnected(): void {
    if (this.isDestroyed) return;

    this.sessionRecoveryNeeded = true;
    this.clearPendingInput();
    if (this.webSocketDisconnected) return;
    this.webSocketDisconnected = true;
    this.xterm.write('\r\n\x1b[33m[WebSocket 连接已断开，正在重连...]\x1b[0m\r\n');
  }

  async handleWebSocketConnected(serverManager: ServerManager): Promise<void> {
    if (
      this.isDestroyed
      || this.sessionRecoveryInProgress
      || !this.sessionRecoveryNeeded
    ) {
      return;
    }

    this.sessionRecoveryInProgress = true;
    this.xterm.write('\x1b[32m[连接已恢复，正在恢复终端会话...]\x1b[0m\r\n');

    try {
      this.disposePtyClientHandlers();
      this.sessionId = null;
      this.clearPendingInput();

      const reconnectCwd = this.currentCwd ?? this.options.cwd;
      try {
        await this.initializePtySession(serverManager, reconnectCwd);
      } catch (error) {
        if (!this.currentCwd || this.currentCwd === this.options.cwd) {
          throw error;
        }

        debugWarn('[Terminal] 使用当前目录恢复会话失败，回退到初始目录:', error);
        await this.initializePtySession(serverManager, this.options.cwd);
      }
      if (this.isDestroyed) return;

      this.sessionRecoveryNeeded = false;
      this.webSocketDisconnected = false;
      this.xterm.write('\x1b[32m[终端会话已恢复]\x1b[0m\r\n');
      this.fit();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errorLog('[Terminal] 恢复终端会话失败:', error);
      this.sessionRecoveryNeeded = true;
      this.webSocketDisconnected = true;
      this.xterm.write(`\x1b[1;31m[终端会话恢复失败] ${errorMessage}\x1b[0m\r\n`);
    } finally {
      this.sessionRecoveryInProgress = false;
    }
  }

  destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;

    this.clearPendingInput();
    this.promptMarkers = [];
    this.commandMarkers = [];

    // Unsubscribe from events
    this.disposePtyClientHandlers();
    for (const disposable of this.parserDisposables) {
      try { disposable.dispose(); } catch { /* ignore */ }
    }
    this.parserDisposables = [];

    // Destroy the PTY session
    if (this.ptyClient && this.sessionId) {
      this.ptyClient.destroySession(this.sessionId);
    }

    this.detach();

    if (this.renderer) {
      try { this.renderer.dispose(); } catch { /* ignore */ }
      this.renderer = null;
    }
    this.rendererType = null;

    // Clear references
    this.ptyClient = null;
    this.sessionId = null;

    try { this.xterm.dispose(); } catch { /* ignore */ }
  }

  attachToElement(container: HTMLElement): void {
    if (this.isDestroyed) {
      throw new Error(t('terminalInstance.instanceDestroyed'));
    }

    const containerWindow = container.ownerDocument.defaultView ?? window;
    if (
      this.containerEl === container
      && this.xterm.element?.parentElement === container
      && this.hostWindow === containerWindow
    ) {
      return;
    }

    this.detach();
    this.containerEl = container;
    this.hostWindow = containerWindow;

    try {
      if (this.xterm.element) {
        container.appendChild(this.xterm.element);
      }
      this.xterm.open(container);
      this.syncBackgroundLayerStyles();
    } catch (error) {
      errorLog('[Terminal] xterm.open() failed:', error);
      throw error;
    }

    // Set up the context menu and keyboard shortcuts
    this.setupDomEventHandlers(container);

    const preferredRenderer = this.options.preferredRenderer || 'canvas';

    // Load the renderer asynchronously
    window.requestAnimationFrame(() => {
      void this.loadRenderer(preferredRenderer)
        .then(() => {
          this.syncBackgroundLayerStyles();
          this.fit();
        })
        .catch((error) => {
          const errorMsg = error instanceof Error ? error.message : String(error);
          this.xterm.write(`\r\n\x1b[1;31m[渲染器错误] ${errorMsg}\x1b[0m\r\n`);
        });
    });
  }

  /**
   * Set up keyboard shortcuts
   */
  private setupDomEventHandlers(container: HTMLElement): void {
    this.disposeDomEventHandlers();
    this.setupKeyboardShortcuts(container);
    this.setupContextMenu(container);
  }

  private addDomEventListener<K extends keyof HTMLElementEventMap>(
    container: HTMLElement,
    type: K,
    listener: (event: HTMLElementEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void {
    container.addEventListener(type, listener, options);
    this.domEventCleanups.push(() => {
      container.removeEventListener(type, listener, options);
    });
  }

  private disposeDomEventHandlers(): void {
    for (const cleanup of this.domEventCleanups.splice(0)) {
      cleanup();
    }
  }

  private setupKeyboardShortcuts(container: HTMLElement): void {
    this.addDomEventListener(container, 'keydown', (e: KeyboardEvent) => {
      const isCtrlOrCmd = e.ctrlKey || e.metaKey;
      
      // Ctrl+Shift+A: Select all
      if (isCtrlOrCmd && e.shiftKey && e.key === 'A') {
        e.preventDefault();
        e.stopPropagation();
        this.xterm.selectAll();
        return;
      }
      
      // Ctrl+F: Search
      if (isCtrlOrCmd && e.key === 'f') {
        e.preventDefault();
        e.stopPropagation();
        this.toggleSearch();
        return;
      }
      
      // Escape: Close search
      if (e.key === 'Escape' && this.searchVisible) {
        e.preventDefault();
        this.hideSearch();
        return;
      }
      
      // Ctrl+plus/equal: Increase font size
      if (isCtrlOrCmd && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        this.increaseFontSize();
        return;
      }
      
      // Ctrl+minus: Decrease font size
      if (isCtrlOrCmd && e.key === '-') {
        e.preventDefault();
        this.decreaseFontSize();
        return;
      }
      
      // Ctrl+0: Reset font size
      if (isCtrlOrCmd && e.key === '0') {
        e.preventDefault();
        this.resetFontSize();
        return;
      }
    });

    // Ctrl+wheel: Adjust font size
    this.addDomEventListener(container, 'wheel', (e: WheelEvent) => {
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
   * Set up the terminal context menu
   */
  private setupContextMenu(container: HTMLElement): void {
    this.addDomEventListener(container, 'contextmenu', (e: MouseEvent) => {
      const action = resolveTerminalContextMenuAction({
        isClaudeCodeSession: this.isClaudeCodeSession(),
        event: e,
      });

      // Either way Termy stops the host (browser / Obsidian) from also
      // popping its own context menu on this gesture.
      e.preventDefault();
      e.stopPropagation();

      if (action === 'suppress') {
        // Claude Code's TUI already handles right-click as paste through
        // xterm.js mouse tracking. Termy must not also paste here, otherwise
        // the clipboard contents land in the terminal twice.
        return;
      }

      // Calculate the terminal row/column coordinates for the mouse click
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Calculate coordinates using xterm.js sizing assumptions
      const coords = this.getTerminalCoordinates(x, y);

      this.showContextMenu(container, e.clientX, e.clientY, coords);
    });
  }


  /**
   * Show the context menu
   */
  private showContextMenu(
    host: HTMLElement,
    x: number,
    y: number,
    coords?: { col: number; row: number }
  ): void {
    const menuDocument = host.ownerDocument;
    const menuWindow = menuDocument.defaultView ?? window;

    // Remove any existing menu
    const existingMenu = menuDocument.querySelector('.terminal-context-menu');
    if (existingMenu) {
      existingMenu.remove();
    }

    const menu = menuDocument.createElement('div');
    menu.className = 'terminal-context-menu';
    menu.setCssStyles({ left: `${x}px`, top: `${y}px` });

    const hasSelection = this.xterm.hasSelection();
    const selectedText = hasSelection ? this.xterm.getSelection() : '';

    // Copy
    menu.appendChild(this.createMenuItem(
      menuDocument,
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

    // Copy as plain text (strip ANSI escape sequences)
    menu.appendChild(this.createMenuItem(
      menuDocument,
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

    // Paste
    menu.appendChild(this.createMenuItem(
      menuDocument,
      t('terminal.contextMenu.paste'),
      'clipboard-paste',
      true,
      () => {
        void this.pasteFromClipboard();
      },
      'Ctrl+Shift+V'
    ));

    menu.appendChild(this.createSeparator(menuDocument));

    // Select all content
    menu.appendChild(this.createMenuItem(
      menuDocument,
      t('terminal.contextMenu.selectAll'),
      'select-all',
      true,
      () => this.xterm.selectAll(),
      'Ctrl+Shift+A'
    ));

    // Select the current line
    if (coords) {
      menu.appendChild(this.createMenuItem(
        menuDocument,
        t('terminal.contextMenu.selectLine'),
        'minus',
        true,
        () => this.selectLine(coords.row)
      ));
    }

    // Search
    menu.appendChild(this.createMenuItem(
      menuDocument,
      t('terminal.contextMenu.search'),
      'search',
      true,
      () => this.toggleSearch(),
      'Ctrl+F'
    ));

    menu.appendChild(this.createSeparator(menuDocument));

    // Copy the current path
    menu.appendChild(this.createMenuItem(
      menuDocument,
      t('terminal.contextMenu.copyPath'),
      'folder',
      true,
      () => {
        const cwd = this.getCwd();
        void this.writeToClipboard(cwd);
      }
    ));

    // Open in the file manager
    menu.appendChild(this.createMenuItem(
      menuDocument,
      t('terminal.contextMenu.openInExplorer'),
      'folder-open',
      true,
      () => {
        const cwd = this.getCwd();
        this.openInFileManager(cwd);
      }
    ));

    menu.appendChild(this.createSeparator(menuDocument));

    if (this.contextMenuCallbacks.onToggleAlwaysOnTop) {
      menu.appendChild(this.createMenuItem(
        menuDocument,
        this.contextMenuCallbacks.getAlwaysOnTopLabel?.() ?? t('terminal.contextMenu.pinToTop'),
        'lock',
        true,
        () => this.contextMenuCallbacks.onToggleAlwaysOnTop?.()
      ));
    }

    // New terminal
    menu.appendChild(this.createMenuItem(
      menuDocument,
      t('terminal.contextMenu.newTerminal'),
      'terminal',
      true,
      () => this.contextMenuCallbacks.onNewTerminal?.(),
      'Ctrl+O'
    ));

    // Split terminal submenu
    const splitSubmenu = this.createSubmenuItem(
      menuDocument,
      menuWindow,
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

    const defaultShellOptions = this.contextMenuCallbacks.getDefaultShellOptions?.() ?? [];
    if (defaultShellOptions.length > 0 && this.contextMenuCallbacks.onDefaultShellChange) {
      menu.appendChild(this.createSubmenuItem(
        menuDocument,
        menuWindow,
        t('terminal.contextMenu.switchDefaultTerminal'),
        'terminal',
        defaultShellOptions.map((option) => ({
          label: option.label,
          icon: option.selected ? 'check' : 'blank',
          onClick: () => this.contextMenuCallbacks.onDefaultShellChange?.(option.shellType),
        }))
      ));
    }

    menu.appendChild(this.createSeparator(menuDocument));

    // Font size submenu
    const fontSubmenu = this.createSubmenuItem(
      menuDocument,
      menuWindow,
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

    // Clear the screen
    menu.appendChild(this.createMenuItem(
      menuDocument,
      t('terminal.contextMenu.clear'),
      'trash',
      true,
      () => this.clearScreen(),
      'Ctrl+Shift+R'
    ));

    // Clear the buffer
    menu.appendChild(this.createMenuItem(
      menuDocument,
      t('terminal.contextMenu.clearBuffer'),
      'trash',
      true,
      () => this.clearBuffer(),
      'Ctrl+Shift+K'
    ));

    menuDocument.body.appendChild(menu);

    // Adjust the menu position
    const rect = menu.getBoundingClientRect();
    if (rect.right > menuWindow.innerWidth) {
      menu.setCssStyles({ left: `${menuWindow.innerWidth - rect.width - 5}px` });
    }
    if (rect.bottom > menuWindow.innerHeight) {
      menu.setCssStyles({ top: `${menuWindow.innerHeight - rect.height - 5}px` });
    }

    // Close the menu when clicking elsewhere
    const closeMenu = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node)) {
        menu.remove();
        menuDocument.removeEventListener('click', closeMenu);
        menuDocument.removeEventListener('contextmenu', closeMenu);
      }
    };

    window.setTimeout(() => {
      menuDocument.addEventListener('click', closeMenu);
      menuDocument.addEventListener('contextmenu', closeMenu);
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

  /**
   * Create a menu item
   */
  private createMenuItem(
    menuDocument: Document,
    label: string,
    icon: string,
    enabled: boolean,
    onClick: () => void,
    shortcut?: string
  ): HTMLElement {
    const item = menuDocument.createElement('div');
    item.className = 'terminal-context-menu-item';
    if (!enabled) item.addClass('is-disabled');

    // Icon
    const iconEl = menuDocument.createElement('span');
    iconEl.className = 'terminal-context-menu-icon';
    if (!enabled) iconEl.addClass('is-disabled');
    const iconSvg = this.createIconElement(menuDocument, icon);
    if (iconSvg) iconEl.appendChild(iconSvg);
    item.appendChild(iconEl);

    // Text
    const textEl = menuDocument.createElement('span');
    textEl.textContent = label;
    textEl.className = 'terminal-context-menu-text';
    item.appendChild(textEl);

    // Shortcut
    if (shortcut) {
      const shortcutEl = menuDocument.createElement('span');
      shortcutEl.textContent = shortcut;
      shortcutEl.className = 'terminal-context-menu-shortcut';
      item.appendChild(shortcutEl);
    }

    if (enabled) {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick();
        menuDocument.querySelector('.terminal-context-menu')?.remove();
      });
    }

    return item;
  }

  /**
   * Create a submenu item
   */
  private createSubmenuItem(
    menuDocument: Document,
    menuWindow: Window,
    label: string,
    icon: string,
    items: Array<{ label: string; icon: string; onClick: () => void; shortcut?: string }>
  ): HTMLElement {
    const container = menuDocument.createElement('div');
    container.className = 'terminal-context-submenu-container';

    const item = menuDocument.createElement('div');
    item.className = 'terminal-context-menu-item';

    // Icon
    const iconEl = menuDocument.createElement('span');
    iconEl.className = 'terminal-context-menu-icon';
    const iconSvg = this.createIconElement(menuDocument, icon);
    if (iconSvg) iconEl.appendChild(iconSvg);
    item.appendChild(iconEl);

    // Text
    const textEl = menuDocument.createElement('span');
    textEl.textContent = label;
    textEl.className = 'terminal-context-menu-text';
    item.appendChild(textEl);

    // Arrow
    const arrowEl = menuDocument.createElement('span');
    arrowEl.className = 'terminal-context-submenu-arrow';
    const arrowSvg = this.createIconElement(menuDocument, 'chevron-right');
    if (arrowSvg) arrowEl.appendChild(arrowSvg);
    item.appendChild(arrowEl);

    container.appendChild(item);

    // Submenu
    const submenu = menuDocument.createElement('div');
    submenu.className = 'terminal-context-submenu';

    items.forEach(subItem => {
      submenu.appendChild(this.createMenuItem(menuDocument, subItem.label, subItem.icon, true, subItem.onClick, subItem.shortcut));
    });

    container.appendChild(submenu);

    // Show the submenu on hover
    item.addEventListener('mouseenter', () => {
      submenu.addClass('is-visible');
      submenu.removeClass('is-flipped');
      const submenuTopReset = '0';
      submenu.style.top = submenuTopReset;

      // Adjust the submenu position
      const rect = submenu.getBoundingClientRect();
      if (rect.right > menuWindow.innerWidth) {
        submenu.addClass('is-flipped');
      }

      const adjustedRect = submenu.getBoundingClientRect();
      if (adjustedRect.bottom > menuWindow.innerHeight) {
        const topOffset = Math.min(0, menuWindow.innerHeight - adjustedRect.bottom - 8);
        submenu.style.top = `${topOffset}px`;
      }
    });

    container.addEventListener('mouseleave', () => {
      submenu.removeClass('is-visible');
    });

    return container;
  }

  /**
   * Create a separator
   */
  private createSeparator(menuDocument: Document): HTMLElement {
    const separator = menuDocument.createElement('div');
    separator.className = 'terminal-context-separator';
    return separator;
  }

  /**
   * Strip ANSI escape sequences
   */
  private stripAnsiCodes(text: string): string {
    // eslint-disable-next-line no-control-regex -- Need to match ANSI control sequences
    return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
  }


  /**
   * Get the icon SVG
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
      'lock': '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>',
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
      'check': '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg>',
      'blank': '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"></svg>',
    };
    return icons[icon] || '';
  }

  private createIconElement(menuDocument: Document, icon: string): SVGElement | null {
    const svgText = this.getIconSvg(icon);
    if (!svgText) return null;
    const DOMParserCtor = menuDocument.defaultView?.DOMParser ?? DOMParser;
    const parsed = new DOMParserCtor().parseFromString(svgText, 'image/svg+xml');
    const svg = parsed.querySelector('svg');
    return svg ? menuDocument.importNode(svg, true) : null;
  }

  // ==================== Search ====================

  /**
   * Toggle search bar visibility
   */
  toggleSearch(): void {
    if (this.searchVisible) {
      this.hideSearch();
    } else {
      this.showSearch();
    }
  }

  /**
   * Show the search bar
   */
  showSearch(): void {
    this.searchVisible = true;
    this.searchStateCallbacks.forEach((callback) => callback(true));
  }

  /**
   * Hide the search bar
   */
  hideSearch(): void {
    this.searchVisible = false;
    this.searchAddon.clearDecorations();
    this.searchStateCallbacks.forEach((callback) => callback(false));
    this.focus();
  }

  /**
   * Search text
   */
  search(query: string, options?: { caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean }): boolean {
    if (!query) {
      this.searchAddon.clearDecorations();
      return false;
    }
    this.lastSearchQuery = query;
    
    // Use the current theme colors for search highlighting
    const isDark = activeDocument.body.classList.contains('theme-dark');
    
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
   * Search next
   */
  searchNext(): boolean {
    if (!this.lastSearchQuery) return false;
    return this.searchAddon.findNext(this.lastSearchQuery);
  }

  /**
   * Search previous
   */
  searchPrevious(): boolean {
    if (!this.lastSearchQuery) return false;
    return this.searchAddon.findPrevious(this.lastSearchQuery);
  }

  /**
   * Clear search highlighting
   */
  clearSearch(): void {
    this.searchAddon.clearDecorations();
    this.lastSearchQuery = '';
  }

  /**
   * Listen for search state changes
   */
  onSearchStateChange(callback: SearchStateCallback): () => void {
    this.searchStateCallbacks.add(callback);
    return () => {
      this.searchStateCallbacks.delete(callback);
    };
  }

  /**
   * Get whether the search UI is visible
   */
  isSearchVisible(): boolean {
    return this.searchVisible;
  }

  // ==================== Shell Integration ====================

  private handleShellEvent(event: ShellEvent): void {
    if (event.type === 'prompt_start') {
      this.observeShellPrompt();
      this.promptMarkers.push(this.xterm.registerMarker(0));
    }

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
      this.commandMarkers.push({
        marker: this.xterm.registerMarker(0),
        exitCode: event.exitCode,
      });
      this.activeCommandStart = null;
    }

    this.shellEventCallback?.(event);
  }

  /**
   * Listen for shell integration events
   */
  onShellEvent(callback: (event: ShellEvent) => void): void {
    this.shellEventCallback = callback;
  }

  /**
   * Get command history
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

  // ==================== Font Size Adjustment ====================

  /**
   * Increase font size
   */
  increaseFontSize(): void {
    if (this.currentFontSize < this.maxFontSize) {
      this.setFontSize(this.currentFontSize + 1);
    }
  }

  /**
   * Decrease font size
   */
  decreaseFontSize(): void {
    if (this.currentFontSize > this.minFontSize) {
      this.setFontSize(this.currentFontSize - 1);
    }
  }

  /**
   * Reset font size
   */
  resetFontSize(): void {
    this.setFontSize(this.options.fontSize ?? 14);
  }

  /**
   * Set font size
   */
  setFontSize(size: number): void {
    const newSize = Math.max(this.minFontSize, Math.min(this.maxFontSize, size));
    if (newSize !== this.currentFontSize) {
      this.currentFontSize = newSize;
      this.xterm.options.fontSize = newSize;
      this.fit();
      this.fontSizeChangeCallbacks.forEach((callback) => callback(newSize));
    }
  }

  /**
   * Get the current font size
   */
  getFontSize(): number {
    return this.currentFontSize;
  }

  /**
   * Listen for font size changes
   */
  onFontSizeChange(callback: FontSizeChangeCallback): () => void {
    this.fontSizeChangeCallbacks.add(callback);
    return () => {
      this.fontSizeChangeCallbacks.delete(callback);
    };
  }

  // ==================== Context Menu Callback Setup ====================

  /**
   * Set the new terminal callback
   */
  setOnNewTerminal(callback: () => void): void {
    this.contextMenuCallbacks.onNewTerminal = callback;
  }

  /**
   * Set the split terminal callback
   */
  setOnSplitTerminal(callback: (direction: 'horizontal' | 'vertical') => void): void {
    this.contextMenuCallbacks.onSplitTerminal = callback;
  }

  setOnToggleAlwaysOnTop(callback: () => void, getLabel: () => string): void {
    this.contextMenuCallbacks.onToggleAlwaysOnTop = callback;
    this.contextMenuCallbacks.getAlwaysOnTopLabel = getLabel;
  }

  setDefaultShellMenuCallbacks(
    getOptions: () => DefaultShellOption[],
    onChange: (shellType: DefaultShellOption['shellType']) => void,
  ): void {
    this.contextMenuCallbacks.getDefaultShellOptions = getOptions;
    this.contextMenuCallbacks.onDefaultShellChange = onChange;
  }

  // ==================== Other Public Methods ====================

  /**
   * Write data to the terminal
   */
  write(data: string): void {
    if (this.ptyClient && this.sessionId) {
      this.ptyClient.write(this.sessionId, data);
    }
  }

  sendText(data: string): void {
    this.write(data);
  }

  pasteText(text: string): void {
    const formatted = formatPastedTerminalText(text, this.xterm.modes.bracketedPasteMode);
    this.write(formatted);
  }

  async pasteFromClipboard(): Promise<void> {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        this.pasteText(text);
      }
    } catch (error) {
      errorLog('[Terminal] Paste failed:', error);
    }
  }

  detach(): void {
    this.disposeDomEventHandlers();
    this.xterm.element?.remove();
    this.containerEl = null;
    this.hostWindow = null;
  }

  focus(): void {
    if (!this.isDestroyed) this.xterm.focus();
  }

  isAlive(): boolean {
    return !this.isDestroyed && this.ptyClient !== null && this.ptyClient.isConnected();
  }

  getTitle(): string { return this.titleState.getTitle(); }

  isClaudeCodeSession(): boolean {
    return this.claudeCodeSessionState.isActive();
  }

  getOptions(): Readonly<TerminalOptions> {
    return this.options;
  }

  setTitle(title: string): void {
    this.applyTitleChange(this.titleState.setCustomTitle(title));
  }


  /**
   * Extract the current working directory from shell output.
   *
   * Recognizes (in priority order): OSC 7 (standard), OSC 9;9
   * (Windows Terminal / PowerShell), the Git Bash window-title OSC 0,
   * and finally the prompt-string parsers in `promptCwdParsers.ts`
   * for cmd / PowerShell / Git Bash / WSL.
   */
  private extractCwdFromOutput(data: string): void {
    // OSC 7 format (standard): \x1b]7;file://hostname/path\x07 or \x1b]7;file://hostname/path\x1b\\
    // eslint-disable-next-line no-control-regex -- Need to match ANSI control sequences
    const osc7Match = data.match(/\x1b\]7;file:\/\/[^/]*([^\x07\x1b]+)[\x07\x1b]/);
    if (osc7Match) {
      try {
        const path = decodeURIComponent(osc7Match[1]);
        this.currentCwd = path;
        debugLog('[Terminal CWD] OSC7 matched:', path);
        return;
      } catch {
        // Ignore decode failures
      }
    }

    // OSC 9;9 format (Windows Terminal/PowerShell): \x1b]9;9;path\x07
    // eslint-disable-next-line no-control-regex -- Need to match ANSI control sequences
    const osc9Match = data.match(/\x1b\]9;9;([^\x07\x1b]+)[\x07\x1b]/);
    if (osc9Match) {
      this.currentCwd = osc9Match[1];
      debugLog('[Terminal CWD] OSC9 matched:', this.currentCwd);
      return;
    }

    // OSC 0 (Git Bash window title): \x1b]0;MINGW64:/path\x07
    const gitBashWindowTitleCwd = extractGitBashWindowTitleCwd(data);
    if (gitBashWindowTitleCwd) {
      this.currentCwd = gitBashWindowTitleCwd;
      debugLog('[Terminal CWD] OSC0 (Git Bash) matched:', gitBashWindowTitleCwd);
      return;
    }

    // Prompt parsing (fallback for shells that do not emit OSC sequences).
    // eslint-disable-next-line no-control-regex -- Need to strip CSI sequences before prompt matching
    const cleanData = data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

    const psCwd = extractPowerShellCwd(cleanData);
    if (psCwd) {
      this.currentCwd = psCwd;
      debugLog('[Terminal CWD] PowerShell prompt matched:', psCwd);
      return;
    }

    const cmdCwd = extractCmdCwd(cleanData);
    if (cmdCwd) {
      this.currentCwd = cmdCwd;
      debugLog('[Terminal CWD] CMD prompt matched:', cmdCwd);
      return;
    }

    const gitBashCwd = extractGitBashPromptCwd(cleanData, getHomeDir());
    if (gitBashCwd) {
      this.currentCwd = gitBashCwd;
      debugLog('[Terminal CWD] Git Bash prompt matched:', gitBashCwd);
      return;
    }

    const wslCwd = extractWslPromptCwd(cleanData);
    if (wslCwd) {
      this.currentCwd = wslCwd;
      debugLog('[Terminal CWD] WSL prompt matched:', wslCwd);
    }
  }

  /**
   * Get the terminal's initial working directory
   */
  getInitialCwd(): string {
    return this.options.cwd || getHomeDir() || process.cwd();
  }

  /**
   * Get the current working directory.
   *
   * Strategy:
   *  1. Pull the prompt straight off the xterm screen at the cursor
   *     row. This is the reliable path for cmd under conpty (conpty
   *     sends cursor-positioning escapes instead of full prompt
   *     strings, but the rendered cells always show what the user
   *     sees) and is also a no-op upgrade for shells that already
   *     populate `currentCwd` via OSC 7/9;9 — the screen value
   *     matches what they wrote anyway.
   *  2. Trust `currentCwd` as the second-best source. It carries
   *     OSC-derived values that may be slightly fresher than the
   *     screen if the user is mid-typing a new command.
   *  3. Fall back to the initial cwd as a last resort.
   *
   * The screen value is intentionally NOT written back into
   * `currentCwd`: keeping screen-derived reads pure avoids polluting
   * the streaming-parser state in cases where the screen lags behind
   * an already-emitted OSC sequence.
   */
  getCwd(): string {
    const screenCwd = this.readCwdFromScreen();
    if (screenCwd) {
      if (screenCwd !== this.currentCwd) {
        debugLog('[Terminal CWD] Read from screen:', screenCwd);
      }
      return screenCwd;
    }
    return this.currentCwd || this.getInitialCwd();
  }

  /**
   * Read the cwd from the xterm.js buffer at the current cursor row.
   * Falls back to the previous line when the prompt may span two
   * rows (e.g. Git Bash's `\nuser@host MINGW64 /c/path\n$`).
   */
  private readCwdFromScreen(): string | null {
    try {
      const buffer = this.xterm.buffer.active;
      const cursorAbsoluteRow = buffer.baseY + buffer.cursorY;

      const cursorLine = buffer.getLine(cursorAbsoluteRow)?.translateToString(true) ?? '';
      const previousLine =
        cursorAbsoluteRow > 0
          ? (buffer.getLine(cursorAbsoluteRow - 1)?.translateToString(true) ?? null)
          : null;

      return extractCwdFromPromptLines(
        cursorLine,
        previousLine,
        getHomeDir()
      );
    } catch (error) {
      debugWarn('[Terminal CWD] readCwdFromScreen failed:', error);
      return null;
    }
  }

  navigatePrompt(direction: 'previous' | 'next'): boolean {
    const targetLine = this.findPromptLine(direction);
    if (targetLine === null) {
      return false;
    }

    this.xterm.scrollToLine(targetLine);
    this.focus();
    return true;
  }

  navigateToLastFailedCommand(): boolean {
    const marker = [...this.commandMarkers]
      .reverse()
      .find((entry) => !entry.marker.isDisposed && entry.marker.line >= 0 && (entry.exitCode ?? 0) !== 0);

    if (!marker) {
      return false;
    }

    this.xterm.scrollToLine(marker.marker.line);
    this.focus();
    return true;
  }

  private findPromptLine(direction: 'previous' | 'next'): number | null {
    const currentViewportLine = this.xterm.buffer.active.viewportY;
    const validPromptLines = this.promptMarkers
      .filter((marker) => !marker.isDisposed && marker.line >= 0)
      .map((marker) => marker.line)
      .sort((left, right) => left - right);

    if (direction === 'previous') {
      for (let index = validPromptLines.length - 1; index >= 0; index -= 1) {
        if (validPromptLines[index] < currentViewportLine) {
          return validPromptLines[index];
        }
      }

      return null;
    }

    for (const line of validPromptLines) {
      if (line > currentViewportLine) {
        return line;
      }
    }

    return null;
  }

  onTitleChange(callback: (title: string) => void): () => void {
    this.titleChangeCallbacks.add(callback);
    return () => {
      this.titleChangeCallbacks.delete(callback);
    };
  }

  /**
   * Listen for renderer changes (canvas <-> webgl).
   * The callback fires after the renderer addon has actually been swapped in,
   * so callers should treat the value as authoritative rather than guessing.
   */
  onRendererChange(callback: RendererChangeCallback): () => void {
    this.rendererChangeCallbacks.add(callback);
    return () => {
      this.rendererChangeCallbacks.delete(callback);
    };
  }

  getXterm(): Terminal { return this.xterm; }
  getFitAddon(): FitAddon { return this.fitAddon; }
  getSearchAddon(): SearchAddon { return this.searchAddon; }

  getCurrentRenderer(): 'canvas' | 'webgl' {
    return this.rendererType ?? this.options.preferredRenderer ?? 'canvas';
  }

  /**
   * Return the effective background color used by the active xterm theme.
   * Callers (e.g. the view layer) can paint surrounding container layers
   * with the same value to avoid the cell-aligned scrollable area exposing
   * a frame of a different color.
   */
  getEffectiveBackgroundColor(): string {
    return this.getTheme().background;
  }

  /**
   * Convert mouse pixel coordinates to terminal row/column coordinates
   */
  private getTerminalCoordinates(x: number, y: number): { col: number; row: number } {
    const fontSize = this.xterm.options.fontSize || 14;
    const lineHeight = Math.ceil(fontSize * 1.2); // xterm.js default line height is about 1.2x the font size
    
    // Estimate character width for a monospace font at about 0.6x the font size
    const charWidth = fontSize * 0.6;
    
    const col = Math.floor(x / charWidth);
    const row = Math.floor(y / lineHeight);
    
    debugLog('[Terminal] Mouse coordinates:', { x, y, col, row, fontSize, charWidth, lineHeight });
    
    return { col, row };
  }

  /**
   * Convert a WSL path to a Windows path
   * @param wslPath A WSL-format path (for example, /mnt/c/Users/...)
   * @returns A Windows-format path (for example, C:\Users\...)
   */
  private convertWslPathToWindows(wslPath: string): string {
    // Match paths in /mnt/x/... format
    const wslMountMatch = wslPath.match(/^\/mnt\/([a-zA-Z])\/(.*)$/);
    if (wslMountMatch) {
      const driveLetter = wslMountMatch[1].toUpperCase();
      const restPath = wslMountMatch[2].replace(/\//g, '\\');
      return `${driveLetter}:\\${restPath}`;
    }
    return wslPath;
  }

  /**
   * Open the specified path in the OS file manager.
   *
   * Termy invokes this only with directory paths (from `getCwd()`),
   * so Electron's `shell.openPath` is enough on every platform — it
   * defers to Explorer / Finder / xdg-open and removes the need to
   * spawn a child process or build a shell command string.
   *
   * @param targetPath The directory path to open
   */
  private openInFileManager(targetPath: string): void {
    const currentPlatform = getPlatform();

    debugLog('[Terminal] Opening in file manager, original path:', targetPath);

    let finalPath = targetPath;

    // If this is a WSL terminal, convert the WSL path to a Windows path
    if (currentPlatform === 'win32' && this.shellType === 'wsl' && targetPath.startsWith('/mnt/')) {
      finalPath = this.convertWslPathToWindows(targetPath);
      debugLog('[Terminal] Converted WSL path to Windows path:', { original: targetPath, converted: finalPath });
    }

    debugLog('[Terminal] Final path for file manager:', finalPath);

    void shell.openPath(finalPath).then((errorMessage) => {
      // Electron returns a non-empty string on failure, otherwise empty.
      if (errorMessage) {
        errorLog('[Terminal] Failed to open path via shell:', errorMessage);
      }
    }).catch((openError: unknown) => {
      errorLog('[Terminal] Failed to open path via shell:', openError);
    });
  }

  /**
   * Select the full contents of the specified line
   * @param row The line number
   */
  private selectLine(row: number): void {
    const buffer = this.xterm.buffer.active;
    
    // Ensure the line number is valid
    if (row < 0 || row >= buffer.length) {
      debugLog('[Terminal] Invalid row:', row);
      return;
    }
    
    this.xterm.selectLines(row, row);
    debugLog('[Terminal] Selected line:', row);
  }

  /**
   * Clear the screen
   * Clear the current screen contents while preserving scrollback history
   */
  private clearScreen(): void {
    // First send Ctrl+C to interrupt the current input
    if (this.ptyClient && this.sessionId) {
      this.ptyClient.write(this.sessionId, '\x03');
    }
    
    // Wait briefly for the interrupt to take effect, then send the clear command
    window.setTimeout(() => {
      const clearCommand = isWindows() ? 'cls\r' : 'clear\r';
      if (this.ptyClient && this.sessionId) {
        this.ptyClient.write(this.sessionId, clearCommand);
      }
      debugLog('[Terminal] Screen cleared');
    }, 50);
  }

  /**
   * Clear the buffer
   * Fully reset terminal state, clearing all content and history
   */
  clearBuffer(): void {
    // First send Ctrl+C to interrupt the current input
    if (this.ptyClient && this.sessionId) {
      this.ptyClient.write(this.sessionId, '\x03');
    }
    
    // Wait briefly for the interrupt to take effect
    window.setTimeout(() => {
      // Send the clear command to the shell
      const clearCommand = isWindows() ? 'cls\r' : 'clear\r';
      if (this.ptyClient && this.sessionId) {
        this.ptyClient.write(this.sessionId, clearCommand);
      }
      
      // Clear xterm.js scrollback and state
      this.xterm.clear();
      this.xterm.reset();
      this.xterm.clearSelection();
      
      debugLog('[Terminal] Buffer cleared and terminal reset');
    }, 50);
  }

  updateTheme(): void {
    const theme = this.getTheme();
    this.xterm.options.theme = theme;
    this.xterm.options.allowTransparency = this.shouldUseTransparentTerminalBackground();
    this.syncBackgroundLayerStyles(theme.background);
    this.xterm.refresh(0, this.xterm.rows - 1);
  }

  updateOptions(options: Partial<TerminalOptions>): void {
    const previousScrollback = this.options.scrollback;
    const previousRenderer = this.options.preferredRenderer || 'canvas';
    const previousTransparentBackground = this.shouldUseTransparentTerminalBackground();
    this.options = { ...this.options, ...options };
    if (!this.isInitialized) {
      return;
    }
    const nextTransparentBackground = this.shouldUseTransparentTerminalBackground();
    if (options.scrollback !== undefined && options.scrollback !== previousScrollback) {
      this.xterm.options.scrollback = options.scrollback;
    }
    if (options.fontSize !== undefined) {
      this.setFontSize(options.fontSize);
    }
    if (options.fontFamily !== undefined) {
      this.xterm.options.fontFamily = options.fontFamily;
      this.fit();
    }
    if (options.cursorStyle !== undefined) {
      this.xterm.options.cursorStyle = options.cursorStyle;
    }
    if (options.cursorBlink !== undefined) {
      this.xterm.options.cursorBlink = options.cursorBlink;
    }
    this.updateTheme();
    const nextRenderer = this.options.preferredRenderer || 'canvas';
    if (nextTransparentBackground !== previousTransparentBackground) {
      this.reopenTerminalElement();
    } else if (nextRenderer !== previousRenderer) {
      this.refreshRenderer();
    }
  }
}
