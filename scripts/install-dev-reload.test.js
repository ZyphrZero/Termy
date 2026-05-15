import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  DEV_RELOAD_PHASE_INSTALLING,
  DEV_RELOAD_PHASE_RELOAD,
  DEV_RELOAD_REQUEST_FILE,
  clearDevInstallRequest,
  createDevInstallRequest,
  createDevReloadRequest,
  writeDevInstallRequest,
  writeDevReloadRequest,
} from './install-dev-reload.js';

test('createDevReloadRequest records the plugin and request metadata', () => {
  const request = createDevReloadRequest({
    pluginId: 'termy',
    requestId: 'request-1',
    requestedAt: new Date('2026-04-26T00:00:00.000Z'),
    pid: 123,
  });

  assert.deepEqual(request, {
    pluginId: 'termy',
    requestId: 'request-1',
    phase: DEV_RELOAD_PHASE_RELOAD,
    requestedAt: '2026-04-26T00:00:00.000Z',
    pid: 123,
  });
});

test('writeDevReloadRequest writes the reload marker into the plugin directory', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'termy-install-dev-'));

  try {
    const { requestPath } = writeDevReloadRequest(tempDir, {
      pluginId: 'termy',
      requestId: 'request-2',
      requestedAt: new Date('2026-04-26T00:00:00.000Z'),
      pid: 456,
    });

    assert.equal(requestPath, path.join(tempDir, DEV_RELOAD_REQUEST_FILE));
    assert.deepEqual(JSON.parse(fs.readFileSync(requestPath, 'utf-8')), {
      pluginId: 'termy',
      requestId: 'request-2',
      phase: DEV_RELOAD_PHASE_RELOAD,
      requestedAt: '2026-04-26T00:00:00.000Z',
      pid: 456,
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('writeDevInstallRequest writes installing phase to the reload marker', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'termy-install-dev-'));

  try {
    const { requestPath } = writeDevInstallRequest(tempDir, {
      pluginId: 'termy',
      requestId: 'install-1',
      requestedAt: new Date('2026-04-26T00:00:00.000Z'),
      activeUntil: new Date('2026-04-26T00:02:00.000Z'),
      pid: 789,
    });

    assert.equal(requestPath, path.join(tempDir, DEV_RELOAD_REQUEST_FILE));
    assert.deepEqual(JSON.parse(fs.readFileSync(requestPath, 'utf-8')), {
      pluginId: 'termy',
      requestId: 'install-1',
      phase: DEV_RELOAD_PHASE_INSTALLING,
      requestedAt: '2026-04-26T00:00:00.000Z',
      activeUntil: '2026-04-26T00:02:00.000Z',
      pid: 789,
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('clearDevInstallRequest only removes installing phase requests', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'termy-install-dev-'));

  try {
    const { requestPath } = writeDevInstallRequest(tempDir, {
      requestId: 'install-2',
      requestedAt: new Date('2026-04-26T00:00:00.000Z'),
      activeUntil: new Date('2026-04-26T00:02:00.000Z'),
    });

    clearDevInstallRequest(tempDir);
    assert.equal(fs.existsSync(requestPath), false);

    writeDevReloadRequest(tempDir, {
      requestId: 'reload-1',
      requestedAt: new Date('2026-04-26T00:03:00.000Z'),
    });
    clearDevInstallRequest(tempDir);
    assert.equal(fs.existsSync(requestPath), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('createDevInstallRequest defaults to a bounded active window', () => {
  const requestedAt = new Date('2026-04-26T00:00:00.000Z');
  const activeUntil = new Date('2026-04-26T00:01:30.000Z');

  const request = createDevInstallRequest({
    requestId: 'install-3',
    requestedAt,
    activeUntil,
    pid: 321,
  });

  assert.deepEqual(request, {
    pluginId: 'termy',
    requestId: 'install-3',
    phase: DEV_RELOAD_PHASE_INSTALLING,
    requestedAt: requestedAt.toISOString(),
    activeUntil: activeUntil.toISOString(),
    pid: 321,
  });
});
