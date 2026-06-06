import test from 'node:test';
import assert from 'node:assert/strict';

import type { AgentConfig } from './agentConfig.ts';
import { validateAgentConfig } from './agentConfig.ts';

test('validateAgentConfig rejects npx as an ACP runtime command', () => {
  const config: AgentConfig = {
    id: 'custom-agent',
    label: 'Custom Agent',
    command: 'npx',
    enabled: true,
    isBuiltIn: false,
  };

  const validation = validateAgentConfig(config, []);
  assert.equal(validation.ok, false);
  assert.deepEqual(
    validation.errors.map((error) => error.messageKey),
    ['agent.error.commandNpx'],
  );
});
