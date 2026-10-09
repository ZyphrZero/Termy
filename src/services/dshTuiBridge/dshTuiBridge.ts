/**
 * dsh-TUI IDE selection bridge.
 *
 * This is intentionally separate from the Claude/OpenCode MCP bridge. dsh-TUI
 * speaks its own protocol-v2 handshake, lock-file contract, and notification
 * envelope, so sharing the existing server would make clients authenticate
 * against the wrong protocol surface.
 */

import type { App, Editor, EventRef, TFile } from 'obsidian';
import { FileSystemAdapter, MarkdownView } from 'obsidian';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { debugLog, errorLog } from '@/utils/logger';
import { getHomeDir } from '@/utils/platform';
import { getVaultBasePath } from '@/utils/pluginPath';
import {
  buildDshTuiBridgeTerminalEnv,
  buildDshTuiHelloAck,
  buildDshTuiSelectionChanged,
  parseDshTuiHello,
  sameDshTuiSelection,
  type DshTuiSelectionSnapshot,
} from './dshTuiBridgeProtocol';

type FsModule = typeof import('fs');
type PathModule = typeof import('path');

const DSH_TUI_IDE_DIR_NAME = 'ide';
const DSH_TUI_DATA_DIR_NAME = '.dsh-tui';
const DSH_TUI_BRIDGE_HOST = '127.0.0.1';
const SELECTION_POLL_INTERVAL_MS = 250;
const HANDSHAKE_TIMEOUT_MS = 10_000;
const MAX_PUSHED_SELECTION_CHARS = 200_000;

type ActiveEditorContext = {
  editor: Editor | null;
  file: TFile | null;
};

export class DshTuiBridge {
  private readonly app: App;
  private readonly authToken: string;
  private readonly fs: FsModule;
  private readonly path: PathModule;
  private readonly dataDir: string;
  private readonly clients = new Set<WebSocket>();
  private readonly pendingClients = new Set<WebSocket>();
  private readonly eventRefs: EventRef[] = [];

  private server: WebSocketServer | null = null;
  private port: number | null = null;
  private lockfilePath: string | null = null;
  private pollTimer: number | null = null;
  private latestSelection: DshTuiSelectionSnapshot | null = null;
  private started = false;
  private startPromise: Promise<void> | null = null;

  constructor(app: App, dataDir?: string) {
    this.app = app;
    this.fs = window.require('fs') as FsModule;
    this.path = window.require('path') as PathModule;
    this.authToken = (window.require('crypto') as typeof import('crypto')).randomUUID();
    this.dataDir = dataDir ?? this.resolveDataDir();
  }

  async start(): Promise<void> {
    if (this.started) return;
    if (this.startPromise) return this.startPromise;

    const promise = this.startInternal();
    this.startPromise = promise;
    try {
      await promise;
    } finally {
      if (this.startPromise === promise) this.startPromise = null;
    }
  }

  private async startInternal(): Promise<void> {

    this.server = new WebSocketServer({
      host: DSH_TUI_BRIDGE_HOST,
      port: 0,
    });
    this.server.on('connection', (socket) => this.handleConnection(socket));
    this.server.on('error', (error) => {
      errorLog('[DshTuiBridge] WebSocket server error:', error);
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const handleListening = () => resolve();
        const handleError = (error: Error) => reject(error);
        this.server?.once('listening', handleListening);
        this.server?.once('error', handleError);
      });

      const address = this.server.address();
      if (!address || typeof address === 'string') {
        throw new Error('dsh-TUI bridge failed to resolve a listening port');
      }

      this.port = address.port;
      this.lockfilePath = this.writeLockfile();
      this.latestSelection = this.captureSelection();
      this.startTracking();
      this.started = true;
      this.app.workspace.onLayoutReady(() => this.refreshSelection());
      debugLog(`[DshTuiBridge] Started on port ${this.port}`);
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.started && !this.server) return;

    if (this.pollTimer !== null) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    for (const eventRef of this.eventRefs) {
      this.app.workspace.offref(eventRef);
    }
    this.eventRefs.length = 0;

    for (const socket of this.clients) {
      try {
        socket.close(1000, 'Bridge shutting down');
      } catch (error) {
        errorLog('[DshTuiBridge] Failed to close client socket:', error);
      }
    }
    for (const socket of this.pendingClients) {
      try {
        socket.terminate();
      } catch (error) {
        errorLog('[DshTuiBridge] Failed to terminate pending client socket:', error);
      }
    }
    this.clients.clear();
    this.pendingClients.clear();

