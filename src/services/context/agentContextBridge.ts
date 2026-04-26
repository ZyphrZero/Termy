import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import type { App, Editor, EventRef, MarkdownView, TFile, WorkspaceLeaf } from 'obsidian';
import { normalizePath } from 'obsidian';
import {
  buildAgentContextTerminalEnv,
  renderTermyCodexSkill,
  TERMY_CODEX_SKILL_MANAGED_MARKER,
  TERMY_CODEX_SKILL_RELATIVE_PATH,
} from './agentContext';
import { debugLog, errorLog } from '@/utils/logger';

const CONTEXT_DIR_NAME = 'agent-context';
const CONTEXT_FILE_NAME = 'obsidian-context.json';
const POLL_INTERVAL_MS = 250;

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

type AgentContextSnapshot = {
  schemaVersion: 1;
  source: 'termy';
  updatedAt: string;
  vaultRoot: string | null;
  workspaceFolders: string[];
  activeFile: (FileContext & { hasFocus: boolean }) | null;
  openFiles: OpenFileContext[];
  selection: SelectionContext | null;
};

export class AgentContextBridge {
  private readonly app: App;
  private readonly eventRefs: EventRef[] = [];
  private readonly contextDir: string;
  private readonly contextFilePath: string;

  private lastSerializedSnapshot = '';
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;

  constructor(app: App, pluginDir: string) {
    this.app = app;
    this.contextDir = path.join(pluginDir, CONTEXT_DIR_NAME);
    this.contextFilePath = path.join(this.contextDir, CONTEXT_FILE_NAME);
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    fs.mkdirSync(this.contextDir, { recursive: true });
    this.syncCodexSkill();
    this.refreshSnapshot(true);

    this.eventRefs.push(
      this.app.workspace.on('active-leaf-change', () => this.refreshSnapshot()),
      this.app.workspace.on('file-open', () => this.refreshSnapshot()),
      this.app.workspace.on('layout-change', () => this.refreshSnapshot()),
      this.app.workspace.on('editor-change', () => this.refreshSnapshot()),
    );

    this.pollTimer = setInterval(() => this.refreshSnapshot(), POLL_INTERVAL_MS);
    this.started = true;

    debugLog(`[AgentContextBridge] Writing context snapshots to ${this.contextFilePath}`);
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
    return buildAgentContextTerminalEnv(this.contextFilePath);
  }

  getContextFilePath(): string {
    return this.contextFilePath;
  }

  private refreshSnapshot(force = false): void {
    try {
      const snapshot = this.captureSnapshot();
      const serialized = JSON.stringify(snapshot, null, 2);
      if (!force && serialized === this.lastSerializedSnapshot) {
        return;
      }

      fs.writeFileSync(this.contextFilePath, serialized, 'utf8');
      this.lastSerializedSnapshot = serialized;
    } catch (error) {
      errorLog('[AgentContextBridge] Failed to refresh agent context snapshot:', error);
    }
  }

  private syncCodexSkill(): void {
    try {
      const vaultRoot = this.getVaultRoot();
      if (!vaultRoot) {
        return;
      }

      const skillFilePath = path.join(vaultRoot, TERMY_CODEX_SKILL_RELATIVE_PATH);
      const skillContent = renderTermyCodexSkill();

      if (fs.existsSync(skillFilePath)) {
        const currentContent = fs.readFileSync(skillFilePath, 'utf8');
        if (currentContent === skillContent) {
          return;
        }
        if (!currentContent.includes(TERMY_CODEX_SKILL_MANAGED_MARKER)) {
          debugLog(`[AgentContextBridge] Existing unmanaged Codex skill found at ${skillFilePath}; leaving it unchanged`);
          return;
        }
      }

      fs.mkdirSync(path.dirname(skillFilePath), { recursive: true });
      fs.writeFileSync(skillFilePath, skillContent, 'utf8');
      debugLog(`[AgentContextBridge] Wrote Codex context skill to ${skillFilePath}`);
    } catch (error) {
      errorLog('[AgentContextBridge] Failed to sync Codex context skill:', error);
    }
  }

  private captureSnapshot(): AgentContextSnapshot {
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
