import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAgentContextTerminalEnv,
  buildIdeBridgeTerminalEnv,
  renderTermyCodexSkill,
  renderTermyDeepSeekSkill,
  serializeAgentContextSnapshotState,
  CLAUDE_CODE_SSE_PORT_ENV,
  OPENCODE_EDITOR_SSE_PORT_ENV,
  TERMY_CODEX_SKILL_MANAGED_MARKER,
  TERMY_CODEX_SKILL_NAME,
  TERMY_CODEX_SKILL_RELATIVE_PATH,
  TERMY_CONTEXT_PATH_ENV,
  TERMY_DEEPSEEK_SKILL_MANAGED_MARKER,
  TERMY_DEEPSEEK_SKILL_NAME,
  TERMY_DEEPSEEK_SKILL_RELATIVE_PATH,
} from './agentContext.ts';

test('buildIdeBridgeTerminalEnv exposes compatible IDE bridge ports when available', () => {
  assert.deepEqual(buildIdeBridgeTerminalEnv(null), {});
  assert.deepEqual(buildIdeBridgeTerminalEnv(4312), {
    [CLAUDE_CODE_SSE_PORT_ENV]: '4312',
    [OPENCODE_EDITOR_SSE_PORT_ENV]: '4312',
  });
});

test('buildAgentContextTerminalEnv exposes the context snapshot path', () => {
  assert.deepEqual(buildAgentContextTerminalEnv('/tmp/ide-context.json'), {
    [TERMY_CONTEXT_PATH_ENV]: '/tmp/ide-context.json',
  });
});

test('renderTermyCodexSkill emits a discoverable managed Codex skill', () => {
  const skill = renderTermyCodexSkill();

  assert.match(skill, new RegExp(`^---\\nname: ${TERMY_CODEX_SKILL_NAME}\\n`));
  assert.match(skill, /description: Use when a Codex session launched from the Termy Obsidian plugin needs/);
  assert.ok(skill.includes(`\`${TERMY_CONTEXT_PATH_ENV}\``));
  assert.ok(skill.includes(TERMY_CODEX_SKILL_MANAGED_MARKER));
  assert.equal(TERMY_CODEX_SKILL_RELATIVE_PATH, `.agents/skills/${TERMY_CODEX_SKILL_NAME}/SKILL.md`);
});

test('serializeAgentContextSnapshotState ignores updatedAt for write change detection', () => {
  const snapshot = {
    schemaVersion: 1,
    source: 'termy',
    updatedAt: '2026-04-27T00:00:00.000Z',
    vaultRoot: '/vault',
    workspaceFolders: ['/vault'],
    activeFile: null,
    openFiles: [],
    selection: null,
  };

  assert.equal(
    serializeAgentContextSnapshotState(snapshot),
    serializeAgentContextSnapshotState({
      ...snapshot,
      updatedAt: '2026-04-27T00:00:01.000Z',
    })
  );

  assert.notEqual(
    serializeAgentContextSnapshotState(snapshot),
    serializeAgentContextSnapshotState({
      ...snapshot,
      selection: {
        text: 'selected text',
        isEmpty: false,
        from: { line: 0, ch: 0, offset: 0 },
        to: { line: 0, ch: 13, offset: 13 },
      },
    })
  );
});

test('renderTermyDeepSeekSkill emits a discoverable managed DeepSeek skill with absolute path', () => {
  const contextPath = 'C:\\Users\\example\\AppData\\Local\\Obsidian\\plugins\\termy\\agent-context\\obsidian-context.json';
  const skill = renderTermyDeepSeekSkill(contextPath);

  assert.match(skill, new RegExp(`^---\\nname: ${TERMY_DEEPSEEK_SKILL_NAME}\\n`));
  assert.match(skill, /description: Use when a DeepSeek TUI session launched from the Termy Obsidian plugin needs/);
  assert.ok(skill.includes(contextPath), 'skill should embed the absolute context file path');
  assert.ok(skill.includes(TERMY_DEEPSEEK_SKILL_MANAGED_MARKER));
  assert.ok(skill.includes('read_file'), 'skill should mention read_file as the preferred access method');
  assert.equal(TERMY_DEEPSEEK_SKILL_RELATIVE_PATH, `.deepseek/skills/${TERMY_DEEPSEEK_SKILL_NAME}/SKILL.md`);
});
