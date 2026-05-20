/**
 * Thin HTTP client for the `opencode serve` daemon.
 *
 * Endpoints we use today:
 *   - `GET  /session?path=<cwd>`   — list sessions for the active project
 *   - `GET  /session/:id`          — fetch a session by id
 *   - `GET  /session/:id/message`  — fetch all messages with parts
 *   - `POST /session`              — create a new session
 *   - `POST /session/:id/prompt_async` — fire a turn (events flow via SSE)
 *   - `GET  /event` (SSE)          — global event stream (filtered client-side)
 *
 * Why Node `http` instead of `fetch`:
 *   The renderer process runs at `app://obsidian.md`; fetch from there
 *   to `http://127.0.0.1:<port>` is cross-origin and triggers a CORS
 *   preflight that the OpenCode daemon rejects (it doesn't ship CORS
 *   headers). Going through Node's `http` module bypasses CORS the
 *   same way Obsidian's own `requestUrl` does, *and* gives us a real
 *   `IncomingMessage` stream we can iterate for SSE — which `fetch`
 *   cannot do here even if CORS were satisfied.
 *
 *   The traffic stays local-only (the daemon binds 127.0.0.1 with a
 *   per-launch random password), which is the same trust model the
 *   Claude Code IDE bridge already uses.
 */

import type { IncomingMessage, RequestOptions } from 'http';
import type { OpenCodeServerHandle } from './opencodeServerManager.ts';

type HttpModule = typeof import('http');

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

/** SSE payload from `/event`. */
export interface OpenCodeBusEvent {
  readonly id: string;
  readonly type: string;
  readonly properties: Record<string, unknown>;
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

  async createSession(payload: { title?: string; directory?: string } = {}): Promise<OpenCodeSessionInfo> {
    const body = {
      directory: payload.directory ?? this.directory,
      ...(payload.title ? { title: payload.title } : {}),
    };
    return this.fetchJson<OpenCodeSessionInfo>(
      `/session?directory=${encodeURIComponent(this.directory)}`,
      { method: 'POST', body: JSON.stringify(body) },
    );
  }

  async sendPromptAsync(
    sessionId: string,
    payload: { parts: Array<{ type: 'text'; text: string }>; modelID?: string; providerID?: string; agent?: string },
  ): Promise<void> {
    const url = `/session/${encodeURIComponent(sessionId)}/prompt_async?directory=${encodeURIComponent(this.directory)}`;
    const response = await this.rawRequest(url, { method: 'POST', body: JSON.stringify(payload) });
    if (response.statusCode >= 400) {
      throw new Error(`opencode prompt_async failed (${response.statusCode}): ${response.body}`);
    }
  }

  /**
   * Open the bus event stream. Returns an `AsyncIterable` of decoded
   * events plus a close handle. SSE is consumed via Node's
   * `IncomingMessage` stream so we never touch the renderer's fetch
   * (CORS) or buffer the entire response.
   */
  openEventStream(signal?: AbortSignal): { events: AsyncIterable<OpenCodeBusEvent>; close: () => void } {
    let cancelled = false;
    let activeRequest: ReturnType<HttpModule['request']> | null = null;

    const close = (): void => {
      cancelled = true;
      activeRequest?.destroy();
    };

    if (signal) {
      if (signal.aborted) cancelled = true;
      else signal.addEventListener('abort', close);
    }

    const path = `/event?directory=${encodeURIComponent(this.directory)}`;
    const requestOptions = this.buildRequestOptions(path, {
      method: 'GET',
      headers: { Accept: 'text/event-stream' },
    });

    const http = this.http;
    const handle = this.handle;

    const events = (async function* (): AsyncIterable<OpenCodeBusEvent> {
      if (cancelled) return;

      const response = await new Promise<IncomingMessage>((resolve, reject) => {
        const req = http.request(requestOptions, resolve);
        activeRequest = req;
        req.once('error', reject);
        req.end();
      });

      if (response.statusCode !== 200) {
        throw new Error(`opencode SSE connect failed (${response.statusCode}) at ${handle.baseUrl}/event`);
      }

      response.setEncoding('utf8');
      let buffer = '';

      try {
        for await (const chunk of response as AsyncIterable<string>) {
          if (cancelled) break;
          buffer += chunk;
          // SSE blocks are separated by a blank line. Process every
          // complete block and keep the trailing partial in `buffer`.
          let separatorIndex: number;
          while ((separatorIndex = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, separatorIndex);
            buffer = buffer.slice(separatorIndex + 2);
            const event = parseSseBlock(block);
            if (event) yield event;
          }
        }
      } finally {
        activeRequest = null;
      }
    })();

    return { events, close };
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
    // whatever the daemon was launched with (`opencode` by default,
    // see `OpenCodeServerManager.spawn`); the password is the
    // per-launch random secret we injected via env.
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

/**
 * Parse one `data: <json>\n` block from the SSE stream. Returns
 * `null` for keep-alive comments, empty blocks, or malformed JSON.
 */
function parseSseBlock(block: string): OpenCodeBusEvent | null {
  const lines = block.split(/\r?\n/);
  let dataLine: string | null = null;
  for (const line of lines) {
    if (line.startsWith(':')) continue;
    if (line.startsWith('data:')) {
      dataLine = line.slice(5).trimStart();
      break;
    }
  }
  if (!dataLine) return null;
  try {
    const parsed = JSON.parse(dataLine) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    const type = typeof record.type === 'string' ? record.type : '';
    const id = typeof record.id === 'string' ? record.id : '';
    const propertiesUnknown = record.properties;
    const properties =
      typeof propertiesUnknown === 'object' && propertiesUnknown !== null
        ? (propertiesUnknown as Record<string, unknown>)
        : {};
    if (!type) return null;
    return { id, type, properties };
  } catch {
    return null;
  }
}

/** Exposed only for unit tests. */
export const __testing = { parseSseBlock };
