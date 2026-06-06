import test from 'node:test';
import assert from 'node:assert/strict';

import { applyDefaults } from './settingsDefaults.ts';
import type { AgentConfig } from '../services/agentStream/agentConfig.ts';

test('applyDefaults normalizes built-in ACP agents away from old npx commands', () => {
  const loadedAgent: AgentConfig = {
    id: 'claude-code',
    label: 'Claude Code',
    command: 'npx',
    args: ['--yes', '@zed-industries/claude-code-acp'],
    enabled: true,
    isBuiltIn: true,
    rememberPermissions: true,
  };

  const settings = applyDefaults({ agents: [loadedAgent] });
  assert.deepEqual(
    settings.agents.map((agent) => ({
      id: agent.id,
      command: agent.command,
      args: agent.args,
    })),
    [
      {
        id: 'claude-code',
        command: 'claude-code-acp',
        args: undefined,
      },
    ],
  );
});
