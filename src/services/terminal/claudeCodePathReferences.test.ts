import * as assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatClaudeCodePathReference,
  formatClaudeCodePathReferences,
} from './claudeCodePathReferences.ts';

test('formatClaudeCodePathReferences emits cwd-relative @ references for Claude Code', () => {
  const result = formatClaudeCodePathReferences(
    [
      '/Users/test/vault/notes/路径示例.md',
      '/Users/test/vault/archive/12345',
    ],
    {
      cwd: '/Users/test/vault',
      platform: 'darwin',
      isDirectory: (path) => path.endsWith('/12345'),
    },
  );

  assert.equal(result, '@notes/路径示例.md @archive/12345/ ');
});

test('formatClaudeCodePathReference quotes paths that Claude Code regular mentions would truncate', () => {
  assert.equal(
    formatClaudeCodePathReference('/Users/test/vault/notes/条目', {
      cwd: '/Users/test/vault',
      platform: 'darwin',
    }),
    '@"notes/条目"'
  );

  assert.equal(
    formatClaudeCodePathReference('/Users/test/vault/notes/a）', {
      cwd: '/Users/test/vault',
      platform: 'darwin',
    }),
    '@"notes/a）"'
  );
});

test('formatClaudeCodePathReference quotes non-ascii directory references that need a trailing slash', () => {
  const result = formatClaudeCodePathReference(
    '/Users/test/vault/notes/资料',
    {
      cwd: '/Users/test/vault',
      platform: 'darwin',
      isDirectory: () => true,
    },
  );

  assert.equal(result, '@"notes/资料/"');
});

test('formatClaudeCodePathReference quotes references that contain spaces', () => {
  const result = formatClaudeCodePathReference(
    '/Users/test/My Vault/Folder/File One.md',
    {
      cwd: '/Users/test/My Vault',
      platform: 'darwin',
    },
  );

  assert.equal(result, '@"Folder/File One.md"');
});

test('formatClaudeCodePathReference falls back to absolute paths outside cwd', () => {
  const result = formatClaudeCodePathReference(
    '/Users/test/other/Note.md',
    {
      cwd: '/Users/test/vault',
      platform: 'darwin',
    },
  );

  assert.equal(result, '@/Users/test/other/Note.md');
});

test('formatClaudeCodePathReference falls back to absolute paths when cwd validation fails', () => {
  const existingPaths = new Set(['/Users/test/vault/Note.md']);
  const result = formatClaudeCodePathReference(
    '/Users/test/vault/Note.md',
    {
      cwd: '/Users/test/vault',
      platform: 'darwin',
      pathExists: (path) => existingPaths.has(path),
    },
  );

  assert.equal(result, '@/Users/test/vault/Note.md');
});

test('formatClaudeCodePathReference uses slash-separated relative Windows references', () => {
  const result = formatClaudeCodePathReference(
    'F:\\example-vault\\archive\\12345',
    {
      cwd: 'F:\\example-vault',
      platform: 'win32',
      isDirectory: () => true,
    },
  );

  assert.equal(result, '@archive/12345/');
});
