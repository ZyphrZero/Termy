/**
 * Snapshot-to-DOM renderer for the agent view.
 *
 * The renderer is decoupled from the view so it can be unit-tested
 * with a faked Markdown engine: we feed it a snapshot, it produces a
 * DOM tree, and the test inspects classes / text content.
 *
 * In production the renderer delegates to Obsidian's
 * `MarkdownRenderer.render` for every Markdown block — the same
 * primitive used by the changelog modal — so headings, code fences,
 * callouts and Obsidian wikilinks all light up for free.
 */

import type { Component } from 'obsidian';

import type {
  AgentSessionSnapshot,
  AgentTextBlock,
  AgentToolBlock,
  AgentErrorBlock,
  AgentPermissionRequest,
} from '../../services/agentStream/agentSessionModel';

/**
 * Translation function injected by the caller.
 *
 * The view passes Obsidian's `t()` so production strings honour the
 * user's locale; tests pass a deterministic stub that just returns
 * the key. Keeping the dependency injected (rather than imported)
 * lets `node --experimental-strip-types` run the renderer without
 * loading the Obsidian shim transitively pulled in by `@/i18n`.
 */
export type LocalizeFn = (key: string, params?: Record<string, string | number>) => string;

const identityLocalize: LocalizeFn = (key) => key;

/**
 * Function signature for rendering a Markdown string into a target
 * element. Production passes Obsidian's `MarkdownRenderer.render`.
 *
 * The signature deliberately mirrors Obsidian's call surface so the
 * production wiring is a one-liner — see
 * {@link defaultAgentSnapshotRendererFactory}.
 */
export type MarkdownRenderFn = (
  markdown: string,
  target: HTMLElement,
  sourcePath: string,
  owner: Component,
) => Promise<void>;

export interface AgentSnapshotRenderer {
  renderMarkdown: MarkdownRenderFn;
  /** Fake source path used when Obsidian needs one. The vault root works fine. */
  sourcePath: string;
  /**
   * Optional localizer. Defaults to identity (returns the key) so the
   * renderer stays usable in unit tests without an Obsidian context.
   */
  localize?: LocalizeFn;
}

/**
 * Render a session snapshot into the given container. Idempotent —
 * the container is emptied before each render.
 */
export async function renderAgentSnapshot(
  snapshot: AgentSessionSnapshot,
  container: HTMLElement,
  owner: Component,
  renderer: AgentSnapshotRenderer,
): Promise<void> {
  const t = renderer.localize ?? identityLocalize;
  container.empty();
  container.setAttribute('data-session-id', snapshot.sessionId);

  if (snapshot.plan.length > 0) {
    renderPlan(snapshot, container, t);
  }

  if (snapshot.pendingPermissions.length > 0) {
    renderPermissions(snapshot.pendingPermissions, container, t);
  }

  for (const block of snapshot.blocks) {
    if (block.kind === 'text') {
      // eslint-disable-next-line no-await-in-loop -- order matters to preserve visual top-down render of streaming chunks.
      await renderTextBlock(block, container, owner, renderer);
    } else if (block.kind === 'tool') {
      // eslint-disable-next-line no-await-in-loop -- see above.
      await renderToolBlock(block, container, owner, renderer, t);
    } else if (block.kind === 'error') {
      renderErrorBlock(block, container, t);
    }
  }
}

function renderPlan(snapshot: AgentSessionSnapshot, container: HTMLElement, t: LocalizeFn): void {
  const planEl = container.createDiv({ cls: 'termy-agent-plan' });
  planEl.createDiv({ cls: 'termy-agent-plan-title', text: t('agent.planTitle') });
  const list = planEl.createEl('ul', { cls: 'termy-agent-plan-list' });
  for (const step of snapshot.plan) {
    const item = list.createEl('li', {
      cls: `termy-agent-plan-step is-${step.status}`,
    });
    item.createSpan({
      cls: 'termy-agent-plan-marker',
      text: planMarker(step.status),
    });
    item.createSpan({ cls: 'termy-agent-plan-text', text: step.title });
  }
}

function planMarker(status: AgentSessionSnapshot['plan'][number]['status']): string {
  switch (status) {
    case 'completed': return '✓';
    case 'in-progress': return '…';
    case 'failed': return '✗';
    default: return '○';
  }
}

