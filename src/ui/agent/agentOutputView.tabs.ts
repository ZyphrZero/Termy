/**
 * Tab rendering logic for the Agent Output View.
 *
 * Extracted to keep the main view file under 500 LoC.
 * Renders dynamic agent tabs from settings, the aggregated status
 * indicator, and the empty-agents state.
 */

import { setIcon } from 'obsidian';

import type { AgentConfig } from '../../services/agentStream/agentConfig';
import type { AgentManager } from '../../services/agentStream/agentManager';
import type { PermissionQueue } from '../../services/agentStream/permissionQueue';
import type { AgentSessionSnapshot } from '../../services/agentStream/agentSessionModel';
import { renderAgentBrandIcon } from './agentBrandIcon';
import { t } from '../../i18n';

export interface TabRenderContext {
  readonly providerTabsEl: HTMLElement;
  readonly headerStatusEl: HTMLElement | null;
  readonly selectedAgentId: string | null;
  readonly agentManager: AgentManager | null;
  readonly permissionQueue: PermissionQueue | null;
  readonly getActiveSnapshot: () => AgentSessionSnapshot | null;
  readonly onTabClick: (agentId: string) => void;
  readonly onOpenSettings: () => void;
}

/**
 * Render the provider tabs from the enabled agents list.
 * Returns early with an empty-state render when no agents are enabled.
 */
export function renderProviderTabs(
  enabledAgents: readonly AgentConfig[],
  ctx: TabRenderContext,
): void {
  ctx.providerTabsEl.empty();

  // Empty state: no agents enabled (Req 6 AC 9).
  if (enabledAgents.length === 0) {
    renderEmptyAgentsState(ctx);
    return;
  }

  for (const agent of enabledAgents) {
    const button = ctx.providerTabsEl.createEl('button', {
      cls: 'termy-agent-provider-tab',
      attr: { type: 'button' },
    });
    if (agent.id === ctx.selectedAgentId) {
      button.addClass('is-active');
    }
    const iconEl = button.createSpan({ cls: 'termy-agent-provider-tab-icon' });
    if (agent.icon) {
      renderAgentBrandIcon(iconEl, agent.icon, 'sparkles');
    } else {
      setIcon(iconEl, 'sparkles');
    }
    button.createSpan({ cls: 'termy-agent-provider-tab-label', text: agent.label });
    button.addEventListener('click', () => {
      ctx.onTabClick(agent.id);
    });
  }

  // Aggregated status indicator (Req 9 AC 8).
  renderStatusIndicator(ctx);
}

/**
 * Render the aggregated status indicator showing active agents,
 * running sessions, and pending permission count (Req 9 AC 8).
 */
export function renderStatusIndicator(ctx: TabRenderContext): void {
  if (!ctx.headerStatusEl) return;
  ctx.headerStatusEl.empty();

  const activeCount = ctx.agentManager?.getActiveAgentIds().length ?? 0;
  const pendingCount = ctx.permissionQueue?.pendingCount() ?? 0;

  // Determine running session count from the current snapshot.
  const snapshot = ctx.getActiveSnapshot();
  const runningCount = snapshot?.state === 'running' ? 1 : 0;

  if (activeCount === 0 && pendingCount === 0) {
    ctx.headerStatusEl.setText('');
    return;
  }

  const parts: string[] = [];
  if (activeCount > 0) {
    parts.push(t('agent.statusConnected', { count: activeCount }));
  }
  if (runningCount > 0) {
    parts.push(t('agent.statusRunning', { count: runningCount }));
  }
  if (pendingCount > 0) {
    parts.push(t('agent.statusPending', { count: pendingCount }));
  }

  const indicator = ctx.headerStatusEl.createSpan({
    cls: 'termy-agent-status-indicator',
    text: parts.join(' \u00b7 '),
  });
  indicator.setAttribute('aria-label', parts.join(', '));
}

/**
 * Empty state when no agents are enabled (Req 6 AC 9).
 */
function renderEmptyAgentsState(ctx: TabRenderContext): void {
  const container = ctx.providerTabsEl.createDiv({ cls: 'termy-agent-no-agents' });
  container.createDiv({
    cls: 'termy-agent-no-agents-text',
    text: t('agent.emptyBody'),
  });
  const openSettingsBtn = container.createEl('button', {
    cls: 'mod-cta',
    text: t('agent.openSettings'),
    attr: { type: 'button' },
  });
  openSettingsBtn.addEventListener('click', () => {
    ctx.onOpenSettings();
  });
}
