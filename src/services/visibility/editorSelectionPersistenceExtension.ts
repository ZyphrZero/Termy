/**
 * CodeMirror 6 extension that keeps the user's selection visible after
 * focus moves from the editor to a Termy terminal.
 *
 * xterm.js focuses its hidden helper textarea on every terminal click,
 * which makes Chromium collapse the document selection. Obsidian's CM6
 * editors render their selection through the browser's native
 * `::selection` pseudo-class (rather than the drawn `.cm-selectionLayer`
 * background), so the highlight disappears even though
 * `EditorState.selection` is unchanged.
 *
 * To restore the visual cue we paint our own decoration over each
 * non-empty selection range. The decoration is rendered with class
 * `termy-persisted-selection`; CSS in `styles.css` only colours it when
 * the editor is unfocused (`.cm-editor:not(.cm-focused)`), so an active
 * editor still uses the native selection rendering.
 *
 * The extension is registered globally (via `registerEditorExtension`)
 * but the CSS that gives it a background is gated behind
 * `body.termy-preserve-editor-selection`, which the plugin only sets
 * while at least one Termy terminal leaf is open. That keeps the
 * effect off in vaults that have Termy installed but no terminal
 * currently shown.
 */

import type { Extension } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';

const persistedSelectionDecoration = Decoration.mark({
  class: 'termy-persisted-selection',
});

function buildDecorations(view: EditorView): DecorationSet {
  const ranges = view.state.selection.ranges
    .filter((range) => !range.empty)
    .map((range) => persistedSelectionDecoration.range(range.from, range.to));
  return Decoration.set(ranges, true);
}

export function createEditorSelectionPersistenceExtension(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view);
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
          this.decorations = buildDecorations(update.view);
        }
      }
    },
    {
      decorations: (plugin) => plugin.decorations,
    },
  );
}
