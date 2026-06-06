import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CODEX_LAUNCH_COMMAND,
  DEFAULT_PRESET_SCRIPTS,
  HERMES_LAUNCH_COMMAND,
  OPENCODE_LAUNCH_COMMAND,
  isContextAwarePresetScript,
} from './settings.ts';

test('Codex built-in launcher starts Codex without prompt injection', () => {
  const codex = DEFAULT_PRESET_SCRIPTS.find((script) => script.id === 'codex');
  const launchAction = codex?.actions.find((action) => action.id === 'action-codex');

  assert.equal(CODEX_LAUNCH_COMMAND, 'codex');
  assert.equal(launchAction?.value, CODEX_LAUNCH_COMMAND);
});

test('OpenCode built-in launcher starts the IDE bridge client directly', () => {
  const openCode = DEFAULT_PRESET_SCRIPTS.find((script) => script.id === 'opencode');
  const launchAction = openCode?.actions.find((action) => action.id === 'action-opencode');

  assert.equal(OPENCODE_LAUNCH_COMMAND, 'opencode');
  assert.equal(launchAction?.value, OPENCODE_LAUNCH_COMMAND);
});

test('Hermes built-in launcher invokes the upstream `hermes` CLI', () => {
  const hermes = DEFAULT_PRESET_SCRIPTS.find((script) => script.id === 'hermes');
  const launchAction = hermes?.actions.find((action) => action.id === 'action-hermes');

  assert.equal(HERMES_LAUNCH_COMMAND, 'hermes');
  assert.equal(launchAction?.value, HERMES_LAUNCH_COMMAND);
});

test('built-in workflow order keeps Claude Code, Codex, OpenCode, and Hermes', () => {
  assert.deepEqual(
    DEFAULT_PRESET_SCRIPTS.map((script) => script.id),
    ['claude-code', 'codex', 'opencode', 'hermes'],
  );

  assert.equal(DEFAULT_PRESET_SCRIPTS[3]?.id, 'hermes');
});

test('built-in context-aware workflow marker covers IDE-bridge launchers only', () => {
  // Hermes does not consume Termy's IDE bridge or the vault-local Codex
  // skill yet, so it is intentionally excluded from the context-aware
  // marker until upstream documents an Obsidian context handoff.
  const contextAwareIds = DEFAULT_PRESET_SCRIPTS
    .filter((script) => isContextAwarePresetScript(script))
    .map((script) => script.id);

  assert.deepEqual(contextAwareIds, ['claude-code', 'codex', 'opencode']);
});