    const server = this.server;
    this.server = null;
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    this.removeLockfile();
    this.port = null;
    this.latestSelection = null;
    this.started = false;
    debugLog('[DshTuiBridge] Stopped');
  }

  getTerminalEnv(): Record<string, string> {
    return buildDshTuiBridgeTerminalEnv(this.port, this.authToken);
  }

  getPort(): number | null {
    return this.port;
  }

  getLockfilePath(): string | null {
    return this.lockfilePath;
  }

  private resolveDataDir(): string {
    return this.path.join(getHomeDir(), DSH_TUI_DATA_DIR_NAME);
  }

  private handleConnection(socket: WebSocket): void {
    this.pendingClients.add(socket);
    let authenticated = false;
    const deadline = window.setTimeout(() => {
      if (!authenticated) socket.terminate();
    }, HANDSHAKE_TIMEOUT_MS);

    socket.on('close', () => {
      window.clearTimeout(deadline);
      this.pendingClients.delete(socket);
      this.clients.delete(socket);
    });
    socket.on('error', (error) => {
      window.clearTimeout(deadline);
      this.pendingClients.delete(socket);
      this.clients.delete(socket);
      errorLog('[DshTuiBridge] Client socket error:', error);
    });
    socket.on('message', (data) => {
      if (authenticated) return;
      const hello = this.parseHello(data);
      if (!hello || hello.token !== this.authToken) {
        socket.close(1008, 'Unauthorized');
        return;
      }

      authenticated = true;
      window.clearTimeout(deadline);
      this.pendingClients.delete(socket);
      this.clients.add(socket);
      try {
        socket.send(buildDshTuiHelloAck(this.getWorkspaceFolders()));
        if (this.latestSelection) {
          socket.send(buildDshTuiSelectionChanged(this.latestSelection));
        }
      } catch (error) {
        errorLog('[DshTuiBridge] Failed to send hello acknowledgement:', error);
        this.clients.delete(socket);
        socket.terminate();
      }
    });
  }

  private parseHello(data: RawData): { token: string; protocolVersion: number } | undefined {
    try {
      const raw = typeof data === 'string'
        ? data
        : Array.isArray(data)
          ? Buffer.concat(data).toString('utf8')
          : Buffer.from(data as Uint8Array).toString('utf8');
      return parseDshTuiHello(JSON.parse(raw));
    } catch {
      return undefined;
    }
  }

  private startTracking(): void {
    this.eventRefs.push(
      this.app.workspace.on('active-leaf-change', () => this.refreshSelection()),
      this.app.workspace.on('file-open', () => this.refreshSelection()),
      this.app.workspace.on('layout-change', () => this.refreshSelection()),
      this.app.workspace.on('editor-change', () => this.refreshSelection()),
    );
    this.pollTimer = window.setInterval(() => this.refreshSelection(), SELECTION_POLL_INTERVAL_MS);
  }

  private refreshSelection(): void {
    const snapshot = this.captureSelection();
    if (!snapshot || sameDshTuiSelection(snapshot, this.latestSelection)) return;
    this.latestSelection = snapshot;
    const frame = buildDshTuiSelectionChanged(snapshot);
    for (const socket of this.clients) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      try {
        socket.send(frame);
      } catch (error) {
        errorLog('[DshTuiBridge] Failed to broadcast selection:', error);
      }
    }
  }

  private captureSelection(): DshTuiSelectionSnapshot | null {
    const vaultPath = this.getVaultPath();
    if (!vaultPath) return null;

    const { editor, file } = this.getActiveEditorContext();
    const filePath = file?.path
      ? this.path.resolve(vaultPath, file.path)
      : vaultPath;
    const path = this.path.normalize(filePath).replace(/\\/g, '/');
    if (!editor) {
      return { path, startLine: 0, endLine: 0, isEmpty: true, text: '' };
    }

    const from = editor.getCursor('from');
    const to = editor.getCursor('to');
    const endLine = to.ch === 0 && to.line > from.line ? to.line - 1 : to.line;
    return {
      path,
      startLine: from.line,
      endLine,
      isEmpty: from.line === to.line && from.ch === to.ch,
      text: editor.getSelection().slice(0, MAX_PUSHED_SELECTION_CHARS),
    };
  }

  private getActiveEditorContext(): ActiveEditorContext {
    const workspace = this.app.workspace as typeof this.app.workspace & {
      activeEditor?: { editor?: Editor; file?: TFile | null };
    };
    const activeMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    return {
      editor: workspace.activeEditor?.editor ?? activeMarkdownView?.editor ?? null,
      file: workspace.activeEditor?.file ?? activeMarkdownView?.file ?? this.app.workspace.getActiveFile(),
    };
  }

  private getVaultPath(): string | null {
    const adapter = this.app.vault.adapter;
    return adapter instanceof FileSystemAdapter ? getVaultBasePath(adapter) : null;
  }

  private getWorkspaceFolders(): string[] {
    const vaultPath = this.getVaultPath();
    return vaultPath ? [vaultPath] : [];
  }

  private writeLockfile(): string {
    if (this.port === null) {
      throw new Error('Cannot write dsh-TUI bridge lockfile without a port');
    }

    const lockDir = this.path.join(this.dataDir, DSH_TUI_IDE_DIR_NAME);
    this.fs.mkdirSync(lockDir, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') {
      try {
        this.fs.chmodSync(lockDir, 0o700);
      } catch (error) {
        errorLog('[DshTuiBridge] Failed to restrict lock directory permissions:', error);
      }
    }

    const lockfilePath = this.path.join(lockDir, `${this.port}.lock`);
    const tempPath = `${lockfilePath}.tmp`;
    this.fs.writeFileSync(tempPath, JSON.stringify({
      port: this.port,
      token: this.authToken,
      workspaceFolders: this.getWorkspaceFolders(),
      pid: process.pid,
    }), { encoding: 'utf8', mode: 0o600 });
    this.fs.renameSync(tempPath, lockfilePath);
    return lockfilePath;
  }

  private removeLockfile(): void {
    const lockfilePath = this.lockfilePath;
    this.lockfilePath = null;
    if (!lockfilePath) return;
    try {
      this.fs.unlinkSync(lockfilePath);
    } catch (error) {
      const errorRecord = error as { code?: unknown };
      const code = typeof errorRecord.code === 'string' ? errorRecord.code : '';
      if (code !== 'ENOENT') {
        errorLog('[DshTuiBridge] Failed to remove lockfile:', error);
      }
    }
  }
}

export { DSH_TUI_IDE_PROTOCOL_VERSION } from './dshTuiBridgeProtocol';
