import * as fs from 'fs';
import * as path from 'path';
import type { WorkspaceLeaf, Menu } from 'obsidian';
import { FileSystemAdapter, ItemView, Notice, TFile, TFolder, setIcon } from 'obsidian';
import { shell, webUtils } from 'electron';
import { WebLinksAddon } from '@xterm/addon-web-links';
import type { TerminalService } from '../../services/terminal/terminalService';
import type { TerminalInstance } from '../../services/terminal/terminalInstance';
import {
  collectFallbackDroppedTextPayload,
  collectPreferredDroppedTextPayload,
  resolveDroppedTextInput,
} from '../../services/terminal/dropTextPayload';
import { formatClaudeCodePathReferences } from '../../services/terminal/claudeCodePathReferences';
import {
  collectTerminalReferenceCandidatePaths,
  fileUriToPlatformPath,
  findUniqueTerminalEntryByBasename,
  getVaultRelativePathFromAbsolute,
  isBasenameOnlyTerminalToken,
  isAbsoluteTerminalPath,
  joinTerminalPaths,
  normalizeDroppedEntryReference,
  normalizeTerminalRawToken,
  normalizeTerminalReferencePath,
  normalizeTerminalToken,
  normalizeVaultPath,
  obsidianUriToVaultPath,
  toPlatformPath,
} from '../../services/terminal/terminalPathUtils';
import { TERMINAL_FILE_URI_REGEX } from '../../services/terminal/terminalFileLinks';
import type { TerminalSettings } from '../../settings/settings';
import { debugLog, errorLog } from '../../utils/logger';
import { clamp, normalizeBackgroundPosition, normalizeBackgroundSize, toCssUrl } from '../../utils/styleUtils';
import { t } from '../../i18n';
import { RenameTerminalModal } from './renameTerminalModal';
type XtermTerminal = import('@xterm/xterm').Terminal;

export const TERMINAL_VIEW_TYPE = 'terminal-view';

/**
 * Terminal view class
 */
