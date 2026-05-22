/**
 * Permission approval modal for ACP `session/request_permission`.
 *
 * Renders agent label, operation description, target paths (vault-relative
 * preferred), and option buttons. Resolves exactly once via option click,
 * close button, or Esc key.
 *
 * Constraints:
 * - No innerHTML (Obsidian lint red-line).
 * - DOM via createEl / createDiv / createSpan only.
 * - Single resolveOnce fires exactly once across all close paths.
 * - ≤200 LoC, 2-space indent, single quotes, semicolons, strict TS.
 */

import { App, Modal } from 'obsidian';
import type {
  PermissionRequestPayload,
  PermissionOutcome,
  PermissionModalDriver,
} from '@/services/agentStream/permissionQueue';

/** Minimal i18n translation interface. */
export interface I18nLike {
  t(key: string, params?: Record<string, string | number>): string;
}

export interface PermissionModalDeps {
  readonly app: App;
  readonly i18n: I18nLike;
  readonly resolveAgentLabel: (agentId: string) => string;
  readonly toVaultRelative: (absolutePath: string) => string | null;
}

type ResolveOnce = (outcome: PermissionOutcome) => void;

/**
 * Obsidian Modal that displays a single permission request and resolves
 * with the user's choice or cancellation.
 */
class PermissionModalView extends Modal {
  private readonly payload: PermissionRequestPayload;
  private readonly deps: PermissionModalDeps;
  private resolveOnce: ResolveOnce | null;

  constructor(
    deps: PermissionModalDeps,
    payload: PermissionRequestPayload,
    resolveOnce: ResolveOnce,
  ) {
    super(deps.app);
    this.deps = deps;
    this.payload = payload;
    this.resolveOnce = resolveOnce;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('termy-permission-modal');

    // Header: agent label
    const agentLabel = this.deps.resolveAgentLabel(this.payload.agentId);
    contentEl.createEl('h3', {
      text: this.deps.i18n.t('agent.permission.title', { agent: agentLabel }),
    });

    // Operation description from toolCall.title
    const title = this.payload.toolCall?.title ?? '';
    if (title) {
      contentEl.createEl('p', {
        cls: 'termy-permission-description',
        text: title,
      });
    }

    // Target paths (vault-relative preferred)
    const locations = this.payload.toolCall?.locations;
    if (locations && locations.length > 0) {
      const pathList = contentEl.createDiv({ cls: 'termy-permission-paths' });
      for (const loc of locations) {
        const display = this.deps.toVaultRelative(loc.path) ?? loc.path;
        pathList.createDiv({ cls: 'termy-permission-path', text: display });
      }
    }

    // Option buttons
    const btnContainer = contentEl.createDiv({ cls: 'termy-permission-buttons' });
    for (const option of this.payload.options) {
      const btn = btnContainer.createEl('button', { text: option.name });
      btn.setAttr('data-option-id', option.optionId);
      btn.addClass('termy-permission-option-btn');
      btn.addEventListener('click', () => {
        this.fireOnce({ kind: 'selected', optionId: option.optionId });
        this.close();
      });
    }
  }

  onClose(): void {
    // If not yet resolved (user pressed Esc or close button), cancel.
    this.fireOnce({ kind: 'cancelled' });
  }

  /** Fires the resolve callback exactly once. */
  private fireOnce(outcome: PermissionOutcome): void {
    if (this.resolveOnce) {
      const cb = this.resolveOnce;
      this.resolveOnce = null;
      cb(outcome);
    }
  }
}

/**
 * Implements {@link PermissionModalDriver} using Obsidian's Modal class.
 * Each `show()` call creates a fresh modal; `close()` dismisses any open one.
 */
export class PermissionModalImpl implements PermissionModalDriver {
  private readonly deps: PermissionModalDeps;
  private activeModal: PermissionModalView | null = null;

  constructor(deps: PermissionModalDeps) {
    this.deps = deps;
  }

  show(payload: PermissionRequestPayload): Promise<PermissionOutcome> {
    // Close any lingering modal before opening a new one.
    this.closeActiveModal();

    return new Promise<PermissionOutcome>((resolve) => {
      const modal = new PermissionModalView(this.deps, payload, (outcome) => {
        this.activeModal = null;
        resolve(outcome);
      });
      this.activeModal = modal;
      modal.open();
    });
  }

  close(): void {
    this.closeActiveModal();
  }

  private closeActiveModal(): void {
    if (this.activeModal) {
      const modal = this.activeModal;
      this.activeModal = null;
      modal.close();
    }
  }
}
