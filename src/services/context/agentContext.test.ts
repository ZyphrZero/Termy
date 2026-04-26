import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAgentContextTerminalEnv,
  buildClaudeCodeTerminalEnv,
  CLAUDE_CODE_SSE_PORT_ENV,
  TERMY_CONTEXT_INSTRUCTIONS_PATH_ENV,
  TERMY_CONTEXT_PATH_ENV,
} from './agentContext.ts';

test('buildClaudeCodeTerminalEnv only exposes the Claude bridge port when available', () => {
  assert.deepEqual(buildClaudeCodeTerminalEnv(null), {});
  assert.deepEqual(buildClaudeCodeTerminalEnv(4312), {
    [CLAUDE_CODE_SSE_PORT_ENV]: '4312',
  });
});

test('buildAgentContextTerminalEnv exposes generic context paths', () => {
  assert.deepEqual(
    buildAgentContextTerminalEnv('/tmp/ide-context.json', '/tmp/ide-context-instructions.md'),
    {
      [TERMY_CONTEXT_PATH_ENV]: '/tmp/ide-context.json',
      [TERMY_CONTEXT_INSTRUCTIONS_PATH_ENV]: '/tmp/ide-context-instructions.md',
    },
  );
});