export class TerminalView extends ItemView {
  protected terminalService: TerminalService | null;
  private terminalInstance: TerminalInstance | null = null;
  private terminalContainer: HTMLElement | null = null;
  private dropHintEl: HTMLElement | null = null;
  private dragEnterDepth = 0;
  private removeDropHandlers: (() => void) | null = null;
  private searchContainer: HTMLElement | null = null;
  private searchInput: HTMLInputElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private fileUriLinkAddon: WebLinksAddon | null = null;
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
    // Obsidian may pass a wrapper object, so resolve the real view instance
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
                view.updateDropHintText();
              }
            }
          ).open();
        });
    });
  }

  onOpen(): Promise<void> {
    // Use contentEl instead of containerEl.children[1]
    const container = this.contentEl;
    container.empty();
    container.addClass('terminal-view-container');

    // Create the search bar container
    this.searchContainer = container.createDiv('terminal-search-container');
    this.createSearchUI();

    this.terminalContainer = container.createDiv('terminal-container');
    this.ensureDropHint();
    this.hideDropHint();
    if (!this.removeDropHandlers) {
      this.removeDropHandlers = this.setupDropHandlers();
    }

    setTimeout(() => {
      if (!this.terminalInstance && this.terminalContainer) {
        void this.initializeTerminal();
      }
    }, 0);
    return Promise.resolve();
  }

  /**
   * Create the search UI
   */
  private createSearchUI(): void {
    if (!this.searchContainer) return;

    // Search input
    this.searchInput = document.createElement('input');
    this.searchInput.type = 'text';
    this.searchInput.placeholder = t('terminal.search.placeholder');
    this.searchInput.className = 'terminal-search-input';

    // Search input handler
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

    // Previous button
    const prevBtn = this.createSearchButton('chevron-up', t('terminal.search.previous'), () => {
      this.terminalInstance?.searchPrevious();
    });
    this.searchContainer.appendChild(prevBtn);

    // Next button
    const nextBtn = this.createSearchButton('chevron-down', t('terminal.search.next'), () => {
      this.terminalInstance?.searchNext();
    });
    this.searchContainer.appendChild(nextBtn);

    // Close button
    const closeBtn = this.createSearchButton('x', t('terminal.search.close'), () => {
      this.hideSearch();
    });
    this.searchContainer.appendChild(closeBtn);
  }

  /**
   * Create a search button
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
   * Perform a search
   */
  private performSearch(): void {
    const query = this.searchInput?.value || '';
    this.terminalInstance?.search(query);
  }

  /**
   * Show the search bar
   */
  showSearch(): void {
    if (this.searchContainer) {
      this.searchContainer.addClass('is-visible');
      this.searchInput?.focus();
      this.searchInput?.select();
    }
  }

  /**
   * Hide the search bar
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
    this.fileUriLinkAddon?.dispose();
    this.fileUriLinkAddon = null;
    this.removeDropHandlers?.();
    this.removeDropHandlers = null;
    this.dragEnterDepth = 0;
    this.dropHintEl = null;

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
        this.updateDropHintText();
      });
      const xterm = this.terminalInstance.getXterm();
      this.registerTerminalHyperlinkHandler(xterm);

      // Set the search state callback
      this.terminalInstance.onSearchStateChange((visible) => {
        if (visible) {
          this.showSearch();
        } else {
          this.hideSearch();
        }
      });

      // Set context menu callbacks
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
   * Create a new terminal
   */
  private async createNewTerminal(): Promise<void> {
    // Trigger the plugin's activateTerminalView method
    // Get the plugin instance through the workspace
    const plugin = this.getTerminalPlugin();
    if (plugin) {
      await plugin.activateTerminalView();
    }
  }

  /**
   * Split the terminal (used by commands)
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

  private setupDropHandlers(): () => void {
    const container = this.contentEl;
    const cleanup: Array<() => void> = [];
    const capture = false;
    const dragWindow = container.ownerDocument?.defaultView;

    const addListener = (
      target: EventTarget,
      type: string,
      listener: EventListenerOrEventListenerObject
    ): void => {
      target.addEventListener(type, listener, capture);
      cleanup.push(() => target.removeEventListener(type, listener, capture));
    };

    const claimDragEvent = (event: DragEvent): void => {
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
      }
    };

    const onDragEnter = (event: DragEvent): void => {
      claimDragEvent(event);
      this.dragEnterDepth += 1;
      this.showDropHint();
    };

    const onDragOver = (event: DragEvent): void => {
      claimDragEvent(event);
      this.showDropHint();
    };

    const onDragLeave = (event: DragEvent): void => {
      claimDragEvent(event);
      this.dragEnterDepth = Math.max(0, this.dragEnterDepth - 1);
      const relatedTarget = event.relatedTarget as Node | null;
      const leftContainer = !relatedTarget || !container.contains(relatedTarget);
      if (this.dragEnterDepth === 0 || leftContainer) {
        this.dragEnterDepth = 0;
        this.hideDropHint();
      }
    };

    const onDrop = (event: DragEvent): void => {
      claimDragEvent(event);
      this.resetDropHintState();
      void this.handleDrop(event.dataTransfer);
    };

    const onWindowDragEnd = (): void => {
      this.resetDropHintState();
    };

    addListener(container, 'dragenter', onDragEnter);
    addListener(container, 'dragover', onDragOver);
    addListener(container, 'dragleave', onDragLeave);
    addListener(container, 'drop', onDrop);

    if (dragWindow) {
      addListener(dragWindow, 'dragend', onWindowDragEnd);
    }

    return () => {
      for (const dispose of cleanup.splice(0)) {
        dispose();
      }
    };
  }

  private ensureDropHint(): void {
    if (!this.terminalContainer) return;
    if (this.dropHintEl && this.dropHintEl.isConnected) return;

    const hint = document.createElement('div');
    hint.className = 'terminal-drop-hint';
    const textEl = document.createElement('div');
    textEl.className = 'terminal-drop-hint__text';
    hint.appendChild(textEl);
    this.dropHintEl = hint;
    this.updateDropHintText();
    this.terminalContainer.appendChild(hint);
  }

  private getDropHintText(): string {
    return t('terminal.dropHintPasteFilePath');
  }

  private updateDropHintText(): void {
    if (!this.dropHintEl) return;
    const textEl = this.dropHintEl.querySelector('.terminal-drop-hint__text');
    if (textEl) {
      textEl.textContent = this.getDropHintText();
      return;
    }
    this.dropHintEl.textContent = this.getDropHintText();
  }

  private showDropHint(): void {
    this.ensureDropHint();
    if (!this.dropHintEl?.classList.contains('is-visible')) {
      this.updateDropHintText();
    }
    this.dropHintEl?.classList.add('is-visible');
  }

  private hideDropHint(): void {
    this.dropHintEl?.classList.remove('is-visible');
  }

  private resetDropHintState(): void {
    this.dragEnterDepth = 0;
    this.hideDropHint();
  }

  private async handleDrop(dataTransfer: DataTransfer | null): Promise<void> {
    const input = await this.buildDroppedInput(dataTransfer);
    if (!input) {
      debugLog('[Terminal DnD] No usable file path or text in drop payload');
      errorLog('[Terminal DnD] No usable path details:', this.describeDropPayload(dataTransfer));
      new Notice('Termy: 未获取到可用文本或路径，请确认拖拽来源是否支持文本或文件。');
      return;
    }

    debugLog('[Terminal DnD] Inject input:', input.text);
    await this.writeInputToTerminal(input.text, input.usePaste);
  }

  private async buildDroppedInput(dataTransfer: DataTransfer | null): Promise<{ text: string; usePaste: boolean } | null> {
    if (!dataTransfer) return null;

    const droppedItems = Array.from(dataTransfer.items);
    const nativePaths = this.extractDroppedNativePaths(dataTransfer);
    if (nativePaths.length > 0) {
      return {
        text: this.formatDroppedPaths(nativePaths),
        usePaste: false,
      };
    }

    const primaryTextPayload = collectPreferredDroppedTextPayload(dataTransfer);
    const fallbackTextPayload = await collectFallbackDroppedTextPayload(dataTransfer, droppedItems);
    return resolveDroppedTextInput(
      primaryTextPayload,
      fallbackTextPayload,
      (payload) => this.extractDroppedPathsFromTextPayload(payload),
      (paths) => this.formatDroppedPaths(paths)
    );
  }

  private extractDroppedNativePaths(dataTransfer: DataTransfer | null): string[] {
    if (!dataTransfer) return [];

    const paths: string[] = [];
    const droppedFiles = Array.from(dataTransfer.files);
    const droppedItems = Array.from(dataTransfer.items);

    for (const item of droppedItems) {
      const itemPath = (item as DataTransferItem & { path?: string }).path;
      if (typeof itemPath === 'string' && itemPath.trim().length > 0) {
        paths.push(itemPath.trim());
      }

      const itemFile = item.getAsFile();
      if (itemFile) {
        const droppedPath = this.getDroppedFilePath(itemFile);
        if (droppedPath) {
          paths.push(droppedPath);
        }
      }

      const entryPath = this.getPathFromDroppedEntry(item);
      if (entryPath) {
        paths.push(entryPath);
      }
    }

    for (const file of droppedFiles) {
      const filePath = this.getDroppedFilePath(file);
      if (filePath) {
        paths.push(filePath);
      }
    }

    return this.uniquePaths(paths);
  }

  private extractDroppedPathsFromTextPayload(textPayload = ''): string[] {
    const paths: string[] = [];

    for (const token of this.extractDropTokens(textPayload)) {
      const resolvedPath = this.resolveDroppedTokenToPath(token);
      if (resolvedPath) paths.push(resolvedPath);
    }

    return this.uniquePaths(paths);
  }

  private describeDropPayload(dataTransfer: DataTransfer | null): Record<string, unknown> {
    if (!dataTransfer) {
      return { hasDataTransfer: false };
    }

    const items = Array.from(dataTransfer.items).map((item) => ({
      kind: item.kind,
      type: item.type,
      hasEntry: !!item.webkitGetAsEntry(),
      entryIsDirectory: !!item.webkitGetAsEntry()?.isDirectory,
      path: (item as DataTransferItem & { path?: string }).path ?? null,
    }));

    const files = Array.from(dataTransfer.files).map((file) => ({
      name: file.name,
      size: file.size,
      type: file.type,
      path: this.getDroppedFilePath(file),
    }));

    return {
      hasDataTransfer: true,
      types: Array.from(dataTransfer.types),
      files,
      items,
    };
  }

  private getDroppedFilePath(file: File & { path?: string }): string | null {
    if (typeof file.path === 'string' && file.path.trim().length > 0) {
      return toPlatformPath(file.path);
    }

    try {
      const resolvedPath = webUtils?.getPathForFile?.(file);
      if (typeof resolvedPath === 'string' && resolvedPath.trim().length > 0) {
        return toPlatformPath(resolvedPath);
      }
    } catch (error) {
      debugLog('[Terminal DnD] webUtils.getPathForFile failed:', error);
    }

    return null;
  }

  private getPathFromDroppedEntry(item: DataTransferItem): string | null {
    const entry = item.webkitGetAsEntry();
    if (!entry) return null;

    const entryPath = entry.fullPath ?? '';
    const normalizedEntry = normalizeDroppedEntryReference(entryPath);
    if (normalizedEntry.absolutePath && fs.existsSync(normalizedEntry.absolutePath)) {
      return normalizedEntry.absolutePath;
    }

    const vaultPath = normalizedEntry.vaultPath ?? normalizeVaultPath(entryPath);
    if (vaultPath) {
      const absoluteVaultPath = this.resolveVaultReferenceToAbsolute(vaultPath);
      if (absoluteVaultPath) {
        return absoluteVaultPath;
      }
    }

    if (normalizedEntry.absolutePath) {
      return normalizedEntry.absolutePath;
    }

    return null;
  }

  private extractDropTokens(text: string): string[] {
    if (!text) return [];

    const lineTokens = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));

    const uriTokens = Array.from(text.matchAll(/(?:obsidian|file):\/\/[^\s<>"'`]+/g)).map((match) => match[0]);

    return Array.from(new Set([...lineTokens, ...uriTokens]));
  }

  private resolveDroppedTokenToPath(token: string): string | null {
    const rawToken = normalizeTerminalRawToken(token);
    if (!rawToken) return null;

    const obsidianPath = this.obsidianUriToAbsolutePath(rawToken);
    if (obsidianPath) return obsidianPath;

    const fileUriPath = fileUriToPlatformPath(rawToken);
    if (fileUriPath) return fileUriPath;

    const normalized = normalizeTerminalToken(token);
    if (!normalized) return null;

    const wikiMatch = normalized.match(/^\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]$/);
    if (wikiMatch) {
      return this.resolveVaultReferenceToAbsolute(wikiMatch[1]);
    }

    if (isAbsoluteTerminalPath(normalized)) {
      return toPlatformPath(normalized);
    }

    if (isBasenameOnlyTerminalToken(normalized)) {
      const basenamePath = this.resolveUniqueVaultBasenameToAbsolute(normalized);
      if (basenamePath) {
        return basenamePath;
      }
    }

    return this.resolveVaultReferenceToAbsolute(normalized, true);
  }

  private quoteDroppedPaths(paths: string[]): string {
    return paths.map((path) => `"${path.replace(/"/g, '\\"')}"`).join(' ');
  }

  private formatDroppedPaths(paths: string[]): string {
    if (!this.shouldFormatDroppedPathsAsClaudeCodeReferences()) {
      return this.quoteDroppedPaths(paths);
    }

    return formatClaudeCodePathReferences(paths, {
      cwd: this.terminalInstance?.getCwd(),
      isDirectory: (path) => this.isDroppedDirectoryPath(path),
      pathExists: (path) => fs.existsSync(path),
    });
  }

  private shouldFormatDroppedPathsAsClaudeCodeReferences(): boolean {
    const terminal = this.terminalInstance;
    if (!terminal) {
      return false;
    }

    return terminal.isClaudeCodeSession();
  }

  private isDroppedDirectoryPath(path: string): boolean {
    try {
      return fs.statSync(path).isDirectory();
    } catch {
      return false;
    }
  }

  private isDropEventInsideContainer(event: DragEvent, container: HTMLElement): boolean {
    const target = event.target;
    if (target instanceof Node && container.contains(target)) {
      return true;
    }

    const rect = container.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return false;
    }

    return event.clientX >= rect.left
      && event.clientX <= rect.right
      && event.clientY >= rect.top
      && event.clientY <= rect.bottom;
  }

  private uniquePaths(paths: string[]): string[] {
    const result: string[] = [];
    const seen = new Set<string>();

    for (const rawPath of paths) {
      const normalized = rawPath.trim();
      if (!normalized) continue;
      const key = process.platform === 'win32' ? normalized.toLowerCase() : normalized;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(normalized);
    }

    return result;
  }

  private obsidianUriToAbsolutePath(uri: string): string | null {
    const vaultPath = obsidianUriToVaultPath(uri);
    return vaultPath ? this.resolveVaultPathToAbsolute(vaultPath) : null;
  }

  private resolveVaultPathToAbsolute(pathLike: string): string | null {
    const normalizedPath = normalizeVaultPath(pathLike);
    if (!normalizedPath) return null;

    const activePath = this.app.workspace.getActiveFile()?.path ?? '';
    // Prefer an exact vault entry so folder drops are not shadowed by folder notes.
    const entry = this.app.vault.getAbstractFileByPath(normalizedPath)
      ?? this.app.metadataCache.getFirstLinkpathDest(normalizedPath, activePath);
    if (!entry) return null;

    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      return entry.path;
    }

    return joinTerminalPaths(adapter.getBasePath(), entry.path);
  }

  private resolveVaultReferenceToAbsolute(pathLike: string, allowBasenameFallback = false): string | null {
    return this.resolveVaultPathToAbsolute(pathLike)
      ?? (allowBasenameFallback ? this.resolveUniqueVaultBasenameToAbsolute(pathLike) : null);
  }

  private resolveUniqueVaultBasenameToAbsolute(name: string): string | null {
    const allEntries = this.app.vault.getAllLoadedFiles?.() ?? [];
    const matchedEntry = findUniqueTerminalEntryByBasename(name, allEntries.map((entry) => ({
      name: entry.name,
      path: entry.path,
      kind: entry instanceof TFolder ? 'folder' : 'file' as const,
    })));

    if (!matchedEntry) {
      return null;
    }

    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      return matchedEntry.path;
    }

    return joinTerminalPaths(adapter.getBasePath(), matchedEntry.path);
  }

  private async writeInputToTerminal(text: string, usePaste = false): Promise<void> {
    const terminal = this.terminalInstance ?? await this.waitForTerminalInstance().catch(() => null);
    if (!terminal) return;
    if (usePaste) {
      terminal.pasteText(text);
    } else {
      terminal.sendText(text);
    }
    terminal.focus();
  }

  private registerTerminalHyperlinkHandler(xterm: XtermTerminal): void {
    xterm.options.linkHandler = {
      allowNonHttpProtocols: true,
      activate: (event: MouseEvent, target: string) => {
        event.preventDefault();
        void this.openTerminalHyperlinkTarget(target);
      },
    };

    this.fileUriLinkAddon?.dispose();
    this.fileUriLinkAddon = new WebLinksAddon((event, uri) => {
      event.preventDefault();
      void this.openTerminalHyperlinkTarget(uri);
    }, {
      urlRegex: TERMINAL_FILE_URI_REGEX,
    });
    xterm.loadAddon(this.fileUriLinkAddon);
  }

  private async openTerminalHyperlinkTarget(target: string): Promise<void> {
    const filePath = fileUriToPlatformPath(target);
    if (filePath) {
      await this.openTerminalFileReference(filePath);
      return;
    }

    if (!this.isAllowedExternalHyperlink(target)) {
      new Notice(t('notices.terminal.fileReferenceUnavailable'));
      return;
    }

    try {
      await shell.openExternal(target);
    } catch (error) {
      errorLog('[TerminalView] Failed to open terminal hyperlink:', target, error);
      new Notice(t('notices.terminal.fileReferenceOpenFailed'));
    }
  }

  private isAllowedExternalHyperlink(target: string): boolean {
    try {
      const url = new URL(normalizeTerminalToken(target));
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  private async openTerminalFileReference(pathLike: string): Promise<void> {
    const resolved = this.resolveTerminalFileReference(pathLike);
    if (!resolved) {
      new Notice(t('notices.terminal.fileReferenceUnavailable'));
      return;
    }

    if (resolved.file) {
      await this.openVaultFileReference(resolved.file);
      return;
    }

    const errorMessage = await shell.openPath(resolved.externalPath);
    if (errorMessage) {
      if (fs.existsSync(resolved.externalPath)) {
        const containingDir = path.dirname(resolved.externalPath);
        const directoryError = await shell.openPath(containingDir);
        if (!directoryError) {
          return;
        }
      }

      errorLog('[TerminalView] Failed to open external path:', resolved.externalPath, errorMessage);
      new Notice(t('notices.terminal.fileReferenceOpenFailed'));
    }
  }

  private resolveTerminalFileReference(pathLike: string): { file?: TFile; externalPath: string } | null {
    const normalizedReference = normalizeTerminalReferencePath(pathLike);
    if (!normalizedReference) {
      return null;
    }

    if (isAbsoluteTerminalPath(normalizedReference)) {
      const fileFromAbsolutePath = this.absolutePathToVaultFile(normalizedReference);
      if (fileFromAbsolutePath) {
        return {
          file: fileFromAbsolutePath,
          externalPath: normalizedReference,
        };
      }

      if (!fs.existsSync(normalizedReference)) {
        return null;
      }

      return { externalPath: normalizedReference };
    }

    const vaultFile = this.resolveVaultReference(normalizedReference);
    if (vaultFile) {
      return {
        file: vaultFile,
        externalPath: vaultFile.path,
      };
    }

    for (const absolutePath of this.getTerminalReferenceAbsoluteCandidates(normalizedReference)) {
      const fileFromCandidate = this.absolutePathToVaultFile(absolutePath);
      if (fileFromCandidate) {
        return {
          file: fileFromCandidate,
          externalPath: absolutePath,
        };
      }

      if (fs.existsSync(absolutePath)) {
        return { externalPath: absolutePath };
      }
    }

    return null;
  }

  private resolveVaultReference(pathLike: string): TFile | null {
    const normalizedPath = normalizeVaultPath(pathLike);
    if (!normalizedPath) {
      return null;
    }

    const activePath = this.app.workspace.getActiveFile()?.path ?? '';
    const file = this.app.metadataCache.getFirstLinkpathDest(normalizedPath, activePath)
      ?? this.app.vault.getAbstractFileByPath(normalizedPath);

    return file instanceof TFile ? file : null;
  }

  private absolutePathToVaultFile(absolutePath: string): TFile | null {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      return null;
    }

    const relativePath = getVaultRelativePathFromAbsolute(absolutePath, adapter.getBasePath());
    if (relativePath === null) {
      return null;
    }

    const file = this.app.vault.getAbstractFileByPath(relativePath);
    return file instanceof TFile ? file : null;
  }

  private getTerminalReferenceAbsoluteCandidates(relativePath: string): string[] {
    const adapter = this.app.vault.adapter;
    const vaultBasePath = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : null;
    const currentCwd = this.terminalInstance?.getCwd() ?? null;
    const initialCwd = this.terminalInstance?.getInitialCwd() ?? null;

    return collectTerminalReferenceCandidatePaths(
      relativePath,
      [currentCwd, initialCwd, vaultBasePath],
    );
  }

  private async openVaultFileReference(file: TFile): Promise<void> {
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
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
    const dropHint = this.dropHintEl;
    this.terminalContainer.empty();
    if (bgLayer) this.terminalContainer.appendChild(bgLayer);
    if (dropHint) this.terminalContainer.appendChild(dropHint);

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
   * Refresh theme/background-related appearance
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
   * Get the terminal instance (for external callers)
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
