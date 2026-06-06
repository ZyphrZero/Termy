import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildThreadPoolItems,
  isLiveAgentSession,
  mergeLiveAgentSessions,
  requireSessionCwd,
  upsertLiveAgentSession,
  type LiveAgentSession,
} from './agentProviderSessions.ts';

test('upsertLiveAgentSession prepends the live session and replaces duplicate ids', () => {
  const live: LiveAgentSession = {
    id: 'sess-live',
    title: 'Claude Code',
    updatedAt: 2000,
    live: true,
  };
  const result = upsertLiveAgentSession([
    { id: 'history-1', title: 'History', updatedAt: 1000 },
    { id: 'sess-live', title: 'Old row', updatedAt: 500 },
  ], live);

  assert.deepEqual(result, [
    live,
    { id: 'history-1', title: 'History', updatedAt: 1000 },
  ]);
});

test('mergeLiveAgentSessions keeps live sessions across history refreshes', () => {
  const live: LiveAgentSession = {
    id: 'sess-live',
    title: 'Claude Code',
    updatedAt: 2000,
    live: true,
  };
  const result = mergeLiveAgentSessions([
    live,
    { id: 'old-history', title: 'Old history', updatedAt: 1000 },
  ], [
    { id: 'sess-live', title: 'Persisted duplicate', updatedAt: 3000 },
    { id: 'new-history', title: 'New history', updatedAt: 2500 },
  ]);

  assert.deepEqual(result, [
    live,
    { id: 'new-history', title: 'New history', updatedAt: 2500 },
  ]);
});

test('isLiveAgentSession distinguishes live rows from persisted history', () => {
  const live: LiveAgentSession = {
    id: 'live',
    title: 'Live',
    updatedAt: 1,
    live: true,
  };

  assert.equal(isLiveAgentSession({ id: 'history', title: 'History' }), false);
  assert.equal(isLiveAgentSession(live), true);
});

test('buildThreadPoolItems merges providers into a sorted unified pool', () => {
  const items = buildThreadPoolItems({
    selectedProviderId: 'claude-code',
    untitledTitle: 'Untitled',
    getMeta: () => undefined,
    providers: [
      {
        providerId: 'terminal',
        providerLabel: 'Terminal',
        providerIcon: { kind: 'lucide', icon: 'terminal' },
        sessions: [{ id: 'term-1', title: 'Terminal 1', updatedAt: 1000 }],
        activeSessionId: 'term-1',
        live: true,
      },
      {
        providerId: 'claude-code',
        providerLabel: 'Claude Code',
        providerIcon: { kind: 'brand', icon: 'claudecode' },
        sessions: [{ id: 'claude-1', title: 'Claude 1', updatedAt: 2000 }],
        activeSessionId: 'claude-1',
      },
    ],
  });

  assert.deepEqual(items.map((item) => item.key), [
    'claude-code\u0000claude-1',
    'terminal\u0000term-1',
  ]);
  assert.equal(items[0].active, true);
  assert.equal(items[1].live, true);
});

test('buildThreadPoolItems applies rename metadata and hides archived threads', () => {
  const items = buildThreadPoolItems({
    selectedProviderId: 'opencode',
    untitledTitle: 'Untitled',
    getMeta: (providerId, threadId) => {
      if (providerId === 'opencode' && threadId === 'renamed') {
        return { providerId, threadId, title: 'Renamed thread' };
      }
      if (providerId === 'opencode' && threadId === 'archived') {
        return { providerId, threadId, archived: true };
      }
      return undefined;
    },
    providers: [
      {
        providerId: 'opencode',
        providerLabel: 'OpenCode',
        providerIcon: { kind: 'brand', icon: 'opencode' },
        sessions: [
          { id: 'renamed', title: 'Original', time: { updated: 3000 } },
          { id: 'archived', title: 'Archived', time: { updated: 4000 } },
        ],
        activeSessionId: 'renamed',
      },
    ],
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Renamed thread');
  assert.equal(items[0].updatedAt, 3000);
});

test('buildThreadPoolItems requires provider sessions to carry an update timestamp', () => {
  assert.throws(
    () => buildThreadPoolItems({
      selectedProviderId: null,
      untitledTitle: 'Untitled',
      getMeta: () => undefined,
      providers: [
        {
          providerId: 'claude-code',
          providerLabel: 'Claude Code',
          sessions: [{ id: 'missing-time', title: 'Missing time' }],
          activeSessionId: null,
        },
      ],
    }),
    /missing updatedAt/,
  );
});

test('requireSessionCwd reads the imported thread cwd for ACP session restore', () => {
  assert.equal(
    requireSessionCwd([
      { id: 'history-1', title: 'History', cwd: '/workspace/project', updatedAt: 1 },
    ], 'history-1'),
    '/workspace/project',
  );
});

test('requireSessionCwd exposes missing cwd instead of using a different working directory', () => {
  assert.throws(
    () => requireSessionCwd([
      { id: 'history-1', title: 'History', updatedAt: 1 },
    ], 'history-1'),
    /missing cwd/,
  );
});
