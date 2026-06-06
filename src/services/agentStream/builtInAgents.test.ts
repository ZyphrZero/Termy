import test from 'node:test';
import assert from 'node:assert/strict';

import { BUILT_IN_AGENTS } from './builtInAgents.ts';

test('built-in ACP agents run installed commands directly', () => {
  assert.deepEqual(
    BUILT_IN_AGENTS.map((agent) => ({
      id: agent.id,
      command: agent.command,
      args: agent.args,
    })),
    [
      { id: 'claude-code', command: 'claude-code-acp', args: undefined },
      { id: 'codex', command: 'codex-acp', args: undefined },
      { id: 'opencode', command: 'opencode', args: ['acp'] },
    ],
  );
});

test('built-in ACP agents do not use npx runtime launchers', () => {
  assert.equal(BUILT_IN_AGENTS.some((agent) => agent.command === 'npx'), false);
});
