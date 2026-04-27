import { randomUUID } from 'crypto';
import * as fs from 'fs';
import { homedir } from 'os';
import * as path from 'path';
import type { AddressInfo } from 'net';
import { pathToFileURL } from 'url';
import type { App, Editor, EventRef, TFile } from 'obsidian';
import { normalizePath } from 'obsidian';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { buildIdeBridgeTerminalEnv } from '../context/agentContext';
import { debugLog, errorLog } from '@/utils/logger';

const CLAUDE_IDE_DIR = path.join(homedir(), '.claude', 'ide');
const SUPPORTED_MCP_PROTOCOL_VERSIONS = [
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
  '2024-10-07',
] as const;
const EMPTY_OBJECT_SCHEMA = {
  type: 'object',
  properties: {},
} as const;
const SELECTION_POLL_INTERVAL_MS = 250;

type JsonRpcId = string | number | null;

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
};

type SelectionChangedParams = {
  filePath?: string;
  fileUrl?: string;
  text?: string;
  selection:
    | {
        start: { line: number; character: number };
        end: { line: number; character: number };
        isEmpty?: boolean;
      }
    | null;
};

type ActiveEditorContext = {
  editor: Editor | null;
  file: TFile | null;
};

type BridgeToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

type BridgeClientState = {
  initialized: boolean;
};

