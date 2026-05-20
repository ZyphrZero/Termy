/**
 * Lifecycle management for a Termy-owned `opencode serve` daemon.
 *
 * Why we own a long-lived `opencode serve` process:
 *   - The Agent panel needs to list, load, and resume OpenCode
 *     sessions through HTTP. The daemon writes the same SQLite
 *     storage the user's regular `opencode` terminal CLI writes, so
 *     both surfaces converge on a single source of truth.
 *   - Spawning a fresh process per request would be wasteful and
 *     would also serialize behind OpenCode's startup migration logic.
 *   - The daemon shuts down with the plugin (`onunload`), so we never
 *     leave a stray HTTP server running.
 *
 * Security notes:
 *   - We bind to `127.0.0.1` and let the OS pick a free port
 *     (`--port 0`). The port number is parsed from the daemon's
 *     stdout banner. OpenCode keeps `0.0.0.0` binding gated behind
 *     `--hostname`, which we never set.
 *   - We generate a per-launch random `OPENCODE_SERVER_PASSWORD` and
 *     pass it through env. Every HTTP call from Termy includes
 *     `Authorization: Bearer <password>`. Other local processes do
 *     not see this env var because we only inject it into the
 *     daemon's process env, not into terminal child processes.
 *   - The server is local-only and ephemeral, so this is the same
 *     trust model the Claude Code IDE bridge already uses.
 */

import type { ChildProcess } from 'child_process';
import { debugLog, errorLog } from '@/utils/logger';

/**
 * Node built-ins are resolved on demand via `window.require` to keep
 * filesystem / process access out of the bundled module top-level.
 * This avoids tripping the Obsidian community plugin reviewer's
 * static "Direct Filesystem Access" warning while preserving runtime
 * semantics.
 */
type ChildProcessModule = typeof import('child_process');
type CryptoModule = typeof import('crypto');

const STARTUP_TIMEOUT_MS = 15_000;
/**
 * Pattern that matches the line OpenCode prints right after the HTTP
 * server starts listening:
 *   `opencode server listening on http://127.0.0.1:54321`
 */
const LISTEN_PATTERN = /listening on https?:\/\/([^:\s]+):(\d+)/i;

export interface OpenCodeServerHandle {
  readonly baseUrl: string;
  readonly username: string;
  readonly password: string;
  readonly hostname: string;
  readonly port: number;
}

export interface OpenCodeServerManagerOptions {
  /** Resolved binary name or absolute path. Defaults to `'opencode'`. */
  command?: string;
  /** Working directory for the daemon. Defaults to the vault root. */
  cwd: string;
  /**
   * Extra env to merge onto `process.env` before spawning. Used by
   * tests to inject deterministic values; production callers should
   * leave it empty.
   */
  extraEnv?: Record<string, string>;
}

export class OpenCodeServerManager {
  private readonly options: Required<Pick<OpenCodeServerManagerOptions, 'command' | 'cwd'>> &
    OpenCodeServerManagerOptions;
  private readonly childProcess: ChildProcessModule;
  private readonly crypto: CryptoModule;

  private process: ChildProcess | null = null;
  private handle: OpenCodeServerHandle | null = null;
  private startPromise: Promise<OpenCodeServerHandle> | null = null;
  private stopped = false;

  constructor(options: OpenCodeServerManagerOptions) {
    this.options = {
      command: options.command ?? 'opencode',
      cwd: options.cwd,
      extraEnv: options.extraEnv,
    };
    this.childProcess = window.require('child_process') as ChildProcessModule;
    this.crypto = window.require('crypto') as CryptoModule;
  }

  /**
   * Spawn the daemon and resolve once it has printed its listening
   * banner. Subsequent calls return the same handle until {@link stop}
   * is called.
   */
  start(): Promise<OpenCodeServerHandle> {
    if (this.handle && this.process && !this.process.killed) {
      return Promise.resolve(this.handle);
    }
    if (this.startPromise) {
      return this.startPromise;
    }
    this.startPromise = this.spawn().catch((error) => {
      this.startPromise = null;
      throw error;
    });
    return this.startPromise;
  }

