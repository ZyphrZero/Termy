/**
 * ACP fs/read_text_file and fs/write_text_file capability handler.
 *
 * - Write path MUST go through PermissionQueue (Property 7.4).
 * - Vault-internal files use `app.vault.adapter`; external fallback
 *   to `fs.promises` (Req 7 AC 7-8).
 * - Read path is treated as safe (no modal by default).
 * - Rejection surfaces as JSON-RPC error code -32001.
 */

import * as path from 'path';
import * as fs from 'fs';
import type { App } from 'obsidian';
import type { PermissionQueue } from '../permissionQueue';
import type { AcpPermissionRequestParams } from './acpProtocol';

/* ---- Public types ------------------------------------------------*/

export interface AcpFsReadRequest {
  readonly sessionId: string;
  readonly path: string;
}

export interface AcpFsReadResponse {
  readonly content: string;
}

export interface AcpFsWriteRequest {
  readonly sessionId: string;
  readonly path: string;
  readonly content: string;
}

export interface AcpFsWriteResponse {
  readonly ok: boolean;
}

export interface AcpFsHandlers {
  readTextFile(req: AcpFsReadRequest): Promise<AcpFsReadResponse>;
  writeTextFile(req: AcpFsWriteRequest): Promise<AcpFsWriteResponse>;
}

export interface FsCapabilityHandler {
  forAgent(agentId: string): AcpFsHandlers;
}

/** Dependencies injected into {@link DefaultFsCapabilityHandler}. */
export interface FsCapabilityHandlerDeps {
  readonly app: App;
  readonly permissionQueue: PermissionQueue;
  readonly vaultRoot: string;
}

/* ---- Helpers -----------------------------------------------------*/

/** Convert absolute path to vault-relative if inside vault, else null. */
function toVaultRelative(absolute: string, vaultRoot: string): string | null {
  const normalized = path.resolve(absolute);
  const normalizedRoot = path.resolve(vaultRoot);
  if (normalized === normalizedRoot) return '';
  const prefix = normalizedRoot + path.sep;
  if (normalized.startsWith(prefix)) {
    return normalized.slice(prefix.length).replace(/\\/g, '/');
  }
  return null;
}

/** Build a JSON-RPC-style error for permission denial. */
class AcpPermissionDeniedError extends Error {
  readonly code = -32001;
  constructor(target: string) {
    super(`Permission denied: ${target}`);
    this.name = 'AcpPermissionDeniedError';
  }
}

/* ---- Implementation ----------------------------------------------*/

export class DefaultFsCapabilityHandler implements FsCapabilityHandler {
  private readonly app: App;
  private readonly permissionQueue: PermissionQueue;
  private readonly vaultRoot: string;

  constructor(deps: FsCapabilityHandlerDeps) {
    this.app = deps.app;
    this.permissionQueue = deps.permissionQueue;
    this.vaultRoot = deps.vaultRoot;
  }

  forAgent(agentId: string): AcpFsHandlers {
    return {
      readTextFile: (req) => this.readTextFile(agentId, req),
      writeTextFile: (req) => this.writeTextFile(agentId, req),
    };
  }

  private async readTextFile(
    _agentId: string,
    req: AcpFsReadRequest,
  ): Promise<AcpFsReadResponse> {
    const absolute = path.resolve(req.path);
    const vaultRel = toVaultRelative(absolute, this.vaultRoot);
    // Vault-internal: use adapter (Req 7 AC 7)
    if (vaultRel !== null) {
      const content = await this.app.vault.adapter.read(vaultRel);
      return { content };
    }
    // Vault-external: fallback to fs.promises
    const content = await fs.promises.readFile(absolute, 'utf8');
    return { content };
  }

  private async writeTextFile(
    agentId: string,
    req: AcpFsWriteRequest,
  ): Promise<AcpFsWriteResponse> {
    const absolute = path.resolve(req.path);
    const vaultRel = toVaultRelative(absolute, this.vaultRoot);
    const displayPath = vaultRel ?? absolute;

    // Write MUST go through PermissionQueue (Property 7.4)
    const permParams: AcpPermissionRequestParams = {
      sessionId: req.sessionId,
      toolCall: {
        sessionUpdate: 'tool_call',
        toolCallId: `fs-write-${Date.now()}`,
        title: 'Write file',
        kind: 'edit',
        locations: [{ path: displayPath }],
      },
      options: [
        { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'allow_always', name: 'Always allow', kind: 'allow_always' },
        { optionId: 'reject_once', name: 'Reject', kind: 'reject_once' },
      ],
    };

    const outcome = await this.permissionQueue.enqueue(agentId, permParams);
    if (outcome.kind === 'cancelled' || outcome.optionId.startsWith('reject')) {
      throw new AcpPermissionDeniedError(displayPath);
    }

    // Vault-internal: use adapter (Req 7 AC 8)
    if (vaultRel !== null) {
      await this.app.vault.adapter.write(vaultRel, req.content);
    } else {
      // Vault-external: fallback to fs.promises
      await fs.promises.writeFile(absolute, req.content, 'utf8');
    }
    return { ok: true };
  }
}
