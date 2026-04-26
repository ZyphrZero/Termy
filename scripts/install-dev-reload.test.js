import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  DEV_RELOAD_REQUEST_FILE,
  createDevReloadRequest,
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
      requestedAt: '2026-04-26T00:00:00.000Z',
      pid: 456,
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
