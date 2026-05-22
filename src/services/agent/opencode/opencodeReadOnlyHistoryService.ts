/**
 * Read-only history service for OpenCode sessions.
 *
 * After the ACP migration this service no longer holds a long-lived
 * daemon connection. Instead it uses a short-lived daemon wrapper:
 *   spawn → wait for ready → call listSessions/getMessages → stop.
 *
 * Results are cached with a 60-second TTL to avoid repeated spawns
 * when the user switches tabs quickly (Req 4 AC 6).
 *
 * This file implements the unified {@link ReadOnlyHistoryService}
 * interface and does NOT write to disk (Property 4.3).
 */

import {
  type OpenCodeMessageWithParts,
  OpenCodeHttpClient,
  type OpenCodeSessionInfo,
  type OpenCodeServerHandle,
} from './opencodeHttpClient.ts';
import { debugLog, errorLog } from '@/utils/logger';

export type OpenCodeHistorySession = OpenCodeSessionInfo;

export interface OpenCodeReadOnlyHistoryServiceOptions {
  /** Vault root, used as the OpenCode workspace directory. */
  vaultRoot: string;
  /** Optional override; defaults to `'opencode'` (resolved on PATH). */
  command?: string;
}

/** TTL for cached results in milliseconds. */
const CACHE_TTL_MS = 60_000;

/** Timeout for daemon startup in milliseconds. */
const STARTUP_TIMEOUT_MS = 15_000;

/**
 * Pattern that matches the line OpenCode prints right after the HTTP
 * server starts listening:
 *   `opencode server listening on http://127.0.0.1:54321`
 */
const LISTEN_PATTERN = /listening on https?:\/\/([^:\s]+):(\d+)/i;

type ChildProcessModule = typeof import('child_process');
type CryptoModule = typeof import('crypto');

interface CacheEntry<T> {
  readonly data: T;
  readonly expiresAt: number;
}

export class OpenCodeReadOnlyHistoryService {
  private readonly directory: string;
  private readonly command: string;

  private sessionsCache: CacheEntry<OpenCodeHistorySession[]> | null = null;
  private transcriptCache = new Map<string, CacheEntry<OpenCodeMessageWithParts[]>>();
  private stopped = false;

  constructor(options: OpenCodeReadOnlyHistoryServiceOptions) {
    this.directory = options.vaultRoot;
    this.command = options.command ?? 'opencode';
  }

  async listSessions(): Promise<OpenCodeHistorySession[]> {
    if (this.stopped) {
      throw new Error('OpenCodeReadOnlyHistoryService is stopped');
    }
    const now = Date.now();
    if (this.sessionsCache && now < this.sessionsCache.expiresAt) {
      return this.sessionsCache.data;
    }
    const sessions = await this.withShortLivedDaemon(
      (client) => client.listSessions(),
    );
    this.sessionsCache = { data: sessions, expiresAt: now + CACHE_TTL_MS };
    return sessions;
  }

  async loadTranscript(sessionId: string): Promise<OpenCodeMessageWithParts[]> {
    if (this.stopped) {
      throw new Error('OpenCodeReadOnlyHistoryService is stopped');
    }
    const now = Date.now();
    const cached = this.transcriptCache.get(sessionId);
    if (cached && now < cached.expiresAt) {
      return cached.data;
    }
    const messages = await this.withShortLivedDaemon(
      (client) => client.getMessages(sessionId),
    );
    this.transcriptCache.set(sessionId, { data: messages, expiresAt: now + CACHE_TTL_MS });
    return messages;
  }

  stop(): void {
    this.stopped = true;
    this.sessionsCache = null;
    this.transcriptCache.clear();
  }

  /**
   * Spawn a short-lived `opencode serve` daemon, wait for it to be
   * ready, execute the provided callback, then immediately stop the
   * daemon. This avoids keeping a long-lived process around just for
   * read-only history access (Req 4 AC 6).
   */
  private async withShortLivedDaemon<T>(
    fn: (client: OpenCodeHttpClient) => Promise<T>,
  ): Promise<T> {
    const childProcess = window.require('child_process') as ChildProcessModule;
    const crypto = window.require('crypto') as CryptoModule;

    const password = crypto.randomUUID();
    const username = 'opencode';
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      OPENCODE_SERVER_PASSWORD: password,
      OPENCODE_SERVER_USERNAME: username,
      FORCE_COLOR: '0',
    };

    const proc = childProcess.spawn(
      this.command,
      ['serve', '--hostname', '127.0.0.1', '--port', '0'],
      {
        cwd: this.directory,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );

    try {
      const handle = await this.waitForReady(proc, username, password);
      const client = new OpenCodeHttpClient({ handle, directory: this.directory });
      return await fn(client);
    } finally {
      this.killDaemon(proc);
    }
  }

  private waitForReady(
    proc: import('child_process').ChildProcess,
    username: string,
    password: string,
  ): Promise<OpenCodeServerHandle> {
    return new Promise<OpenCodeServerHandle>((resolve, reject) => {
      let resolved = false;
      const stdoutBuffer: string[] = [];
      const stderrBuffer: string[] = [];

      const finish = (result: OpenCodeServerHandle | Error): void => {
        if (resolved) return;
        resolved = true;
        window.clearTimeout(timeoutHandle);
        if (result instanceof Error) {
          reject(result);
        } else {
          resolve(result);
        }
      };

      const timeoutHandle = window.setTimeout(() => {
        finish(new Error(
          `OpenCode daemon did not start within ${STARTUP_TIMEOUT_MS}ms. ` +
          'Is `opencode` installed and on PATH?',
        ));
      }, STARTUP_TIMEOUT_MS);

      proc.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        stdoutBuffer.push(text);
        if (resolved) return;
        const match = LISTEN_PATTERN.exec(stdoutBuffer.join(''));
        if (match) {
          const hostname = match[1];
          const port = Number.parseInt(match[2], 10);
          if (Number.isFinite(port) && port > 0) {
            debugLog(`[OpenCodeReadOnlyHistoryService] Daemon ready at ${hostname}:${port}`);
            finish({
              baseUrl: `http://${hostname}:${port}`,
              username,
              password,
              hostname,
              port,
            });
          }
        }
      });

      proc.stderr?.on('data', (chunk: Buffer) => {
        stderrBuffer.push(chunk.toString('utf8'));
      });

      proc.once('error', (error) => {
        finish(new Error(`Failed to spawn opencode: ${error.message}`));
      });

      proc.once('exit', (code, signal) => {
        if (!resolved) {
          const tail = stderrBuffer.join('').trim() || stdoutBuffer.join('').trim();
          const msg = `opencode serve exited before listening (code=${code} signal=${signal ?? 'none'})`;
          finish(new Error(tail ? `${msg}\n${tail}` : msg));
        }
      });
    });
  }

  private killDaemon(proc: import('child_process').ChildProcess): void {
    try {
      if (!proc.killed) {
        proc.kill('SIGTERM');
        // Give a short grace period then force-kill
        const forceKillTimeout = window.setTimeout(() => {
          if (!proc.killed) {
            proc.kill('SIGKILL');
          }
        }, 2_000);
        proc.once('exit', () => {
          window.clearTimeout(forceKillTimeout);
        });
      }
    } catch (error) {
      errorLog('[OpenCodeReadOnlyHistoryService] Failed to kill daemon:', error);
    }
  }
}