function renderPermissions(
  requests: AgentPermissionRequest[],
  container: HTMLElement,
  t: LocalizeFn,
): void {
  const wrapper = container.createDiv({ cls: 'termy-agent-permissions' });
  for (const request of requests) {
    const card = wrapper.createDiv({ cls: 'termy-agent-permission' });
    card.createDiv({ cls: 'termy-agent-permission-title', text: t('agent.permissionTitle') });
    card.createDiv({ cls: 'termy-agent-permission-message', text: request.message });
    const optionsEl = card.createDiv({ cls: 'termy-agent-permission-options' });
    for (const option of request.options) {
      optionsEl.createSpan({
        cls: `termy-agent-permission-option is-${option.kind}`,
        text: option.label,
      });
    }
  }
}

async function renderTextBlock(
  block: AgentTextBlock,
  container: HTMLElement,
  owner: Component,
  renderer: AgentSnapshotRenderer,
): Promise<void> {
  const wrapper = container.createDiv({
    cls: `termy-agent-text-block is-${block.channel}${block.streaming ? ' is-streaming' : ''}`,
  });
  const markdownEl = wrapper.createDiv({ cls: 'markdown-rendered termy-agent-markdown' });
  await renderer.renderMarkdown(block.body, markdownEl, renderer.sourcePath, owner);
  if (block.streaming) {
    wrapper.createSpan({ cls: 'termy-agent-cursor', text: '▍' });
  }
}

async function renderToolBlock(
  block: AgentToolBlock,
  container: HTMLElement,
  owner: Component,
  renderer: AgentSnapshotRenderer,
  t: LocalizeFn,
): Promise<void> {
  const card = container.createDiv({
    cls: `termy-agent-tool-card is-${block.toolKind} status-${block.status}`,
  });
  card.setAttribute('data-tool-call-id', block.toolCallId);

  const header = card.createDiv({ cls: 'termy-agent-tool-header' });
  header.createDiv({ cls: 'termy-agent-tool-title', text: block.title });
  if (block.subtitle) {
    header.createDiv({ cls: 'termy-agent-tool-subtitle', text: block.subtitle });
  }
  const statusEl = header.createDiv({
    cls: `termy-agent-tool-status status-${block.status}`,
    text: localizeToolStatus(block.status, t),
  });
  if (typeof block.exitCode === 'number') {
    statusEl.createSpan({
      cls: 'termy-agent-tool-exit-code',
      text: `exit ${block.exitCode}`,
    });
  }

  const body = card.createDiv({ cls: 'termy-agent-tool-body' });
  if (block.body) {
    const markdownEl = body.createDiv({ cls: 'markdown-rendered termy-agent-markdown' });
    await renderer.renderMarkdown(block.body, markdownEl, renderer.sourcePath, owner);
  }
  if (block.output) {
    const pre = body.createEl('pre', { cls: 'termy-agent-tool-output' });
    pre.createEl('code', { text: block.output });
  }
  if (block.diff) {
    const markdownEl = body.createDiv({ cls: 'markdown-rendered termy-agent-tool-diff' });
    const diffMarkdown = block.diff.path
      ? `\`${block.diff.path}\`\n\n\`\`\`diff\n${block.diff.unified}\n\`\`\``
      : `\`\`\`diff\n${block.diff.unified}\n\`\`\``;
    await renderer.renderMarkdown(diffMarkdown, markdownEl, renderer.sourcePath, owner);
  }
}

function renderErrorBlock(block: AgentErrorBlock, container: HTMLElement, t: LocalizeFn): void {
  const card = container.createDiv({ cls: 'termy-agent-error-card' });
  card.createDiv({ cls: 'termy-agent-error-title', text: t('agent.errorTitle') });
  card.createDiv({ cls: 'termy-agent-error-message', text: block.message });
  if (block.details) {
    const details = card.createEl('details', { cls: 'termy-agent-error-details' });
    details.createEl('summary', { text: t('agent.errorDetailsLabel') });
    details.createEl('pre').createEl('code', { text: block.details });
  }
}

function localizeToolStatus(status: AgentToolBlock['status'], t: LocalizeFn): string {
  switch (status) {
    case 'pending': return t('agent.toolStatusPending');
    case 'running': return t('agent.toolStatusRunning');
    case 'completed': return t('agent.toolStatusCompleted');
    case 'failed': return t('agent.toolStatusFailed');
    case 'cancelled': return t('agent.toolStatusCancelled');
    default: return status;
  }
}
