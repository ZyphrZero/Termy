import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CODEX_LAUNCH_COMMAND,
  DEEPSEEK_TUI_LAUNCH_COMMAND,
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

test('DeepSeek TUI built-in launcher invokes the upstream `deepseek` dispatcher', () => {
  const deepseek = DEFAULT_PRESET_SCRIPTS.find((script) => script.id === 'deepseek-tui');
  const launchAction = deepseek?.actions.find((action) => action.id === 'action-deepseek-tui');

  // The DeepSeek TUI npm package is `deepseek-tui`, but the dispatcher
  // binary it exposes on PATH is named `deepseek`. We call the
  // dispatcher directly so we go through the documented entry point.
  assert.equal(DEEPSEEK_TUI_LAUNCH_COMMAND, 'deepseek');
  assert.equal(launchAction?.value, DEEPSEEK_TUI_LAUNCH_COMMAND);
});

test('built-in workflow order keeps Claude Code, Codex, OpenCode, Hermes, and DeepSeek TUI', () => {
  assert.deepEqual(
    DEFAULT_PRESET_SCRIPTS.map((script) => script.id),
    ['claude-code', 'codex', 'opencode', 'hermes', 'deepseek-tui'],
  );

  assert.equal(DEFAULT_PRESET_SCRIPTS[4]?.id, 'deepseek-tui');
});

test('built-in context-aware workflow marker covers IDE-bridge launchers only', () => {
  // Hermes and DeepSeek TUI do not consume Termy's IDE bridge or the
  // vault-local Codex skill yet, so they are intentionally excluded
  // from the context-aware marker until upstream documents an
  // Obsidian context handoff.
  const contextAwareIds = DEFAULT_PRESET_SCRIPTS
    .filter((script) => isContextAwarePresetScript(script))
    .map((script) => script.id);

  assert.deepEqual(contextAwareIds, ['claude-code', 'codex', 'opencode']);
});
