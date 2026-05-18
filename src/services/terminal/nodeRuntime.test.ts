import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildNodeRuntimeEnvironment,
  buildNpmPackageInstallCommand,
  createEmptyRuntimeCommandInfo,
  getNpmCandidatePathsForNodePath,
  getNodeRuntimeRecommendation,
} from './nodeRuntime.ts';
import type { NodeRuntimeSnapshot } from './nodeRuntime.ts';

function snapshot(
  nodeAvailability: 'ready' | 'not-installed' | 'unknown',
  npmAvailability: 'ready' | 'not-installed' | 'unknown',
): NodeRuntimeSnapshot {
  return {
    node: { ...createEmptyRuntimeCommandInfo('node'), availability: nodeAvailability },
    npm: { ...createEmptyRuntimeCommandInfo('npm'), availability: npmAvailability },
    customNodePath: null,
  };
}

test('runtime recommendation prefers npm when it is already available', () => {
  assert.equal(
    getNodeRuntimeRecommendation(snapshot('ready', 'ready')),
    'npm-ready',
  );
});

test('runtime recommendation reports node-missing when neither node nor npm is on PATH', () => {
  assert.equal(
    getNodeRuntimeRecommendation(snapshot('not-installed', 'not-installed')),
    'node-missing',
  );
});

test('runtime recommendation stays unknown for inconclusive probes', () => {
  assert.equal(
    getNodeRuntimeRecommendation(snapshot('unknown', 'not-installed')),
    'unknown',
  );
});

test('buildNpmPackageInstallCommand installs a global package through npm', () => {
  assert.equal(
    buildNpmPackageInstallCommand('@openai/codex'),
    'npm install -g @openai/codex',
  );
});

test('buildNpmPackageInstallCommand uses custom npm path when available', () => {
  const runtime = snapshot('ready', 'ready');
  runtime.npm.path = '/opt/node/bin/npm';
  runtime.customNodePath = '/opt/node/bin/node';

  assert.equal(
    buildNpmPackageInstallCommand('@openai/codex', runtime),
    '/opt/node/bin/npm install -g @openai/codex',
  );
});

test('getNpmCandidatePathsForNodePath returns sibling npm path candidates', () => {
  if (process.platform === 'win32') {
    assert.deepEqual(
      getNpmCandidatePathsForNodePath('C:\\nodejs\\node.exe'),
      ['C:\\nodejs\\npm.cmd', 'C:\\nodejs\\npm.exe', 'C:\\nodejs\\npm'],
    );
  } else {
    assert.deepEqual(
      getNpmCandidatePathsForNodePath('/opt/node/bin/node'),
      ['/opt/node/bin/npm'],
    );
  }
});

test('buildNodeRuntimeEnvironment prepends custom node and npm directories to PATH', () => {
  const runtime = snapshot('ready', 'ready');
  runtime.node.path = '/opt/node/bin/node';
  runtime.npm.path = '/opt/node/bin/npm';
  runtime.customNodePath = '/opt/node/bin/node';

  const env = buildNodeRuntimeEnvironment(runtime, { PATH: '/usr/bin' });
  const delimiter = process.platform === 'win32' ? ';' : ':';
  assert.equal(env.PATH, `/opt/node/bin${delimiter}/usr/bin`);
});

test('buildNodeRuntimeEnvironment returns empty PATH when no custom node path and no enriched PATH cached', () => {
  // The enriched-shell-env cache is module-local in production. In
  // the test environment it has never been warmed, so the helper
  // must behave as a no-op.
  const runtime = snapshot('not-installed', 'not-installed');
  const env = buildNodeRuntimeEnvironment(runtime, { PATH: '/usr/bin' });
  assert.equal(env.PATH, undefined);
});
