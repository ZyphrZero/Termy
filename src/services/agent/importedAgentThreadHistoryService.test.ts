import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ImportedAgentThreadHistoryService } from './importedAgentThreadHistoryService.ts';

test('ImportedAgentThreadHistoryService stores provider-owned imported thread metadata', () => {
  const pluginDir = fs.mkdtempSync(path.join(os.tmpdir(), 'termy-imported-history-'));
  const previousWindow = globalThis.window;
  try {
    globalThis.window = {
      require(moduleName: string) {
        if (moduleName === 'fs') return fs;
        if (moduleName === 'path') return path;
        if (moduleName === 'child_process') {
          throw new Error('child_process must not be required');
        }
        throw new Error(`Unexpected module: ${moduleName}`);
      },
    } as Window & typeof globalThis;

    const service = new ImportedAgentThreadHistoryService(pluginDir);
    service.saveThread('opencode', {
      id: 'older',
      title: 'Older',
      cwd: '/tmp/example',
      updatedAt: 100,
      importedAt: 1000,
    });
    service.saveThread('opencode', {
      id: 'newer',
      title: 'Newer',
      cwd: '/tmp/example',
      updatedAt: 300,
      importedAt: 1001,
    });
    service.saveThread('opencode', {
      id: 'older',
      title: 'Older renamed by source',
      cwd: '/tmp/example',
      updatedAt: 400,
      importedAt: 1002,
    });

    assert.deepEqual(
      service.listThreads('opencode').map((thread) => thread.id),
      ['older', 'newer'],
    );
    assert.equal(service.listThreads('opencode')[0]?.title, 'Older renamed by source');
    assert.deepEqual(service.listThreads('claude-code'), []);
  } finally {
    globalThis.window = previousWindow;
    fs.rmSync(pluginDir, { recursive: true, force: true });
  }
});
