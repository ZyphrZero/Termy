import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAiLauncherStatusSnapshot,
  readinessToBadge,
} from './aiLauncherStatus.ts';

test('readiness is not-installed when PATH probe failed and no local version was found', () => {
  const snapshot = buildAiLauncherStatusSnapshot({
    pathAvailable: 'not-installed',
    local: { version: null, resolvedFrom: null },
    latest: null,
  });
  assert.equal(snapshot.readiness, 'not-installed');
  assert.equal(snapshot.local, null);
});

test('readiness is unknown when PATH probe was inconclusive and no local version was found', () => {
  const snapshot = buildAiLauncherStatusSnapshot({
    pathAvailable: 'unknown',
    local: { version: null, resolvedFrom: null },
    latest: null,
  });
  assert.equal(snapshot.readiness, 'unknown');
});

test('readiness is ready when PATH probe failed but the fallback scan found a binary', () => {
  // The macOS launchd PATH-leakage case — Obsidian started without
  // ~/.local/bin in PATH but the binary really is installed there.
  const snapshot = buildAiLauncherStatusSnapshot({
    pathAvailable: 'not-installed',
    local: { version: '1.5.0', resolvedFrom: '/Users/example/.local/bin/claude' },
    latest: null,
  });
  assert.equal(snapshot.readiness, 'ready');
  assert.equal(snapshot.local, '1.5.0');
  assert.equal(snapshot.resolvedFrom, '/Users/example/.local/bin/claude');
});

test('snapshot carries node runtime diagnostics for missing npm-backed launchers', () => {
  const snapshot = buildAiLauncherStatusSnapshot({
    pathAvailable: 'not-installed',
    local: { version: null, resolvedFrom: null },
    latest: null,
    nodeRuntime: {
      node: {
        command: 'node',
        availability: 'not-installed',
        version: null,
        path: null,
      },
      npm: {
        command: 'npm',
        availability: 'not-installed',
        version: null,
        path: null,
      },
      customNodePath: null,
    },
  });

  assert.equal(snapshot.readiness, 'not-installed');
  assert.equal(snapshot.nodeRuntime?.npm.availability, 'not-installed');
});

test('readiness is update-available when local is older than the registry version', () => {
  const snapshot = buildAiLauncherStatusSnapshot({
    pathAvailable: 'ready',
    local: { version: '1.5.0', resolvedFrom: null },
    latest: { version: '1.7.2' },
  });
  assert.equal(snapshot.readiness, 'update-available');
  assert.equal(snapshot.local, '1.5.0');
  assert.equal(snapshot.latest, '1.7.2');
});

test('readiness stays ready when local matches the latest version', () => {
  const snapshot = buildAiLauncherStatusSnapshot({
    pathAvailable: 'ready',
    local: { version: '1.7.2', resolvedFrom: null },
    latest: { version: '1.7.2' },
  });
  assert.equal(snapshot.readiness, 'ready');
});

test('readiness stays ready when registry lookup failed but local probe succeeded', () => {
  // The user opted in to update checks, the network call timed out, and
  // we don't want to nag them with a yellow "Update available" badge in
  // that case.
  const snapshot = buildAiLauncherStatusSnapshot({
    pathAvailable: 'ready',
    local: { version: '1.7.2', resolvedFrom: null },
    latest: { version: null, error: 'Registry request failed' },
  });
  assert.equal(snapshot.readiness, 'ready');
  assert.equal(snapshot.registryError, 'Registry request failed');
});

test('readinessToBadge maps update-available straight through', () => {
  assert.equal(readinessToBadge('update-available'), 'update-available');
  assert.equal(readinessToBadge('not-installed'), 'not-installed');
  assert.equal(readinessToBadge('ready'), 'ready');
  assert.equal(readinessToBadge('unknown'), 'checking');
});

function installations(versions: Array<string | null>) {
  return versions.map((version, index) => ({
    path: `/opt/agents/${index}/codex`,
    realPath: `/opt/agents/${index}/codex`,
    isDefault: index === 0,
    onPath: true,
    version,
    error: version === null ? 'Version probe failed or timed out' : undefined,
  }));
}

test('different installed versions are reported without changing the default version', () => {
  const snapshot = buildAiLauncherStatusSnapshot({
    pathAvailable: 'ready',
    local: { version: '1.0.0', resolvedFrom: '/opt/agents/0/codex', installations: installations(['1.0.0', '2.0.0']) },
    latest: null,
  });
  assert.equal(snapshot.installationIssue, 'version-conflict');
  assert.equal(snapshot.local, '1.0.0');
  assert.equal(snapshot.readiness, 'ready');
  assert.equal(snapshot.installations.length, 2);
});

test('same-version copies are multiple installations rather than a version conflict', () => {
  const snapshot = buildAiLauncherStatusSnapshot({
    pathAvailable: 'ready',
    local: { version: '1.0.0', resolvedFrom: '/opt/agents/0/codex', installations: installations(['1.0.0', '1.0.0']) },
    latest: null,
  });
  assert.equal(snapshot.installationIssue, 'multiple');
});

test('unknown versions remain visible and do not create a fabricated version conflict', () => {
  const snapshot = buildAiLauncherStatusSnapshot({
    pathAvailable: 'ready',
    local: { version: '1.0.0', resolvedFrom: '/opt/agents/0/codex', installations: installations(['1.0.0', null]) },
    latest: null,
  });
  assert.equal(snapshot.installationIssue, 'multiple');
  assert.equal(snapshot.installations[1].version, null);
  assert.match(snapshot.installations[1].error ?? '', /failed/);
});

test('copies outside PATH cannot make an unavailable launcher ready', () => {
  const copies = installations(['2.0.0']).map((item) => ({ ...item, onPath: false, isDefault: false }));
  const snapshot = buildAiLauncherStatusSnapshot({
    pathAvailable: 'not-installed',
    local: { version: null, resolvedFrom: null, installations: copies },
    latest: null,
  });
  assert.equal(snapshot.readiness, 'not-installed');
  assert.equal(snapshot.local, null);
  assert.equal(snapshot.installations.length, 1);
});

test('discovery failures are preserved for the installation details UI', () => {
  const snapshot = buildAiLauncherStatusSnapshot({
    pathAvailable: 'unknown',
    local: { version: null, resolvedFrom: null, discoveryErrors: ['/opt/agents: EACCES'] },
    latest: null,
  });
  assert.equal(snapshot.readiness, 'unknown');
  assert.deepEqual(snapshot.discoveryErrors, ['/opt/agents: EACCES']);
});
