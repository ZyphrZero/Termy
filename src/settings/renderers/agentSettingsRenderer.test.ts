import test from 'node:test';
import assert from 'node:assert/strict';

import type { AgentConfig } from '../../services/agentStream/agentConfig.ts';
import { getCustomAgentSettingsRows } from '../agentSettingsRows.ts';

test('custom agent settings rows exclude built-in ACP agents', () => {
  const agents: AgentConfig[] = [
    {
      id: 'claude-code',
      label: 'Claude Code',
      command: 'claude-code-acp',
      enabled: true,
      isBuiltIn: true,
    },
    {
      id: 'custom-acp',
      label: 'Custom ACP',
      command: 'custom-acp',
      enabled: true,
      isBuiltIn: false,
    },
  ];

  assert.deepEqual(
    getCustomAgentSettingsRows(agents).map((agent) => agent.id),
    ['custom-acp'],
  );
});
