import type { TerminalInstance } from '../../services/terminal/terminalInstance';
import type { TerminalService } from '../../services/terminal/terminalService';
import type { TerminalSettings } from '../../settings/settings';
import { errorLog } from '../../utils/logger';
import { t } from '../../i18n';
import {
  clearTerminalAppearanceStyles,
  syncTerminalAppearanceStyles,
} from '../terminal/terminalAppearance';

const FIT_DELAY_MS = 100;

export interface TerminalThreadSnapshot {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: number;
}

interface TerminalThread {
  readonly terminal: TerminalInstance;
  readonly createdAt: number;
  updatedAt: number;
  title: string;
  cleanupTitleChange: (() => void) | null;
  cleanupRendererChange: (() => void) | null;
}

export interface AgentTerminalThreadControllerOptions {
  readonly getTerminalService: () => Promise<TerminalService>;
  readonly getSettings: () => TerminalSettings;
  readonly onChanged: () => void;
}

export class AgentTerminalThreadController {
  private readonly getTerminalService: () => Promise<TerminalService>;
  private readonly getSettings: () => TerminalSettings;
  private readonly onChanged: () => void;
  private readonly threads: Map<string, TerminalThread> = new Map();
  private activeThreadId: string | null = null;
  private viewContainerEl: HTMLElement | null = null;
  private terminalContainerEl: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor(options: AgentTerminalThreadControllerOptions) {
    this.getTerminalService = options.getTerminalService;
    this.getSettings = options.getSettings;
    this.onChanged = options.onChanged;
  }

  listThreads(): TerminalThreadSnapshot[] {
    return [...this.threads.values()]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map((thread) => ({
        id: thread.terminal.id,
        title: thread.title,
        updatedAt: thread.updatedAt,
      }));
  }

  getActiveThreadId(): string | null {
    return this.activeThreadId;
  }

  getActiveTerminal(): TerminalInstance | null {
    if (!this.activeThreadId) return null;
    return this.threads.get(this.activeThreadId)?.terminal ?? null;
  }

  getActiveTitle(): string | null {
    const terminal = this.getActiveTerminal();
    return terminal?.getTitle() ?? null;
  }

  hasThreads(): boolean {
    return this.threads.size > 0;
  }

  async createThread(): Promise<TerminalThreadSnapshot> {
    const terminalService = await this.getTerminalService();
    const terminal = await terminalService.createTerminal();
    const now = Date.now();
    const thread: TerminalThread = {
      terminal,
      createdAt: now,
      updatedAt: now,
      title: terminal.getTitle(),
      cleanupTitleChange: null,
      cleanupRendererChange: null,
    };

    thread.cleanupTitleChange = terminal.onTitleChange((title) => {
      thread.title = title;
      thread.updatedAt = Date.now();
      this.onChanged();
    });
    thread.cleanupRendererChange = terminal.onRendererChange(() => {
      this.syncActiveAppearance();
    });

    this.threads.set(terminal.id, thread);
    this.setActiveThread(terminal.id);
    this.onChanged();
    return this.toSnapshot(thread);
  }

  setActiveThread(id: string): void {
    if (!this.threads.has(id)) return;
    if (this.activeThreadId === id) return;

    this.detachActiveTerminal();
    this.activeThreadId = id;
    this.mountActiveTerminal();
    this.onChanged();
  }

  async closeThread(id: string): Promise<void> {
    const thread = this.threads.get(id);
    if (!thread) return;

    if (this.activeThreadId === id) {
      this.detachActiveTerminal();
      this.activeThreadId = null;
    }

    this.cleanupThread(thread);
    this.threads.delete(id);
    await this.destroyTerminal(thread.terminal);

    const nextThread = this.listThreads()[0];
    if (nextThread) {
      this.setActiveThread(nextThread.id);
    }
    this.onChanged();
  }

