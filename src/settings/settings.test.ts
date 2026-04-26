import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_PRESET_SCRIPTS,
  OPENCODE_LAUNCH_COMMAND,
  isContextAwarePresetScript,
  normalizePresetScriptsByCurrentDefaults,
} from './settings.ts';

test('OpenCode built-in launcher starts the IDE bridge client directly', () => {
  const openCode = DEFAULT_PRESET_SCRIPTS.find((script) => script.id === 'opencode');
  const launchAction = openCode?.actions.find((action) => action.id === 'action-opencode');

  assert.equal(OPENCODE_LAUNCH_COMMAND, 'opencode');
  assert.equal(launchAction?.value, OPENCODE_LAUNCH_COMMAND);
});

test('built-in workflow order keeps OpenCode third and Gemini fourth', () => {
  assert.deepEqual(
    DEFAULT_PRESET_SCRIPTS.map((script) => script.id),
    ['claude-code', 'codex', 'opencode', 'gemini-cli'],
  );

  assert.equal(DEFAULT_PRESET_SCRIPTS[2]?.id, 'opencode');
  assert.equal(DEFAULT_PRESET_SCRIPTS[3]?.icon, 'gemini');
});

test('built-in context-aware workflow marker excludes Gemini', () => {
  const contextAwareIds = DEFAULT_PRESET_SCRIPTS
    .filter((script) => isContextAwarePresetScript(script))
    .map((script) => script.id);

  assert.deepEqual(contextAwareIds, ['claude-code', 'codex', 'opencode']);
});

test('built-in workflow order is canonicalized around custom workflows', () => {
  const customScript = {
    ...DEFAULT_PRESET_SCRIPTS[0],
    id: 'custom-workflow',
    name: 'Custom workflow',
  };
  const unorderedScripts = [
    findDefaultPresetScript('gemini-cli'),
    customScript,
    findDefaultPresetScript('opencode'),
    findDefaultPresetScript('codex'),
    findDefaultPresetScript('claude-code'),
  ];

  assert.deepEqual(
    normalizePresetScriptsByCurrentDefaults(unorderedScripts).map((script) => script.id),
    ['claude-code', 'custom-workflow', 'codex', 'opencode', 'gemini-cli'],
  );
});

test('current built-in workflow order stays unchanged', () => {
  const currentOrder = [
    findDefaultPresetScript('claude-code'),
    findDefaultPresetScript('codex'),
    findDefaultPresetScript('opencode'),
    findDefaultPresetScript('gemini-cli'),
  ];

  assert.deepEqual(
    normalizePresetScriptsByCurrentDefaults(currentOrder).map((script) => script.id),
    ['claude-code', 'codex', 'opencode', 'gemini-cli'],
  );
});

test('built-in workflow commands are sourced from current defaults', () => {
  const staleOpenCode = {
    ...findDefaultPresetScript('opencode'),
    icon: 'terminal',
    actions: [
      {
        id: 'action-opencode',
        type: 'terminal-command' as const,
        value: 'opencode --stale-context',
        enabled: true,
        note: 'stale command',
      },
    ],
    showInStatusBar: false,
  };
  const [normalizedOpenCode] = normalizePresetScriptsByCurrentDefaults([staleOpenCode]);
  const launchAction = normalizedOpenCode?.actions.find((action) => action.id === 'action-opencode');

  assert.equal(normalizedOpenCode?.icon, 'opencode');
  assert.equal(normalizedOpenCode?.showInStatusBar, false);
  assert.equal(launchAction?.value, OPENCODE_LAUNCH_COMMAND);
});

function findDefaultPresetScript(scriptId: string) {
  const script = DEFAULT_PRESET_SCRIPTS.find((item) => item.id === scriptId);
  assert.ok(script);
  return script;
}
