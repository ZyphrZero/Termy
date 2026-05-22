/**
 * FIFO permission approval pipeline for ACP `session/request_permission`.
 *
 * - Auto-approve when `permissionApprovalEnabled` is false (Req 3 AC 9).
 * - Match persisted rules and auto-respond without UI (Req 3 AC 5).
 * - Serialize modal display via single-flight mutex (Req 3 AC 6).
 * - Fire a timeout-banner event after 60 s of no response (Req 3 AC 7).
 * - Reject all pending requests on dispose (plugin unload).
 *
 * Properties: 3.2 (exactly-once), 3.3 (FIFO), 3.4 (rule match).
 */

import type {
  AcpPermissionRequestParams,
  AcpPermissionOption,
} from './acp/acpProtocol';
import type { PermissionRule } from '@/settings/types';
import type { AgentEvent } from './agentEventTypes';

/* ---- Public types ------------------------------------------------*/

export interface PermissionRequestPayload {
  readonly agentId: string;
  readonly sessionId: string;
  readonly toolCall: AcpPermissionRequestParams['toolCall'];
  readonly options: readonly AcpPermissionOption[];
  readonly receivedAt: number;
}

export type PermissionOutcome =
  | { readonly kind: 'selected'; readonly optionId: string }
  | { readonly kind: 'cancelled' };

/**
 * Abstraction over the UI modal. Production wires the real
 * `PermissionModal`; tests supply a synchronous stub.
 */
export interface PermissionModalDriver {
  show(payload: PermissionRequestPayload): Promise<PermissionOutcome>;
  close(): void;
}

/** Dependencies injected into {@link DefaultPermissionQueue}. */
export interface PermissionQueueDeps {
  /** Publishes audit events to the agent event bus. */
  readonly publishEvent: (event: AgentEvent) => void;
  readonly modalDriver: PermissionModalDriver;
  readonly getPermissionApprovalEnabled: () => boolean;
  readonly getPermissionRules: () => readonly PermissionRule[];
  readonly now?: () => number;
  readonly scheduleTimeout?: (cb: () => void, ms: number) => unknown;
  readonly cancelTimeout?: (handle: unknown) => void;
}

/** Public contract for the permission queue. */
export interface PermissionQueue {
  enqueue(
    agentId: string,
    params: AcpPermissionRequestParams,
  ): Promise<PermissionOutcome>;
  pendingCount(): number;
  dispose(): void;
}

/* ---- Internal types ----------------------------------------------*/

interface QueueEntry {
  readonly payload: PermissionRequestPayload;
  readonly resolve: (outcome: PermissionOutcome) => void;
  readonly reject: (error: Error) => void;
}

const TIMEOUT_BANNER_MS = 60_000;

/* ---- Implementation ----------------------------------------------*/

