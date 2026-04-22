import * as fs from 'fs';
import { homedir } from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import type { App, Editor, EventRef, MarkdownView, TFile, WorkspaceLeaf } from 'obsidian';
import { normalizePath } from 'obsidian';
import { debugLog, errorLog } from '@/utils/logger';

const CODEX_DIR = path.join(homedir(), '.codex');
const CONTEXT_FILE_NAME = 'ide-context.json';
const CONTEXT_PROMPT_FILE_NAME = 'ide-context-prompt.md';
const POLL_INTERVAL_MS = 250;

export const CODEX_IDE_CONTEXT_PATH_ENV = 'CODEX_IDE_CONTEXT_PATH';
export const CODEX_IDE_CONTEXT_PROMPT_PATH_ENV = 'CODEX_IDE_CONTEXT_PROMPT_PATH';

type EditorContext = {
  editor: Editor | null;
  file: TFile | null;
};

type FileContext = {
  filePath: string;
  vaultPath: string;
  fileUrl: string;
};

type SelectionContext = {
  text: string;
  isEmpty: boolean;
  from: {
    line: number;
    ch: number;
    offset: number;
  };
  to: {
    line: number;
    ch: number;
    offset: number;
  };
};

type OpenFileContext = FileContext & {
  isActive: boolean;
};

type CodexIdeContextSnapshot = {
  schemaVersion: 1;
  source: 'termy';
  updatedAt: string;
  vaultRoot: string | null;
  workspaceFolders: string[];
  activeFile: (FileContext & { hasFocus: boolean }) | null;
  openFiles: OpenFileContext[];
  selection: SelectionContext | null;
};

export class CodexCliContextBridge {
  private readonly app: App;
  private readonly eventRefs: EventRef[] = [];
  private readonly contextFilePath: string;
  private readonly contextPromptFilePath: string;

  private lastSerializedSnapshot = '';
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;

  constructor(app: App) {
    this.app = app;
    this.contextFilePath = path.join(CODEX_DIR, CONTEXT_FILE_NAME);
    this.contextPromptFilePath = path.join(CODEX_DIR, CONTEXT_PROMPT_FILE_NAME);
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    fs.mkdirSync(CODEX_DIR, { recursive: true });
    this.refreshSnapshot(true);

    this.eventRefs.push(
      this.app.workspace.on('active-leaf-change', () => this.refreshSnapshot()),
      this.app.workspace.on('file-open', () => this.refreshSnapshot()),
      this.app.workspace.on('layout-change', () => this.refreshSnapshot()),
      this.app.workspace.on('editor-change', () => this.refreshSnapshot()),
    );

    this.pollTimer = setInterval(() => this.refreshSnapshot(), POLL_INTERVAL_MS);
    this.started = true;

    debugLog(`[CodexCliContextBridge] Writing context snapshots to ${this.contextFilePath}`);
  }

  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    for (const eventRef of this.eventRefs) {
      this.app.workspace.offref(eventRef);
    }
    this.eventRefs.length = 0;

    this.started = false;
  }

  getTerminalEnv(): Record<string, string> {
    return {
      [CODEX_IDE_CONTEXT_PATH_ENV]: this.contextFilePath,
      [CODEX_IDE_CONTEXT_PROMPT_PATH_ENV]: this.contextPromptFilePath,
    };
  }

  getContextFilePath(): string {
    return this.contextFilePath;
  }

  getContextPromptFilePath(): string {
    return this.contextPromptFilePath;
  }

  private refreshSnapshot(force = false): void {
    try {
      const snapshot = this.captureSnapshot();
      const serialized = JSON.stringify(snapshot, null, 2);
      if (!force && serialized === this.lastSerializedSnapshot) {
        return;
      }

      fs.writeFileSync(this.contextFilePath, serialized, 'utf8');
      fs.writeFileSync(this.contextPromptFilePath, this.renderPrompt(snapshot), 'utf8');
      this.lastSerializedSnapshot = serialized;
    } catch (error) {
      errorLog('[CodexCliContextBridge] Failed to refresh Codex CLI context snapshot:', error);
    }
  }

  private captureSnapshot(): CodexIdeContextSnapshot {
    const { editor, file } = this.getActiveEditorContext();
    const vaultRoot = this.getVaultRoot();
    const activeFile = this.resolveFileContext(file?.path ?? null);
    const openFiles = this.getOpenFiles();

    let selection: SelectionContext | null = null;
    if (editor) {
      const from = editor.getCursor('from');
      const to = editor.getCursor('to');
      const text = editor.getSelection();

      selection = {
        text,
        isEmpty: from.line === to.line && from.ch === to.ch,
        from: {
          line: from.line,
          ch: from.ch,
          offset: editor.posToOffset(from),
        },
        to: {
          line: to.line,
          ch: to.ch,
          offset: editor.posToOffset(to),
        },
      };
    }

    return {
      schemaVersion: 1,
      source: 'termy',
      updatedAt: new Date().toISOString(),
      vaultRoot,
      workspaceFolders: vaultRoot ? [vaultRoot] : [],
      activeFile:
        activeFile && editor
          ? {
              ...activeFile,
              hasFocus: editor.hasFocus(),
            }
          : activeFile
            ? {
                ...activeFile,
                hasFocus: false,
              }
            : null,
      openFiles,
      selection,
    };
  }

  private renderPrompt(snapshot: CodexIdeContextSnapshot): string {
    return [
      'Use this Obsidian editor context as the starting IDE reference for the current Codex CLI session.',
      'This snapshot may become stale after launch; read the JSON file again if you need the latest state.',
      '',
      '<obsidian_context>',
      JSON.stringify(snapshot, null, 2),
      '</obsidian_context>',
    ].join('\n');
  }

  private getActiveEditorContext(): EditorContext {
    const workspace = this.app.workspace as typeof this.app.workspace & {
      activeEditor?: {
        editor?: Editor;
        file?: TFile | null;
      };
    };

    return {
      editor: workspace.activeEditor?.editor ?? null,
      file: workspace.activeEditor?.file ?? this.app.workspace.getActiveFile(),
    };
  }

  private getOpenFiles(): OpenFileContext[] {
    const activeFilePath = this.resolveFileContext(this.app.workspace.getActiveFile()?.path ?? null)?.filePath ?? null;
    const seen = new Map<string, OpenFileContext>();

    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      const file = this.getLeafFile(leaf);
      const fileContext = this.resolveFileContext(file?.path ?? null);
      if (!fileContext) {
        continue;
      }

      const key = process.platform === 'win32'
        ? fileContext.filePath.toLowerCase()
        : fileContext.filePath;

      if (!seen.has(key)) {
        seen.set(key, {
          ...fileContext,
          isActive: activeFilePath === fileContext.filePath,
        });
      }
    }

    return Array.from(seen.values());
  }

  private getLeafFile(leaf: WorkspaceLeaf): TFile | null {
    const view = leaf.view as MarkdownView & { file?: TFile | null };
    return view.file ?? null;
  }

  private resolveFileContext(vaultPath: string | null): FileContext | null {
    if (!vaultPath) {
      return null;
    }

    const vaultRoot = this.getVaultRoot();
    if (!vaultRoot) {
      return null;
    }

    const filePath = path.resolve(vaultRoot, vaultPath);
    return {
      filePath,
      vaultPath,
      fileUrl: pathToFileURL(filePath).toString(),
    };
  }

  private getVaultRoot(): string | null {
    const adapter = this.app.vault.adapter as { getBasePath?: () => string };
    if (adapter && typeof adapter.getBasePath === 'function') {
      return normalizePath(adapter.getBasePath());
    }

    return null;
  }
}