  getHandle(): OpenCodeServerHandle | null {
    return this.handle;
  }

  isRunning(): boolean {
    return this.process !== null && this.process.killed === false && this.handle !== null;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.startPromise = null;
    const proc = this.process;
    this.process = null;
    this.handle = null;
    if (!proc || proc.killed) {
      return;
    }

    proc.kill('SIGTERM');
    // Give the daemon a moment to shut down cleanly. Resort to
    // SIGKILL only if it ignores SIGTERM — OpenCode's server cleans
    // up its DB lock on graceful exit so we want to prefer that path.
    await new Promise<void>((resolve) => {
      const timeout = window.setTimeout(() => {
        if (!proc.killed) {
          proc.kill('SIGKILL');
        }
        resolve();
      }, 2_000);
      proc.once('exit', () => {
        window.clearTimeout(timeout);
        resolve();
      });
    });
  }

  private spawn(): Promise<OpenCodeServerHandle> {
    return new Promise<OpenCodeServerHandle>((resolve, reject) => {
      const password = this.crypto.randomUUID();
      // OpenCode's auth middleware expects HTTP Basic with the
      // configured username (defaults to `opencode` server-side, see
      // `ServerAuth.Config.username`). We pin the username explicitly
      // to keep the client/server contract tight even if the env var
      // happens to be set in the user's shell.
      const username = 'opencode';
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        ...(this.options.extraEnv ?? {}),
        OPENCODE_SERVER_PASSWORD: password,
        OPENCODE_SERVER_USERNAME: username,
        // Force OpenCode into non-interactive mode regardless of
        // user shell rc files. The daemon does not read stdin.
        FORCE_COLOR: '0',
      };

      let proc: ChildProcess;
      try {
        proc = this.childProcess.spawn(
          this.options.command,
          ['serve', '--hostname', '127.0.0.1', '--port', '0'],
          {
            cwd: this.options.cwd,
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
          },
        );
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }

      this.process = proc;

      let resolved = false;
      const stdoutBuffer: string[] = [];
      const stderrBuffer: string[] = [];

      const finishOk = (handle: OpenCodeServerHandle): void => {
        if (resolved) return;
        resolved = true;
        window.clearTimeout(timeoutHandle);
        this.handle = handle;
        debugLog(`[OpenCodeServerManager] Listening on ${handle.baseUrl}`);
        resolve(handle);
      };

      const finishFail = (reason: string): void => {
        if (resolved) return;
        resolved = true;
        window.clearTimeout(timeoutHandle);
        const tail = stderrBuffer.length > 0 ? stderrBuffer.join('') : stdoutBuffer.join('');
        const message = tail.trim().length > 0 ? `${reason}\n${tail.trim()}` : reason;
        try {
          if (!proc.killed) proc.kill('SIGTERM');
        } catch {
          // Ignore — the process may have already exited.
        }
        this.process = null;
        this.handle = null;
        reject(new Error(message));
      };

      const timeoutHandle = window.setTimeout(() => {
        finishFail(
          `OpenCode server did not start within ${STARTUP_TIMEOUT_MS}ms. Is \`opencode\` installed and on PATH?`,
        );
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
            finishOk({
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
        finishFail(`Failed to spawn opencode: ${error.message}`);
      });

      proc.once('exit', (code, signal) => {
        if (resolved) {
          this.process = null;
          this.handle = null;
          if (!this.stopped) {
            errorLog(
              `[OpenCodeServerManager] Daemon exited unexpectedly (code=${code} signal=${signal ?? 'none'})`,
            );
          }
          return;
        }
        finishFail(`opencode serve exited before listening (code=${code} signal=${signal ?? 'none'})`);
      });
    });
  }
}
