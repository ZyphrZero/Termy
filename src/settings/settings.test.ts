import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CODEX_LAUNCH_COMMAND,
  DEFAULT_PRESET_SCRIPTS,
  DEFAULT_TERMINAL_SETTINGS,
  HERMES_LAUNCH_COMMAND,
  OPENCODE_LAUNCH_COMMAND,
  PI_LAUNCH_COMMAND,
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

test('Pi built-in launcher invokes the upstream `pi` CLI', () => {
  const pi = DEFAULT_PRESET_SCRIPTS.find((script) => script.id === 'pi');
  const launchAction = pi?.actions.find((action) => action.id === 'action-pi');

  assert.equal(PI_LAUNCH_COMMAND, 'pi');
  assert.equal(launchAction?.value, PI_LAUNCH_COMMAND);
  assert.equal(pi?.icon, 'pi');
  assert.equal(pi?.showInStatusBar, true);
  assert.equal(pi?.showInCommandPalette, true);
});

test('built-in workflow order keeps Claude Code, Codex, OpenCode, Hermes, and Pi', () => {
  assert.deepEqual(
    DEFAULT_PRESET_SCRIPTS.map((script) => script.id),
    ['claude-code', 'codex', 'opencode', 'hermes', 'pi'],
  );

  assert.equal(DEFAULT_PRESET_SCRIPTS[4]?.id, 'pi');
});

test('built-in context-aware workflow marker covers IDE-bridge launchers only', () => {
  // Keep the context-aware marker limited to integrations Termy configures.
  const contextAwareIds = DEFAULT_PRESET_SCRIPTS
    .filter((script) => isContextAwarePresetScript(script))
    .map((script) => script.id);

  assert.deepEqual(contextAwareIds, ['claude-code', 'codex', 'opencode']);
});

test('AI launcher update checks require opt-in by default', () => {
  assert.equal(DEFAULT_TERMINAL_SETTINGS.checkAiLauncherUpdates, false);
});
