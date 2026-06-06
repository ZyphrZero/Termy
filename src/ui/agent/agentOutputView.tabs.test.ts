import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProviderTabs } from './agentProviderTabs.ts';

test('buildProviderTabs prepends Terminal without dropping ACP providers', () => {
  const tabs = buildProviderTabs({
    terminalProvider: {
      id: 'terminal',
      label: 'Terminal',
      icon: 'terminal',
      iconKind: 'lucide',
    },
    enabledAgents: [
      { id: 'claude-code', label: 'Claude Code', icon: 'claudecode' },
      { id: 'codex', label: 'Codex', icon: 'codex' },
      { id: 'opencode', label: 'OpenCode', icon: 'opencode' },
    ],
  });

  assert.deepEqual(
    tabs.map((tab) => tab.id),
    ['terminal', 'claude-code', 'codex', 'opencode'],
  );
});

test('buildProviderTabs keeps ACP-only mode available', () => {
  const tabs = buildProviderTabs({
    terminalProvider: null,
    enabledAgents: [
      { id: 'claude-code', label: 'Claude Code', icon: 'claudecode' },
    ],
  });

  assert.deepEqual(tabs, [
    { id: 'claude-code', label: 'Claude Code', icon: 'claudecode', iconKind: 'brand' },
  ]);
});
