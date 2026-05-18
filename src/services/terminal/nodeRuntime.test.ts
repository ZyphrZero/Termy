import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildNodeRuntimeEnvironment,
  buildFnmPackageInstallCommand,
  buildNpmPackageInstallCommand,
  createEmptyRuntimeCommandInfo,
  getFnmBootstrapCommandForPlatform,
  getNpmCandidatePathsForNodePath,
  getNodeRuntimeRecommendation,
} from './nodeRuntime.ts';
import type { NodeRuntimeSnapshot } from './nodeRuntime.ts';

function snapshot(
  nodeAvailability: 'ready' | 'not-installed' | 'unknown',
  npmAvailability: 'ready' | 'not-installed' | 'unknown',
  fnmAvailability: 'ready' | 'not-installed' | 'unknown',
): NodeRuntimeSnapshot {
  return {
    node: { ...createEmptyRuntimeCommandInfo('node'), availability: nodeAvailability },
    npm: { ...createEmptyRuntimeCommandInfo('npm'), availability: npmAvailability },
    fnm: { ...createEmptyRuntimeCommandInfo('fnm'), availability: fnmAvailability },
    fnmCurrent: null,
    customNodePath: null,
  };
}

test('runtime recommendation prefers npm when it is already available', () => {
  assert.equal(
    getNodeRuntimeRecommendation(snapshot('ready', 'ready', 'ready')),
    'npm-ready',
  );
});

test('runtime recommendation uses fnm when npm is missing but fnm exists', () => {
  assert.equal(
    getNodeRuntimeRecommendation(snapshot('not-installed', 'not-installed', 'ready')),
    'fnm-ready',
  );
});

test('runtime recommendation asks for fnm when node npm and fnm are all missing', () => {
  assert.equal(
    getNodeRuntimeRecommendation(snapshot('not-installed', 'not-installed', 'not-installed')),
    'fnm-missing',
  );
});

test('runtime recommendation stays unknown for inconclusive probes', () => {
  assert.equal(
    getNodeRuntimeRecommendation(snapshot('unknown', 'not-installed', 'not-installed')),
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
  const runtime = snapshot('ready', 'ready', 'unknown');
  runtime.npm.path = '/opt/node/bin/npm';
  runtime.customNodePath = '/opt/node/bin/node';

  assert.equal(
    buildNpmPackageInstallCommand('@openai/codex', runtime),
    '/opt/node/bin/npm install -g @openai/codex',
  );
});

test('buildFnmPackageInstallCommand prepares the LTS runtime before npm install', () => {
  assert.equal(
    buildFnmPackageInstallCommand('@openai/codex'),
    'fnm install --lts --use && npm install -g @openai/codex',
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
  const runtime = snapshot('ready', 'ready', 'unknown');
  runtime.node.path = '/opt/node/bin/node';
  runtime.npm.path = '/opt/node/bin/npm';
  runtime.customNodePath = '/opt/node/bin/node';

  const env = buildNodeRuntimeEnvironment(runtime, { PATH: '/usr/bin' });
  const delimiter = process.platform === 'win32' ? ';' : ':';
  assert.equal(env.PATH, `/opt/node/bin${delimiter}/usr/bin`);
});

test('getFnmBootstrapCommandForPlatform returns platform install commands', () => {
  assert.equal(getFnmBootstrapCommandForPlatform('win32'), 'winget install Schniz.fnm');
  assert.equal(getFnmBootstrapCommandForPlatform('darwin'), 'brew install fnm');
  assert.equal(
    getFnmBootstrapCommandForPlatform('linux'),
    'curl -fsSL https://fnm.vercel.app/install | bash',
  );
  assert.equal(getFnmBootstrapCommandForPlatform('freebsd'), null);
});
