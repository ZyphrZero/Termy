import test from 'node:test';
import assert from 'node:assert/strict';

import { AgentOperationTracker } from './agentOperationTracker.ts';

test('AgentOperationTracker keeps an agent busy until every lease is released', () => {
  const tracker = new AgentOperationTracker();
  const first = tracker.acquire('claude-code');
  const second = tracker.acquire('claude-code');

  assert.equal(tracker.isIdle('claude-code'), false);
  first.release();
  assert.equal(tracker.isIdle('claude-code'), false);
  second.release();
  assert.equal(tracker.isIdle('claude-code'), true);
});

test('AgentOperationTracker rejects double release bugs explicitly', () => {
  const tracker = new AgentOperationTracker();
  const lease = tracker.acquire('opencode');

  lease.release();
  assert.throws(
    () => lease.release(),
    /released twice/,
  );
});
