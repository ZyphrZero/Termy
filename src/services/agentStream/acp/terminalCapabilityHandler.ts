/**
 * ACP terminal capability handler.
 *
 * - `terminal/create` MUST go through PermissionQueue (Req 3 AC 1).
 * - User allows → reuse existing `src/services/terminal/` PTY session
 *   factory (no new spawn path introduced).
 * - User rejects → return JSON-RPC error code -32001.
 *
 * File LoC target: ≤ 200.
 */

import type { PermissionQueue } from '../permissionQueue';
import type { AcpPermissionRequestParams } from './acpProtocol';
import type { TerminalService } from '@/services/terminal/terminalService';

/* ---- Public types ------------------------------------------------*/

export interface AcpTerminalCreateRequest {
  readonly sessionId: string;
  readonly command?: string;
  readonly cwd?: string;
}

export interface AcpTerminalCreateResponse {
  readonly terminalId: string;
}

export interface AcpTerminalHandlers {
  create(req: AcpTerminalCreateRequest): Promise<AcpTerminalCreateResponse>;
}

export interface TerminalCapabilityHandler {
  forAgent(agentId: string): AcpTerminalHandlers;
}

/** Dependencies injected into {@link DefaultTerminalCapabilityHandler}. */
export interface TerminalCapabilityHandlerDeps {
  readonly permissionQueue: PermissionQueue;
  readonly terminalService: TerminalService;
  readonly vaultRoot: string;
}

/* ---- Helpers -----------------------------------------------------*/

/** Build a JSON-RPC-style error for permission denial. */
class AcpTerminalPermissionDeniedError extends Error {
  readonly code = -32001;
  constructor(detail: string) {
    super(`Permission denied: terminal create (${detail})`);
    this.name = 'AcpTerminalPermissionDeniedError';
  }
}

/** Build the permission request params for a terminal/create call. */
function buildPermissionParams(
  sessionId: string,
  command: string | undefined,
  cwd: string | undefined,
): AcpPermissionRequestParams {
  const title = command
    ? `Execute terminal command: ${command}`
    : 'Create terminal session';
  const locations = cwd ? [{ path: cwd }] : [];
  return {
    sessionId,
    toolCall: {
      sessionUpdate: 'tool_call',
      toolCallId: `terminal-create-${Date.now()}`,
      title,
      kind: 'execute',
      locations,
    },
    options: [
      { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
      { optionId: 'allow_always', name: 'Always allow', kind: 'allow_always' },
      { optionId: 'reject_once', name: 'Reject', kind: 'reject_once' },
      { optionId: 'reject_always', name: 'Always reject', kind: 'reject_always' },
    ],
  };
}

/* ---- Implementation ----------------------------------------------*/

export class DefaultTerminalCapabilityHandler implements TerminalCapabilityHandler {
  private readonly permissionQueue: PermissionQueue;
  private readonly terminalService: TerminalService;
  private readonly vaultRoot: string;

  constructor(deps: TerminalCapabilityHandlerDeps) {
    this.permissionQueue = deps.permissionQueue;
    this.terminalService = deps.terminalService;
    this.vaultRoot = deps.vaultRoot;
  }

  /**
   * Return a bound handler set scoped to a specific agent.
   * Each agent gets its own `create` method that tags permission
   * requests with the correct agentId.
   */
  forAgent(agentId: string): AcpTerminalHandlers {
    return {
      create: (req) => this.handleCreate(agentId, req),
    };
  }

  /**
   * Handle terminal/create request.
   *
   * Flow:
   *  1. Enqueue permission request via PermissionQueue.
   *  2. If user rejects → throw JSON-RPC error -32001.
   *  3. If user allows → delegate to TerminalService.createTerminal().
   */
  private async handleCreate(
    agentId: string,
    req: AcpTerminalCreateRequest,
  ): Promise<AcpTerminalCreateResponse> {
    const permParams = buildPermissionParams(
      req.sessionId,
      req.command,
      req.cwd ?? this.vaultRoot,
    );

    const outcome = await this.permissionQueue.enqueue(agentId, permParams);

    // Rejection path: cancelled or any reject option
    if (
      outcome.kind === 'cancelled'
      || outcome.optionId.startsWith('reject')
    ) {
      throw new AcpTerminalPermissionDeniedError(
        req.command ?? 'terminal session',
      );
    }

    // Allowed: reuse existing terminal service PTY session factory
    const terminal = await this.terminalService.createTerminal();
    return { terminalId: terminal.id };
  }
}
