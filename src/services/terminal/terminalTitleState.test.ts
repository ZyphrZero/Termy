import * as assert from 'node:assert/strict';
import test from 'node:test';

import { TerminalTitleState } from './terminalTitleState.ts';

test('TerminalTitleState applies automatic titles for default terminals', () => {
  const state = new TerminalTitleState('Terminal');

  assert.equal(state.getTitle(), 'Terminal');
  assert.equal(state.setAutomaticTitle('Claude Code'), true);
  assert.equal(state.getTitle(), 'Claude Code');
});

test('TerminalTitleState restores the previous title after automatic title clears', () => {
  const state = new TerminalTitleState('Terminal');

  state.setAutomaticTitle('Claude Code');

  assert.equal(state.clearAutomaticTitle(), true);
  assert.equal(state.getTitle(), 'Terminal');
});

test('TerminalTitleState does not override custom titles with automatic titles', () => {
  const state = new TerminalTitleState('Terminal');

  state.setCustomTitle('Pinned Claude Session');

  assert.equal(state.setAutomaticTitle('Claude Code'), false);
  assert.equal(state.getTitle(), 'Pinned Claude Session');
});

test('TerminalTitleState replaces automatic titles with custom titles', () => {
  const state = new TerminalTitleState('Terminal');

  state.setAutomaticTitle('Claude Code');
  assert.equal(state.setCustomTitle('Claude Scratch'), true);
  assert.equal(state.clearAutomaticTitle(), false);
  assert.equal(state.getTitle(), 'Claude Scratch');
});

test('TerminalTitleState applies process titles as automatic titles', () => {
  const state = new TerminalTitleState('Terminal');

  assert.equal(state.setProcessTitle(' npm test '), true);
  assert.equal(state.getTitle(), 'npm test');
  assert.equal(state.clearAutomaticTitle(), true);
  assert.equal(state.getTitle(), 'Terminal');
});

test('TerminalTitleState ignores blank process titles', () => {
  const state = new TerminalTitleState('Terminal');

  assert.equal(state.setProcessTitle('   '), false);
  assert.equal(state.getTitle(), 'Terminal');
});
