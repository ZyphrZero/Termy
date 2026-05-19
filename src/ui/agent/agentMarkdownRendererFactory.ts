/**
 * Production wiring of the snapshot renderer to Obsidian's built-in
 * Markdown engine. Factored out so {@link AgentOutputView} can be
 * unit-tested with a fake renderer that does not depend on Obsidian.
 *
 * The renderer is created per-view: it captures the owning view's
 * `App` once so `MarkdownRenderer.render` does not need to be passed
 * one on every call.
 */

import type { App } from 'obsidian';
import { MarkdownRenderer } from 'obsidian';

import type {
  AgentSnapshotRenderer,
} from './agentMarkdownRenderer';
import { t } from '../../i18n';

const SOURCE_PATH = '';

/**
 * Build a snapshot renderer bound to the given Obsidian `App`. The
 * caller (typically `AgentOutputView`) passes itself as the
 * `Component` owner when the renderer fires `renderMarkdown`.
 */
export function createAgentSnapshotRenderer(app: App): AgentSnapshotRenderer {
  return {
    sourcePath: SOURCE_PATH,
    localize: (key, params) => t(key, params),
    renderMarkdown: async (markdown, target, sourcePath, owner) => {
      await MarkdownRenderer.render(app, markdown, target, sourcePath, owner);
    },
  };
}
