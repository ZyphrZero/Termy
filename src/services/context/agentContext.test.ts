import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAgentContextTerminalEnv,
  buildIdeBridgeTerminalEnv,
  renderTermyCodexSkill,
  CLAUDE_CODE_SSE_PORT_ENV,
  OPENCODE_EDITOR_SSE_PORT_ENV,
  TERMY_CODEX_SKILL_MANAGED_MARKER,
  TERMY_CODEX_SKILL_NAME,
  TERMY_CODEX_SKILL_RELATIVE_PATH,
  TERMY_CONTEXT_PATH_ENV,
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
