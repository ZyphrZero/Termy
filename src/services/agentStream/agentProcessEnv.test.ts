import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAgentProcessEnv } from './agentProcessEnv.ts';

test('buildAgentProcessEnv removes inherited NODE_OPTIONS from ACP children', () => {
  const env = buildAgentProcessEnv({
    PATH: '/usr/bin',
    NODE_OPTIONS: '--max-old-space-size=16',
  }, undefined);

  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.NODE_OPTIONS, undefined);
});

test('buildAgentProcessEnv removes inherited NODE_OPTIONS case-insensitively', () => {
  const env = buildAgentProcessEnv({
    PATH: '/usr/bin',
    Node_Options: '--max-old-space-size=16',
  }, undefined);

  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.Node_Options, undefined);
});

test('buildAgentProcessEnv preserves explicit agent NODE_OPTIONS override', () => {
  const env = buildAgentProcessEnv({
    PATH: '/usr/bin',
    NODE_OPTIONS: '--max-old-space-size=16',
  }, {
    NODE_OPTIONS: '--max-old-space-size=4096',
  });

  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.NODE_OPTIONS, '--max-old-space-size=4096');
});
