import type { WorkspaceLeaf, Menu } from 'obsidian';
import { FileSystemAdapter, ItemView, MarkdownView, Notice, TFile, normalizePath, setIcon } from 'obsidian';
import { shell, webUtils } from 'electron';
import type { TerminalService } from '../../services/terminal/terminalService';
import type { TerminalInstance } from '../../services/terminal/terminalInstance';
import type { TerminalSettings } from '../../settings/settings';
import { debugLog, errorLog } from '../../utils/logger';
import { clamp, normalizeBackgroundPosition, normalizeBackgroundSize, toCssUrl } from '../../utils/styleUtils';
import { t } from '../../i18n';
import { RenameTerminalModal } from './renameTerminalModal';
import { parseTerminalOutputFileReferences, type TerminalOutputFileReference } from '../../services/terminal/terminalOutputLinks';

type TerminalDisposable = import('@xterm/xterm').IDisposable;

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
  private dropHandlersBound = false;
  private searchContainer: HTMLElement | null = null;
  private searchInput: HTMLInputElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private fileReferenceLinkDisposable: TerminalDisposable | null = null;
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
    if (!this.dropHandlersBound) {
      this.setupDropHandlers();
      this.dropHandlersBound = true;
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
    this.fileReferenceLinkDisposable?.dispose();
    this.fileReferenceLinkDisposable = null;
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
      this.registerFileReferenceLinks();

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

  private setupDropHandlers(): void {
    const container = this.contentEl;

    const onDragEnter = (event: DragEvent): void => {
      event.preventDefault();
      this.dragEnterDepth += 1;
      this.showDropHint();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
      }
    };

    const onDragOver = (event: DragEvent): void => {
      event.preventDefault();
      this.showDropHint();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
      }
    };

    const onDragLeave = (event: DragEvent): void => {
      event.preventDefault();
      this.dragEnterDepth = Math.max(0, this.dragEnterDepth - 1);
      const relatedTarget = event.relatedTarget as Node | null;
      const leftContainer = !relatedTarget || !container.contains(relatedTarget);
      if (this.dragEnterDepth === 0 || leftContainer) {
        this.dragEnterDepth = 0;
        this.hideDropHint();
      }
    };

    const onDrop = (event: DragEvent): void => {
      event.preventDefault();
      this.dragEnterDepth = 0;
      this.hideDropHint();
      void this.handleDrop(event.dataTransfer);
    };

    container.addEventListener('dragenter', onDragEnter, { capture: true });
    container.addEventListener('dragover', onDragOver, { capture: true });
    container.addEventListener('dragleave', onDragLeave, { capture: true });
    container.addEventListener('drop', onDrop, { capture: true });
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
    this.updateDropHintText();
    this.dropHintEl?.classList.add('is-visible');
  }

  private hideDropHint(): void {
    this.dropHintEl?.classList.remove('is-visible');
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
    const textPayload = await this.collectDroppedTextPayload(dataTransfer, droppedItems);
    const paths = await this.extractDroppedPaths(dataTransfer, textPayload);
    if (paths.length > 0) {
      return {
        text: paths.map((path) => `"${path.replace(/"/g, '\\"')}"`).join(' '),
        usePaste: false,
      };
    }

    const normalizedText = textPayload.trim();
    if (!normalizedText) {
      return null;
    }

    return {
      text: normalizedText,
      usePaste: true,
    };
  }

  private async extractDroppedPaths(dataTransfer: DataTransfer | null, textPayload = ''): Promise<string[]> {
    if (!dataTransfer) return [];

    const paths: string[] = [];
    const droppedFiles = Array.from(dataTransfer.files);
    const droppedItems = Array.from(dataTransfer.items);

    for (const item of droppedItems) {
      const itemPath = (item as DataTransferItem & { path?: string }).path;
      if (typeof itemPath === 'string' && itemPath.trim().length > 0) {
        paths.push(itemPath.trim());
      }

      const itemFile = item.getAsFile() as (File & { path?: string }) | null;
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
      const filePath = this.getDroppedFilePath(file as File & { path?: string });
      if (filePath) {
        paths.push(filePath);
      }
    }

    for (const token of this.extractDropTokens(textPayload)) {
      const resolvedPath = this.resolveDroppedTokenToPath(token);
      if (resolvedPath) paths.push(resolvedPath);
    }

    return this.uniquePaths(paths);
  }

  private async collectDroppedTextPayload(dataTransfer: DataTransfer, droppedItems: DataTransferItem[]): Promise<string> {
    const textPayloadParts = [
      dataTransfer.getData('text/uri-list'),
      dataTransfer.getData('text/plain'),
      dataTransfer.getData('text/html'),
    ];

    for (const type of Array.from(dataTransfer.types)) {
      if (type === 'Files' || type === 'text/uri-list' || type === 'text/plain' || type === 'text/html') {
        continue;
      }
      textPayloadParts.push(dataTransfer.getData(type));
    }

    const stringPayloads = await this.extractStringItemPayloads(droppedItems);
    textPayloadParts.push(...stringPayloads);

    return textPayloadParts.filter((value) => value.length > 0).join('\n');
  }

  private async extractStringItemPayloads(items: DataTransferItem[]): Promise<string[]> {
    const payloads: string[] = [];
    const stringItems = items.filter((item) => item.kind === 'string');

    await Promise.all(stringItems.map((item) => new Promise<void>((resolve) => {
      try {
        item.getAsString((value) => {
          if (value && value.trim().length > 0) {
            payloads.push(value);
          }
          resolve();
        });
      } catch {
        resolve();
      }
    })));

    return payloads;
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
      path: this.getDroppedFilePath(file as File & { path?: string }),
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
      return file.path.trim();
    }

    try {
      const resolvedPath = webUtils?.getPathForFile?.(file);
      if (typeof resolvedPath === 'string' && resolvedPath.trim().length > 0) {
        return resolvedPath.trim();
      }
    } catch (error) {
      debugLog('[Terminal DnD] webUtils.getPathForFile failed:', error);
    }

    return null;
  }

  private getPathFromDroppedEntry(item: DataTransferItem): string | null {
    const entry = item.webkitGetAsEntry();
    if (!entry) return null;

    const fullPath = entry.fullPath?.trim();
    if (!fullPath) return null;

    if (/^[A-Za-z]:[\\/]/.test(fullPath) || fullPath.startsWith('\\\\')) {
      return fullPath.replace(/\//g, '\\');
    }

    if (/^\/[A-Za-z]:[\\/]/.test(fullPath)) {
      return fullPath.slice(1).replace(/\//g, '\\');
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
    const normalized = this.normalizeDroppedToken(token);
    if (!normalized) return null;

    const obsidianPath = this.obsidianUriToAbsolutePath(normalized);
    if (obsidianPath) return obsidianPath;

    const fileUriPath = this.fileUriToPath(normalized);
    if (fileUriPath) return fileUriPath;

    const wikiMatch = normalized.match(/^\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]$/);
    if (wikiMatch) {
      return this.resolveVaultPathToAbsolute(wikiMatch[1]);
    }

    if (this.isAbsolutePath(normalized)) {
      return normalized;
    }

    return this.resolveVaultPathToAbsolute(normalized);
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

  private normalizeDroppedToken(value: string): string {
    let normalized = value.trim().replace(/^<|>$/g, '');
    if ((normalized.startsWith('"') && normalized.endsWith('"')) || (normalized.startsWith('\'') && normalized.endsWith('\''))) {
      normalized = normalized.slice(1, -1);
    }

    try {
      normalized = decodeURIComponent(normalized);
    } catch {
      // ignore decode errors
    }

    return normalized.trim();
  }

  private obsidianUriToAbsolutePath(uri: string): string | null {
    if (!uri.toLowerCase().startsWith('obsidian://')) return null;

    try {
      const url = new URL(uri);
      const file = url.searchParams.get('file') ?? url.searchParams.get('path') ?? url.searchParams.get('linkpath');
      if (!file) return null;
      return this.resolveVaultPathToAbsolute(file);
    } catch {
      return null;
    }
  }

  private fileUriToPath(uri: string): string | null {
    if (!uri.toLowerCase().startsWith('file://')) return null;

    try {
      const url = new URL(uri);
      if (url.protocol !== 'file:') return null;

      let path = decodeURIComponent(url.pathname);

      if (process.platform === 'win32') {
        if (/^\/[A-Za-z]:/.test(path)) {
          path = path.slice(1);
        }
        path = path.replace(/\//g, '\\');
        if (url.host) {
          const normalizedPath = path.startsWith('\\') ? path : `\\${path}`;
          return `\\\\${url.host}${normalizedPath}`;
        }
      } else if (url.host) {
        path = `//${url.host}${path}`;
      }

      return path;
    } catch {
      return null;
    }
  }

  private resolveVaultPathToAbsolute(pathLike: string): string | null {
    const normalizedPath = normalizePath(this.normalizeDroppedToken(pathLike).replace(/^\/+/, ''));
    if (!normalizedPath) return null;

    const activePath = this.app.workspace.getActiveFile()?.path ?? '';
    const file = this.app.metadataCache.getFirstLinkpathDest(normalizedPath, activePath)
      ?? this.app.vault.getAbstractFileByPath(normalizedPath);
    if (!file) return null;

    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      return file.path;
    }

    const basePath = normalizePath(adapter.getBasePath());
    const absolutePath = normalizePath(`${basePath}/${file.path}`);
    return process.platform === 'win32' ? absolutePath.replace(/\//g, '\\') : absolutePath;
  }

  private isAbsolutePath(value: string): boolean {
    const normalized = value.trim();
    if (!normalized) return false;

    if (process.platform === 'win32') {
      return /^[A-Za-z]:[\\/]/.test(normalized) || normalized.startsWith('\\\\');
    }

    return normalized.startsWith('/');
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

  private registerFileReferenceLinks(): void {
    this.fileReferenceLinkDisposable?.dispose();
    this.fileReferenceLinkDisposable = null;

    if (!this.terminalInstance) {
      return;
    }

    const xterm = this.terminalInstance.getXterm();
    this.fileReferenceLinkDisposable = xterm.registerLinkProvider({
      provideLinks: (bufferLineNumber, callback) => {
        const line = xterm.buffer.active.getLine(bufferLineNumber - 1);
        const text = line?.translateToString(true) ?? '';
        const references = parseTerminalOutputFileReferences(text);

        if (references.length === 0) {
          callback(undefined);
          return;
        }

        callback(references.map((reference) => ({
          range: {
            start: { x: reference.startIndex + 1, y: bufferLineNumber },
            end: { x: reference.endIndex, y: bufferLineNumber },
          },
          text: reference.text,
          activate: (_event: MouseEvent) => {
            void this.openTerminalFileReference(reference);
          },
        })));
      },
    });
  }

  private async openTerminalFileReference(reference: TerminalOutputFileReference): Promise<void> {
    const resolved = this.resolveTerminalFileReference(reference.path);
    if (!resolved) {
      new Notice(t('notices.terminal.fileReferenceUnavailable'));
      return;
    }

    if (resolved.file) {
      await this.openVaultFileReference(resolved.file, reference.line, reference.column);
      return;
    }

    const errorMessage = await shell.openPath(resolved.externalPath);
    if (errorMessage) {
      errorLog('[TerminalView] Failed to open external path:', errorMessage);
      new Notice(t('notices.terminal.fileReferenceOpenFailed'));
    }
  }

  private resolveTerminalFileReference(pathLike: string): { file?: TFile; externalPath: string } | null {
    const normalizedReference = this.normalizeAgentReferencePath(pathLike);
    if (!normalizedReference) {
      return null;
    }

    if (this.isAbsolutePath(normalizedReference)) {
      const fileFromAbsolutePath = this.absolutePathToVaultFile(normalizedReference);
      if (fileFromAbsolutePath) {
        return {
          file: fileFromAbsolutePath,
          externalPath: normalizedReference,
        };
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

    const cwd = this.terminalInstance?.getCwd();
    if (!cwd) {
      return null;
    }

    const absolutePath = this.joinPathSegments(cwd, normalizedReference);
    const fileFromCwd = this.absolutePathToVaultFile(absolutePath);
    if (fileFromCwd) {
      return {
        file: fileFromCwd,
        externalPath: absolutePath,
      };
    }

    return { externalPath: absolutePath };
  }

  private normalizeAgentReferencePath(pathLike: string): string {
    const normalized = this.normalizeDroppedToken(pathLike)
      .replace(/^[ab][\\/](?=.+\.[A-Za-z0-9]+$)/, '');

    if (process.platform === 'win32') {
      return normalized.replace(/\//g, '\\');
    }

    return normalized.replace(/\\/g, '/');
  }

  private resolveVaultReference(pathLike: string): TFile | null {
    const normalizedPath = normalizePath(pathLike.replace(/\\/g, '/').replace(/^\/+/, ''));
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

    const normalizedBasePath = normalizePath(adapter.getBasePath());
    const normalizedAbsolutePath = normalizePath(absolutePath.replace(/\\/g, '/'));
    if (!normalizedAbsolutePath.startsWith(normalizedBasePath)) {
      return null;
    }

    const relativePath = normalizedAbsolutePath
      .slice(normalizedBasePath.length)
      .replace(/^\/+/, '');

    const file = this.app.vault.getAbstractFileByPath(relativePath);
    return file instanceof TFile ? file : null;
  }

  private joinPathSegments(basePath: string, relativePath: string): string {
    const joined = normalizePath(`${basePath.replace(/\\/g, '/')}/${relativePath.replace(/\\/g, '/')}`);
    return process.platform === 'win32' ? joined.replace(/\//g, '\\') : joined;
  }

  private async openVaultFileReference(file: TFile, line: number | null, column: number | null): Promise<void> {
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
    this.app.workspace.setActiveLeaf(leaf, { focus: true });

    if (!(leaf.view instanceof MarkdownView) || line === null) {
      return;
    }

    const targetLine = Math.max(0, line - 1);
    const targetColumn = Math.max(0, (column ?? 1) - 1);
    leaf.view.editor.setCursor(targetLine, targetColumn);
    leaf.view.editor.scrollIntoView({
      from: { line: targetLine, ch: targetColumn },
      to: { line: targetLine, ch: targetColumn },
    }, true);
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
