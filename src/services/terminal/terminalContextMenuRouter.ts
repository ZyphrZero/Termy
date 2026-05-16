/**
 * Right-click routing for the terminal pane.
 *
 * Some TUIs — notably Claude Code — treat the right mouse button as
 * "paste from clipboard". Termy historically intercepts every contextmenu
 * event to show its own menu, which steals that gesture. This module owns
 * the small policy that decides what should happen for a given right-click.
 */

/** Subset of `MouseEvent` fields the policy actually reads. */
export interface TerminalContextMenuEventLike {
  shiftKey?: boolean;
}

export interface TerminalContextMenuContext {
  /** Whether the active terminal session is currently driving Claude Code TUI. */
  isClaudeCodeSession: boolean;
  /** The triggering mouse event (or a stub for tests). */
  event?: TerminalContextMenuEventLike;
}

/**
 * Possible outcomes for a right-click on the terminal surface:
 * - `'menu'`     : show Termy's context menu (the historical default).
 * - `'suppress'` : do not show Termy's menu and do not paste either. The
 *                  expected caller is a TUI like Claude Code that already
 *                  handles right-click on its own through xterm.js's mouse
 *                  tracking mode; Termy just steps out of the way so the
 *                  TUI's gesture is not duplicated by a DOM-level paste.
 */
export type TerminalContextMenuAction = 'menu' | 'suppress';

/**
 * Pick the right-click outcome for a terminal click.
 *
 * Rules:
 * - `Shift+RightClick` is the universal escape hatch back to the menu so
 *   copy/clear/etc. stay reachable even while a TUI owns plain right-click.
 *   xterm.js does not forward shift-modified clicks to the TUI when mouse
 *   tracking is on, so this does not collide with Claude Code's own paste.
 * - Otherwise, an active Claude Code session yields right-click to the TUI;
 *   every other shell keeps Termy's menu.
 */
export function resolveTerminalContextMenuAction(
  context: TerminalContextMenuContext,
): TerminalContextMenuAction {
  if (context.event?.shiftKey) {
    return 'menu';
  }

  return context.isClaudeCodeSession ? 'suppress' : 'menu';
}
