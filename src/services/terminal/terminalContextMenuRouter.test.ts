import * as assert from 'node:assert/strict';
import test from 'node:test';

import { resolveTerminalContextMenuAction } from './terminalContextMenuRouter.ts';

test('plain shells keep showing the Termy context menu on right-click', () => {
  assert.equal(
    resolveTerminalContextMenuAction({ isClaudeCodeSession: false }),
    'menu',
  );
});

test('Claude Code sessions yield right-click to the TUI without pasting from Termy', () => {
  // Claude Code already pastes on right-click through xterm.js mouse tracking.
  // Termy must NOT also call pasteFromClipboard, otherwise the user sees the
  // paste happen twice. Returning 'suppress' tells the caller to drop the
  // menu and otherwise stay out of the way.
  assert.equal(
    resolveTerminalContextMenuAction({ isClaudeCodeSession: true }),
    'suppress',
  );
});

test('Shift+RightClick is a universal escape hatch back to the Termy menu', () => {
  for (const claudeActive of [false, true]) {
    assert.equal(
      resolveTerminalContextMenuAction({
        isClaudeCodeSession: claudeActive,
        event: { shiftKey: true },
      }),
      'menu',
      `claude=${claudeActive}`,
    );
  }
});
