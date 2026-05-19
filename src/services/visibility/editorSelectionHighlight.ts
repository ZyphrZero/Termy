/**
 * Manages the `termy-preserve-editor-selection` body class that gates
 * the CSS rule keeping the editor selection visible when focus moves
 * to a Termy terminal.
 *
 * xterm.js focuses its hidden helper textarea on every terminal click,
 * which makes Chromium collapse `window.getSelection()` and CM6 hide
 * the `.cm-selectionLayer` background once `.cm-focused` is removed.
 * The CM6 `EditorState.selection` itself is unchanged, so the selection
 * is purely a visual artifact — the matching rule in `styles.css`
 * (`.cm-editor:not(.cm-focused) .cm-selectionLayer .cm-selectionBackground`)
 * restores the rectangle.
 *
 * The class is only applied while at least one terminal leaf is open in
 * the workspace, so vaults / sessions that never use Termy never see
 * the rule, and removing the class on plugin unload cleans up after us.
 */

import type { App } from 'obsidian';

const BODY_CLASS = 'termy-preserve-editor-selection';

export class EditorSelectionHighlightManager {
  private readonly app: App;
  private readonly terminalViewType: string;

  constructor(app: App, terminalViewType: string) {
    this.app = app;
    this.terminalViewType = terminalViewType;
  }

  /**
   * Reflect the current workspace state onto the body class. Safe to
   * call from plugin onload (before layout ready) and from
   * `layout-change` callbacks.
   */
  syncBodyClass(): void {
    const hasTerminalLeaf =
      this.app.workspace.getLeavesOfType(this.terminalViewType).length > 0;

    for (const document of this.collectDocuments()) {
      document.body.classList.toggle(BODY_CLASS, hasTerminalLeaf);
    }
  }

  /**
   * Remove the marker class everywhere — used during plugin unload so
   * we never leave the class behind on a vault that has uninstalled
   * Termy.
   */
  removeBodyClass(): void {
    for (const document of this.collectDocuments()) {
      document.body.classList.remove(BODY_CLASS);
    }
  }

  /**
   * Walk every workspace container so popout windows and detached
   * always-on-top windows stay in sync, mirroring how
   * `updateAlwaysOnTopTabBadges` already iterates over leaves to fan
   * out across multiple host documents.
   */
  private collectDocuments(): Set<Document> {
    const documents = new Set<Document>();
    documents.add(activeDocument);

    for (const leaf of this.app.workspace.getLeavesOfType(this.terminalViewType)) {
      const document = leaf.view?.containerEl?.ownerDocument;
      if (document) {
        documents.add(document);
      }
    }

    return documents;
  }
}
