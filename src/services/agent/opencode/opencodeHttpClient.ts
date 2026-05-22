/**
 * Read-only HTTP client for the `opencode serve` daemon.
 *
 * After the ACP migration only the following read-only endpoints
 * remain (Property 5.3):
 *   - `GET  /session?directory=<cwd>` — list sessions for the active project
 *   - `GET  /session/:id`             — fetch a session by id
 *   - `GET  /session/:id/message`     — fetch all messages with parts
 *
 * Why Node `http` instead of `fetch`:
 *   The renderer process runs at `app://obsidian.md`; fetch from there
 *   to `http://127.0.0.1:<port>` is cross-origin and triggers a CORS
 *   preflight that the OpenCode daemon rejects (it doesn't ship CORS
 *   headers). Going through Node's `http` module bypasses CORS the
 *   same way Obsidian's own `requestUrl` does.
 *
 *   The traffic stays local-only (the daemon binds 127.0.0.1 with a
 *   per-launch random password), which is the same trust model the
 *   Claude Code IDE bridge already uses.
 */

import type { RequestOptions } from 'http';

type HttpModule = typeof import('http');

/**
 * Connection details for a running OpenCode daemon. Previously lived
 * in `opencodeServerManager.ts`; inlined here after the server
 * manager was removed in the ACP migration.
 */
export interface OpenCodeServerHandle {
  readonly baseUrl: string;
  readonly username: string;
  readonly password: string;
  readonly hostname: string;
  readonly port: number;
}

export interface OpenCodeSessionInfo {
  readonly id: string;
  readonly title: string;
  readonly directory: string;
  readonly projectID: string;
  readonly time: { created: number; updated: number };
  readonly parentID?: string;
  readonly [extra: string]: unknown;
}

export interface OpenCodeMessageInfo {
  readonly id: string;
  readonly sessionID: string;
  readonly role: 'user' | 'assistant';
  readonly time: { created: number; completed?: number };
  readonly [extra: string]: unknown;
}

export interface OpenCodeMessagePart {
  readonly id: string;
  readonly sessionID: string;
  readonly messageID: string;
  readonly type: string;
  readonly [extra: string]: unknown;
}

export interface OpenCodeMessageWithParts {
  readonly info: OpenCodeMessageInfo;
  readonly parts: ReadonlyArray<OpenCodeMessagePart>;
}

interface RequestInitLike {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

interface RawResponse {
  statusCode: number;
  body: string;
}

export class OpenCodeHttpClient {
  private readonly handle: OpenCodeServerHandle;
  private readonly directory: string;
  private readonly http: HttpModule;

  constructor(options: { handle: OpenCodeServerHandle; directory: string }) {
    this.handle = options.handle;
    this.directory = options.directory;
    this.http = window.require('http') as HttpModule;
  }

  async listSessions(options: { limit?: number; search?: string } = {}): Promise<OpenCodeSessionInfo[]> {
    // Filter to sessions whose `directory` matches the current
    // vault root. We deliberately do not send `path`: OpenCode
    // interprets `path` as a *project-relative* path and falls back
    // to "no sessions" when the vault root doesn't equal a known
    // project root, which hides the user's actual history. Querying
    // by `directory` alone surfaces every session that was launched
    // with this vault as cwd, which is what the panel wants.
    const params = new URLSearchParams();
    params.set('directory', this.directory);
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    if (options.search) params.set('search', options.search);
    return this.fetchJson<OpenCodeSessionInfo[]>(`/session?${params.toString()}`);
  }

  async getSession(sessionId: string): Promise<OpenCodeSessionInfo> {
    return this.fetchJson<OpenCodeSessionInfo>(
      `/session/${encodeURIComponent(sessionId)}?directory=${encodeURIComponent(this.directory)}`,
    );
  }

  async getMessages(sessionId: string): Promise<OpenCodeMessageWithParts[]> {
    return this.fetchJson<OpenCodeMessageWithParts[]>(
      `/session/${encodeURIComponent(sessionId)}/message?directory=${encodeURIComponent(this.directory)}`,
    );
  }

  private async fetchJson<T>(path: string, init: RequestInitLike = {}): Promise<T> {
    const response = await this.rawRequest(path, init);
    if (response.statusCode >= 400) {
      throw new Error(
        `opencode ${init.method ?? 'GET'} ${path} failed (${response.statusCode}): ${response.body}`,
      );
    }
    try {
      return JSON.parse(response.body) as T;
    } catch (error) {
      throw new Error(
        `opencode ${init.method ?? 'GET'} ${path} returned non-JSON payload: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private rawRequest(path: string, init: RequestInitLike = {}): Promise<RawResponse> {
    const requestOptions = this.buildRequestOptions(path, init);

    return new Promise<RawResponse>((resolve, reject) => {
      const req = this.http.request(requestOptions, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
        res.once('error', reject);
      });
      req.once('error', reject);
      if (init.body !== undefined) {
        req.write(init.body);
      }
      req.end();
    });
  }

  private buildRequestOptions(path: string, init: RequestInitLike): RequestOptions {
    // OpenCode's HTTP API uses HTTP Basic auth — `Authorization:
    // Basic <base64(username:password)>`. The username is fixed to
    // whatever the daemon was launched with (`opencode` by default);
    // the password is the per-launch random secret injected via env.
    const credential = Buffer.from(`${this.handle.username}:${this.handle.password}`).toString('base64');
    const headers: Record<string, string> = {
      Authorization: `Basic ${credential}`,
      'x-opencode-directory': this.directory,
      ...(init.headers ?? {}),
    };
    if (init.body !== undefined && headers['Content-Type'] === undefined) {
      headers['Content-Type'] = 'application/json';
    }
    return {
      hostname: this.handle.hostname,
      port: this.handle.port,
      path,
      method: init.method ?? 'GET',
      headers,
    };
  }
}