  attach(viewContainerEl: HTMLElement, terminalContainerEl: HTMLElement): void {
    this.viewContainerEl = viewContainerEl;
    this.terminalContainerEl = terminalContainerEl;
    this.setupResizeObserver();
    this.mountActiveTerminal();
  }

  detach(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.detachActiveTerminal();
    this.viewContainerEl = null;
    this.terminalContainerEl = null;
  }

  refreshAppearance(): void {
    for (const thread of this.threads.values()) {
      const settings = this.getSettings();
      thread.terminal.updateOptions({
        fontSize: settings.fontSize,
        fontFamily: settings.fontFamily,
        cursorStyle: settings.cursorStyle,
        cursorBlink: settings.cursorBlink,
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
    }
    this.syncActiveAppearance();
  }

  async dispose(): Promise<void> {
    this.detach();

    const threads = [...this.threads.values()];
    this.threads.clear();
    this.activeThreadId = null;
    await Promise.all(threads.map(async (thread) => {
      this.cleanupThread(thread);
      await this.destroyTerminal(thread.terminal);
    }));
  }

  private mountActiveTerminal(): void {
    const terminal = this.getActiveTerminal();
    if (!terminal || !this.terminalContainerEl || !this.viewContainerEl) {
      return;
    }

    const bgLayer = this.terminalContainerEl.querySelector('.terminal-background-image');
    this.terminalContainerEl.empty();
    if (bgLayer) {
      this.terminalContainerEl.appendChild(bgLayer);
    }

    try {
      terminal.attachToElement(this.terminalContainerEl);
      this.syncActiveAppearance();
      window.setTimeout(() => {
        if (!terminal.isAlive()) return;
        terminal.fit();
        terminal.focus();
      }, FIT_DELAY_MS);
    } catch (error) {
      errorLog('[AgentTerminalThreadController] Failed to attach terminal:', error);
      this.terminalContainerEl.createDiv({
        cls: 'termy-agent-terminal-error',
        text: t('notices.terminal.renderFailed', { message: String(error) }),
      });
    }
  }

  private detachActiveTerminal(): void {
    this.getActiveTerminal()?.detach();
    clearTerminalAppearanceStyles(this.terminalContainerEl, this.viewContainerEl);
  }

  private setupResizeObserver(): void {
    if (!this.terminalContainerEl) return;
    this.resizeObserver?.disconnect();

    let timer: number | null = null;
    const ResizeObserverCtor = this.terminalContainerEl.ownerDocument.defaultView?.ResizeObserver ?? ResizeObserver;
    this.resizeObserver = new ResizeObserverCtor((entries) => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const { width, height } = entries[0].contentRect;
        if (width > 0 && height > 0) {
          this.getActiveTerminal()?.fit();
        }
      }, FIT_DELAY_MS);
    });
    this.resizeObserver.observe(this.terminalContainerEl);
  }

  private syncActiveAppearance(): void {
    const terminal = this.getActiveTerminal();
    if (!terminal || !this.terminalContainerEl || !this.viewContainerEl) return;
    syncTerminalAppearanceStyles({
      terminal,
      terminalContainer: this.terminalContainerEl,
      viewContainer: this.viewContainerEl,
    });
  }

  private cleanupThread(thread: TerminalThread): void {
    thread.cleanupTitleChange?.();
    thread.cleanupRendererChange?.();
    thread.cleanupTitleChange = null;
    thread.cleanupRendererChange = null;
  }

  private async destroyTerminal(terminal: TerminalInstance): Promise<void> {
    try {
      const terminalService = await this.getTerminalService();
      await terminalService.destroyTerminal(terminal.id);
    } catch (error) {
      errorLog('[AgentTerminalThreadController] Failed to destroy terminal:', error);
      terminal.destroy();
    }
  }

  private toSnapshot(thread: TerminalThread): TerminalThreadSnapshot {
    return {
      id: thread.terminal.id,
      title: thread.title,
      updatedAt: thread.updatedAt || thread.createdAt,
    };
  }
}
