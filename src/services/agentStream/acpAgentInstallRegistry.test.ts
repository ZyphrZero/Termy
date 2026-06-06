import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACP_AGENT_INSTALL_REGISTRY,
  getAcpAgentInstallEntry,
  getAcpInstallCommandForPlatform,
  isAcpAgentUsingRegistryCommand,
} from './acpAgentInstallRegistry.ts';
import { BUILT_IN_AGENTS } from './builtInAgents.ts';

test('ACP install registry maps built-in agents to direct adapter commands', () => {
  assert.deepEqual(
    ACP_AGENT_INSTALL_REGISTRY.map((entry) => ({
      agentId: entry.agentId,
      registryId: entry.registryId,
      command: entry.command,
      args: entry.args,
    })),
    [
      {
        agentId: 'claude-code',
        registryId: 'claude-acp',
        command: 'claude-code-acp',
        args: undefined,
      },
      {
        agentId: 'codex',
        registryId: 'codex-acp',
        command: 'codex-acp',
        args: undefined,
      },
      {
        agentId: 'opencode',
        registryId: 'opencode',
        command: 'opencode',
        args: ['acp'],
      },
    ],
  );
});

test('ACP install commands are manual installs, not runtime npx launchers', () => {
  for (const entry of ACP_AGENT_INSTALL_REGISTRY) {
    assert.notEqual(entry.command, 'npx');
    for (const command of Object.values(entry.installCommands)) {
      assert.ok(command);
      assert.ok(!/^npx(?:\s|$)/.test(command));
    }
  }
});

test('built-in defaults match ACP install registry launch commands', () => {
  for (const agent of BUILT_IN_AGENTS) {
    const entry = getAcpAgentInstallEntry(agent.id);
    assert.ok(entry, `missing install registry entry for ${agent.id}`);
    assert.equal(isAcpAgentUsingRegistryCommand(agent, entry), true);
  }
});

test('ACP install command lookup is platform-specific and explicit', () => {
  const entry = getAcpAgentInstallEntry('codex');
  assert.ok(entry);
  assert.equal(
    getAcpInstallCommandForPlatform(entry, 'win32'),
    'npm install -g @zed-industries/codex-acp',
  );
  assert.equal(getAcpInstallCommandForPlatform(entry, 'freebsd'), null);
});