const IDE_TOOLS = [
  {
    name: 'closeAllDiffTabs',
    description: 'Close all Claude Code diff tabs in the editor. In Termy this is a no-op.',
    inputSchema: EMPTY_OBJECT_SCHEMA,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
  },
  {
    name: 'getWorkspaceFolders',
    description: 'Get all workspace folders currently open in the IDE.',
    inputSchema: EMPTY_OBJECT_SCHEMA,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
  },
  {
    name: 'getCurrentSelection',
    description: 'Get the current text selection in the active editor.',
    inputSchema: EMPTY_OBJECT_SCHEMA,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
  },
  {
    name: 'getLatestSelection',
    description: 'Get the most recent editor selection, even if the terminal currently has focus.',
    inputSchema: EMPTY_OBJECT_SCHEMA,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
  },
  {
    name: 'getDiagnostics',
    description: 'Get editor diagnostics. Obsidian/Termy currently returns an empty diagnostics list.',
    inputSchema: {
      type: 'object',
      properties: {
        uri: {
          type: 'string',
          description: 'Optional file URI to get diagnostics for.',
        },
      },
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
  },
] as const;

function createToolResult(text: string, isError = false): BridgeToolResult {
  return {
    content: [{ type: 'text', text }],
    ...(isError ? { isError: true } : {}),
  };
}

function sameSelection(
  left: SelectionChangedParams | null,
  right: SelectionChangedParams | null,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;

  const leftSelection = left.selection;
  const rightSelection = right.selection;

  return (
    left.filePath === right.filePath &&
    left.text === right.text &&
    left.fileUrl === right.fileUrl &&
    (leftSelection === null) === (rightSelection === null) &&
    (leftSelection === null ||
      rightSelection === null ||
      (leftSelection.start.line === rightSelection.start.line &&
        leftSelection.start.character === rightSelection.start.character &&
        leftSelection.end.line === rightSelection.end.line &&
        leftSelection.end.character === rightSelection.end.character))
  );
}

export class ClaudeCodeIdeBridge {
  private readonly app: App;
  private readonly version: string;
  private readonly authToken: string;
  private readonly clients = new Map<WebSocket, BridgeClientState>();
  private readonly eventRefs: EventRef[] = [];

  private server: WebSocketServer | null = null;
  private port: number | null = null;
  private lockfilePath: string | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private latestSelection: SelectionChangedParams | null = null;
  private started = false;

  constructor(app: App, version: string) {
    this.app = app;
    this.version = version;
    this.authToken = randomUUID();
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    fs.mkdirSync(CLAUDE_IDE_DIR, { recursive: true });

    this.server = new WebSocketServer({ port: 0 });
    this.server.on('connection', (socket, request) => {
      this.handleConnection(socket, request.headers['x-claude-code-ide-authorization']);
    });
    this.server.on('error', (error) => {
      errorLog('[ClaudeCodeIdeBridge] WebSocket server error:', error);
    });

    await new Promise<void>((resolve, reject) => {
      const handleListening = () => resolve();
      const handleError = (error: Error) => reject(error);
      this.server?.once('listening', handleListening);
      this.server?.once('error', handleError);
    });

    const address = this.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Claude Code IDE bridge failed to resolve a listening port');
    }

    this.port = (address as AddressInfo).port;
    this.lockfilePath = path.join(CLAUDE_IDE_DIR, `${this.port}.lock`);
    this.writeLockfile();
    this.latestSelection = this.captureSelection();
    this.startTracking();
    this.started = true;

    debugLog(`[ClaudeCodeIdeBridge] Started on port ${this.port}`);
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

    for (const socket of this.clients.keys()) {
      socket.close(1000, 'Bridge shutting down');
    }
    this.clients.clear();

    await new Promise<void>((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close(() => resolve());
    });
    this.server = null;

    if (this.lockfilePath) {
      try {
        fs.unlinkSync(this.lockfilePath);
      } catch (error) {
        if (!(error instanceof Error) || !(('code' in error) && error.code === 'ENOENT')) {
          errorLog('[ClaudeCodeIdeBridge] Failed to remove lockfile:', error);
        }
      }
      this.lockfilePath = null;
    }

    this.port = null;
    this.latestSelection = null;
    this.started = false;
    debugLog('[ClaudeCodeIdeBridge] Stopped');
  }

  getTerminalEnv(): Record<string, string> {
    return buildIdeBridgeTerminalEnv(this.port);
  }

  private startTracking(): void {
    this.eventRefs.push(
      this.app.workspace.on('active-leaf-change', () => this.refreshSelection()),
      this.app.workspace.on('file-open', () => this.refreshSelection()),
      this.app.workspace.on('layout-change', () => this.refreshSelection()),
      this.app.workspace.on('editor-change', () => this.refreshSelection()),
    );

    this.pollTimer = setInterval(() => this.refreshSelection(), SELECTION_POLL_INTERVAL_MS);
  }

  private refreshSelection(): void {
    const snapshot = this.captureSelection();
    if (!snapshot || sameSelection(snapshot, this.latestSelection)) {
      return;
    }

    this.latestSelection = snapshot;
    this.broadcastNotification('selection_changed', snapshot);
  }

  private captureSelection(): SelectionChangedParams | null {
    const { editor, file } = this.getActiveEditorContext();
    const filePath = this.resolveAbsoluteFilePath(file?.path ?? null);
    if (!filePath) {
      return null;
    }

    const fileUrl = pathToFileURL(filePath).toString();

    if (!editor) {
      return {
        filePath,
        fileUrl,
        text: '',
        selection: null,
      };
    }

    const from = editor.getCursor('from');
    const to = editor.getCursor('to');
    const text = editor.getSelection();

    return {
      filePath,
      fileUrl,
      text,
      selection: {
        start: {
          line: from.line,
          character: from.ch,
        },
        end: {
          line: to.line,
          character: to.ch,
        },
        isEmpty: from.line === to.line && from.ch === to.ch,
      },
    };
  }

  private getActiveEditorContext(): ActiveEditorContext {
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

  private resolveAbsoluteFilePath(filePath: string | null): string | null {
    if (!filePath) {
      return null;
    }

    const vaultPath = this.getVaultPath();
    if (!vaultPath) {
      return null;
    }

    return path.resolve(vaultPath, filePath);
  }

  private getVaultPath(): string | null {
    const adapter = this.app.vault.adapter;
    if ('getBasePath' in adapter && typeof adapter.getBasePath === 'function') {
      return normalizePath(adapter.getBasePath());
    }

    return null;
  }

  private writeLockfile(): void {
    if (!this.port) {
      throw new Error('Cannot write Claude Code IDE bridge lockfile without a port');
    }

    const workspaceFolders: string[] = [];
    const vaultPath = this.getVaultPath();
    if (vaultPath) {
      workspaceFolders.push(vaultPath);
    }

    const lockfile = {
      pid: process.pid,
      workspaceFolders,
      ideName: 'Termy (Obsidian)',
      transport: 'ws',
      runningInWindows: process.platform === 'win32',
      authToken: this.authToken,
    };

    fs.writeFileSync(this.lockfilePath!, JSON.stringify(lockfile), 'utf8');
  }

  private handleConnection(socket: WebSocket, authHeader: string | string[] | undefined): void {
    const token = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    if (token !== this.authToken) {
      socket.close(1008, 'Unauthorized');
      return;
    }

    this.clients.set(socket, { initialized: false });

    socket.on('message', (data) => this.handleMessage(socket, data));
    socket.on('close', () => {
      this.clients.delete(socket);
    });
    socket.on('error', (error) => {
      errorLog('[ClaudeCodeIdeBridge] Client socket error:', error);
    });
  }

  private handleMessage(socket: WebSocket, data: RawData): void {
    let request: JsonRpcRequest;
    try {
      const raw = this.decodeRawMessage(data);
      request = JSON.parse(raw) as JsonRpcRequest;
    } catch (error) {
      errorLog('[ClaudeCodeIdeBridge] Failed to parse JSON-RPC request:', error);
      this.sendError(socket, null, -32700, 'Parse error');
      return;
    }

    if (request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
      this.sendError(socket, request.id ?? null, -32600, 'Invalid request');
      return;
    }

    const params = this.isRecord(request.params) ? request.params : {};

    switch (request.method) {
      case 'initialize':
        this.handleInitialize(socket, request.id ?? null, params);
        return;
      case 'notifications/initialized': {
        const state = this.clients.get(socket);
        if (state) {
          state.initialized = true;
        }
        this.sendLatestSelection(socket);
        return;
      }
      case 'ide_connected':
        this.sendLatestSelection(socket);
        return;
      case 'ping':
        this.sendResult(socket, request.id ?? null, {});
        return;
      case 'tools/list':
        this.sendResult(socket, request.id ?? null, { tools: IDE_TOOLS });
        return;
      case 'tools/call':
        this.handleToolCall(socket, request.id ?? null, params);
        return;
      case 'notifications/cancelled':
        return;
      default:
        if (request.id !== undefined) {
          this.sendError(socket, request.id ?? null, -32601, `Method not found: ${request.method}`);
        }
    }
  }

  private decodeRawMessage(data: RawData): string {
    if (typeof data === 'string') {
      return data;
    }

    if (Buffer.isBuffer(data)) {
      return data.toString('utf8');
    }

    if (Array.isArray(data)) {
      return Buffer.concat(data).toString('utf8');
    }

    return Buffer.from(data).toString('utf8');
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private handleInitialize(
    socket: WebSocket,
    id: JsonRpcId,
    params: Record<string, unknown>,
  ): void {
    const requestedVersion = typeof params.protocolVersion === 'string'
      ? params.protocolVersion
      : undefined;
    const protocolVersion = requestedVersion && SUPPORTED_MCP_PROTOCOL_VERSIONS.includes(
      requestedVersion as (typeof SUPPORTED_MCP_PROTOCOL_VERSIONS)[number],
    )
      ? requestedVersion
      : '2024-11-05';

    this.sendResult(socket, id, {
      protocolVersion,
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: 'termy/obsidian-ide',
        version: this.version,
      },
      instructions:
        'This Termy bridge exposes the active Obsidian file and selection to compatible agent CLIs.',
    });
  }

  private handleToolCall(
    socket: WebSocket,
    id: JsonRpcId,
    params: Record<string, unknown>,
  ): void {
    const name = typeof params.name === 'string' ? params.name : '';
    const args =
      params.arguments && typeof params.arguments === 'object'
        ? (params.arguments as Record<string, unknown>)
        : {};

    switch (name) {
      case 'closeAllDiffTabs':
        this.sendResult(socket, id, createToolResult('CLOSED_0_DIFF_TABS'));
        return;
      case 'getWorkspaceFolders':
        this.sendResult(socket, id, createToolResult(this.getWorkspaceFoldersJson()));
        return;
      case 'getCurrentSelection':
      case 'getLatestSelection':
        this.sendResult(socket, id, createToolResult(this.getSelectionJson()));
        return;
      case 'getDiagnostics':
        this.sendResult(socket, id, createToolResult(this.getDiagnosticsJson(args)));
        return;
      default:
        this.sendResult(
          socket,
          id,
          createToolResult(`Tool not found: ${name}`, true),
        );
    }
  }

  private getWorkspaceFoldersJson(): string {
    const vaultPath = this.getVaultPath();
    const folders = vaultPath
      ? [
          {
            name: path.basename(vaultPath),
            uri: pathToFileURL(vaultPath).toString(),
            path: vaultPath,
            index: 0,
          },
        ]
      : [];

    return JSON.stringify(
      {
        success: true,
        folders,
        rootPath: vaultPath,
        workspaceFile: null,
      },
      null,
      2,
    );
  }

  private getSelectionJson(): string {
    const selection = this.latestSelection ?? this.captureSelection();
    if (!selection?.filePath) {
      return JSON.stringify(
        {
          success: false,
          message: 'No active editor found',
        },
        null,
        2,
      );
    }

    return JSON.stringify(
      {
        success: true,
        text: selection.text ?? '',
        filePath: selection.filePath,
        fileUrl: selection.fileUrl,
        selection: selection.selection,
      },
      null,
      2,
    );
  }

  private getDiagnosticsJson(args: Record<string, unknown>): string {
    const requestedUri = typeof args.uri === 'string' ? args.uri : null;
    if (!requestedUri) {
      return JSON.stringify([], null, 2);
    }

    return JSON.stringify([], null, 2);
  }

  private sendLatestSelection(socket: WebSocket): void {
    const selection = this.latestSelection ?? this.captureSelection();
    if (!selection) {
      return;
    }

    this.sendNotification(socket, 'selection_changed', selection);
  }

  private broadcastNotification(method: string, params: Record<string, unknown>): void {
    for (const [socket, state] of this.clients.entries()) {
      if (!state.initialized) {
        continue;
      }
      this.sendNotification(socket, method, params);
    }
  }

  private sendNotification(
    socket: WebSocket,
    method: string,
    params: Record<string, unknown>,
  ): void {
    this.sendRaw(socket, {
      jsonrpc: '2.0',
      method,
      params,
    });
  }

  private sendResult(socket: WebSocket, id: JsonRpcId, result: Record<string, unknown>): void {
    this.sendRaw(socket, {
      jsonrpc: '2.0',
      id,
      result,
    });
  }

  private sendError(socket: WebSocket, id: JsonRpcId, code: number, message: string): void {
    this.sendRaw(socket, {
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message,
      },
    });
  }

  private sendRaw(socket: WebSocket, payload: Record<string, unknown>): void {
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }

    socket.send(JSON.stringify(payload), (error) => {
      if (error) {
        errorLog('[ClaudeCodeIdeBridge] Failed to send JSON-RPC payload:', error);
      }
    });
  }
}