export class DefaultPermissionQueue implements PermissionQueue {
  private readonly queue: QueueEntry[] = [];
  private processing = false;
  private disposed = false;
  private timeoutHandle: unknown = null;
  private readonly publishEvent: (event: AgentEvent) => void;
  private readonly modalDriver: PermissionModalDriver;
  private readonly getApprovalEnabled: () => boolean;
  private readonly getRules: () => readonly PermissionRule[];
  private readonly now: () => number;
  private readonly schedule: (cb: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(deps: PermissionQueueDeps) {
    this.publishEvent = deps.publishEvent;
    this.modalDriver = deps.modalDriver;
    this.getApprovalEnabled = deps.getPermissionApprovalEnabled;
    this.getRules = deps.getPermissionRules;
    this.now = deps.now ?? (() => Date.now());
    this.schedule = deps.scheduleTimeout ?? ((cb, ms) => window.setTimeout(cb, ms));
    this.clearTimer = deps.cancelTimeout ?? ((h) => {
      if (h !== null && h !== undefined) {
        window.clearTimeout(h as ReturnType<typeof window.setTimeout>);
      }
    });
  }

  async enqueue(
    agentId: string,
    params: AcpPermissionRequestParams,
  ): Promise<PermissionOutcome> {
    // Path A: approval disabled — auto-allow first allow option + audit
    if (!this.getApprovalEnabled()) {
      const fallback = pickFirstAllowOption(params.options);
      const outcome: PermissionOutcome = { kind: 'selected', optionId: fallback.optionId };
      this.emitAudit(agentId, params, outcome);
      return outcome;
    }
    // Path B: persisted rule match — auto-respond + audit
    const matched = this.matchRule(agentId, params);
    if (matched) {
      this.emitAudit(agentId, params, matched);
      return matched;
    }
    // Path C: enqueue for modal display (FIFO)
    return new Promise<PermissionOutcome>((resolve, reject) => {
      const payload: PermissionRequestPayload = {
        agentId,
        sessionId: params.sessionId,
        toolCall: params.toolCall,
        options: params.options,
        receivedAt: this.now(),
      };
      this.queue.push({ payload, resolve, reject });
      void this.processNext();
    });
  }

  pendingCount(): number {
    return this.queue.length + (this.processing ? 1 : 0);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearTimeoutBanner();
    this.modalDriver.close();
    for (const entry of this.queue) {
      entry.reject(new Error('PermissionQueue disposed'));
    }
    this.queue.length = 0;
  }

  /* -- Single-flight modal processing with finally drain -----------*/

  private async processNext(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;
    const head = this.queue.shift()!;
    this.processing = true;
    this.startTimeoutBanner(head.payload);
    try {
      const outcome = await this.modalDriver.show(head.payload);
      head.resolve(outcome);
    } catch (err) {
      head.reject(err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.clearTimeoutBanner();
      this.processing = false;
      void this.processNext();
    }
  }

  /* -- 60 s timeout banner (Req 3 AC 7) ----------------------------*/

  private startTimeoutBanner(payload: PermissionRequestPayload): void {
    this.clearTimeoutBanner();
    this.timeoutHandle = this.schedule(() => {
      this.publishEvent({
        kind: 'permission-request',
        sessionId: payload.sessionId,
        requestId: `timeout-banner-${payload.receivedAt}`,
        message: 'Permission request pending for over 60 seconds',
        options: [],
      });
    }, TIMEOUT_BANNER_MS);
  }

  private clearTimeoutBanner(): void {
    if (this.timeoutHandle !== null) {
      this.clearTimer(this.timeoutHandle);
      this.timeoutHandle = null;
    }
  }

  /* -- Persisted rule matching (Property 3.4) ----------------------*/

  private matchRule(
    agentId: string,
    params: AcpPermissionRequestParams,
  ): PermissionOutcome | null {
    const rules = this.getRules();
    const op = deriveOp(params);
    const target = deriveTargetPath(params);
    for (const rule of rules) {
      if (rule.agentId !== agentId) continue;
      if (rule.op !== op) continue;
      if (target && rule.pathPrefix && !target.startsWith(rule.pathPrefix)) continue;
      const optionId = findOptionForDecision(params.options, rule.decision);
      if (optionId) return { kind: 'selected', optionId };
    }
    return null;
  }

  /* -- Audit event emission ----------------------------------------*/

  private emitAudit(
    agentId: string,
    params: AcpPermissionRequestParams,
    outcome: PermissionOutcome,
  ): void {
    const optionLabel = outcome.kind === 'selected'
      ? params.options.find((o) => o.optionId === outcome.optionId)?.name ?? outcome.optionId
      : 'cancelled';
    this.publishEvent({
      kind: 'permission-request',
      sessionId: params.sessionId,
      requestId: `audit-${agentId}-${this.now()}`,
      message: `Auto-responded: ${optionLabel}`,
      options: params.options.map((o) => ({
        id: o.optionId,
        label: o.name,
        kind: mapOptionKind(o.kind),
      })),
    });
  }
}

/* ---- Module-level helpers ----------------------------------------*/

function pickFirstAllowOption(options: readonly AcpPermissionOption[]): AcpPermissionOption {
  return options.find((o) => o.kind === 'allow_once' || o.kind === 'allow_always') ?? options[0];
}

function deriveOp(params: AcpPermissionRequestParams): string {
  const title = params.toolCall?.title?.toLowerCase() ?? '';
  if (title.includes('write') || title.includes('edit')) return 'fs.write';
  if (title.includes('read')) return 'fs.read';
  if (title.includes('terminal') || title.includes('execute')) return 'terminal.create';
  return 'unknown';
}

function deriveTargetPath(params: AcpPermissionRequestParams): string {
  const locations = params.toolCall?.locations;
  if (locations && locations.length > 0) return locations[0].path;
  return '';
}

function findOptionForDecision(
  options: readonly AcpPermissionOption[],
  decision: string,
): string | null {
  if (decision === 'allow') {
    const opt = options.find((o) => o.kind === 'allow_always' || o.kind === 'allow_once');
    return opt?.optionId ?? null;
  }
  if (decision === 'reject') {
    const opt = options.find((o) => o.kind === 'reject_always' || o.kind === 'reject_once');
    return opt?.optionId ?? null;
  }
  return null;
}

function mapOptionKind(
  kind: AcpPermissionOption['kind'],
): 'allow' | 'allow-once' | 'deny' | 'cancel' {
  switch (kind) {
    case 'allow_always': return 'allow';
    case 'allow_once': return 'allow-once';
    case 'reject_once': return 'deny';
    case 'reject_always': return 'deny';
    default: return 'allow';
  }
}
