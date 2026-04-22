import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildClaudeCodeTerminalEnv,
  buildCodexCliDesiredArgs,
  buildCodexCliTerminalEnv,
  CLAUDE_CODE_SSE_PORT_ENV,
  CODEX_IDE_CONTEXT_PATH_ENV,
  CODEX_IDE_CONTEXT_PROMPT_PATH_ENV,
  codexMcpConfigMatches,
} from './agentContext.ts';

test('buildClaudeCodeTerminalEnv only exposes the Claude bridge port when available', () => {
  assert.deepEqual(buildClaudeCodeTerminalEnv(null), {});
  assert.deepEqual(buildClaudeCodeTerminalEnv(4312), {
    [CLAUDE_CODE_SSE_PORT_ENV]: '4312',
  });
});

test('buildCodexCliTerminalEnv exposes the Codex context snapshot and prompt paths', () => {
  assert.deepEqual(
    buildCodexCliTerminalEnv('/tmp/ide-context.json', '/tmp/ide-context-prompt.md'),
    {
      [CODEX_IDE_CONTEXT_PATH_ENV]: '/tmp/ide-context.json',
      [CODEX_IDE_CONTEXT_PROMPT_PATH_ENV]: '/tmp/ide-context-prompt.md',
    },
  );
});

test('buildCodexCliDesiredArgs keeps the stdio MCP launch contract stable', () => {
  assert.deepEqual(buildCodexCliDesiredArgs('/tmp/ide-context.json'), [
    '--mcp',
    '--snapshot-file',
    '/tmp/ide-context.json',
  ]);
});

test('codexMcpConfigMatches requires the expected stdio command and argument order', () => {
  const desiredArgs = buildCodexCliDesiredArgs('/tmp/ide-context.json');
  const matchingConfig = {
    enabled: true,
    transport: {
      type: 'stdio',
      command: '/plugin/binaries/termy-server-linux-x64',
      args: desiredArgs,
    },
  };

  assert.equal(
    codexMcpConfigMatches(
      matchingConfig,
      '/plugin/binaries/termy-server-linux-x64',
      desiredArgs,
    ),
    true,
  );
  assert.equal(
    codexMcpConfigMatches(
      {
        ...matchingConfig,
        transport: {
          ...matchingConfig.transport,
          args: [...desiredArgs].reverse(),
        },
      },
      '/plugin/binaries/termy-server-linux-x64',
      desiredArgs,
    ),
    false,
  );
  assert.equal(
    codexMcpConfigMatches(
      {
        ...matchingConfig,
        transport: {
          ...matchingConfig.transport,
          command: '/plugin/binaries/other',
        },
      },
      '/plugin/binaries/termy-server-linux-x64',
      desiredArgs,
    ),
    false,
  );
});
