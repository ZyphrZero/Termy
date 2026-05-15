import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getAlwaysOnTopTerminalLabelKey,
  getAlwaysOnTopTerminalMenuState,
} from './alwaysOnTopTerminalDisplay.ts';

test('always-on-top menu label reflects the current terminal state', () => {
  assert.equal(
    getAlwaysOnTopTerminalLabelKey(getAlwaysOnTopTerminalMenuState(false, false)),
    'terminal.contextMenu.pinToTop',
  );
  assert.equal(
    getAlwaysOnTopTerminalLabelKey(getAlwaysOnTopTerminalMenuState(true, true)),
    'terminal.contextMenu.restorePinnedTerminal',
  );
  assert.equal(
    getAlwaysOnTopTerminalLabelKey(getAlwaysOnTopTerminalMenuState(true, false)),
    'terminal.contextMenu.focusPinnedTerminal',
  );
});
