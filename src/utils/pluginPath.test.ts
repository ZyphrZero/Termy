import assert from 'node:assert/strict';
import { posix as posixPath } from 'node:path';
import test from 'node:test';
import { resolvePluginDir } from './pluginPath.ts';

test('Linux plugin and binary paths preserve the filesystem root', () => {
  const pluginDir = resolvePluginDir(
    '/home/example/Documents/Notes',
    '.obsidian',
    'termy',
    '.obsidian/plugins/termy',
    'linux',
  );

  assert.equal(pluginDir, '/home/example/Documents/Notes/.obsidian/plugins/termy');
  assert.equal(
    posixPath.join(pluginDir, 'binaries', 'termy-server-linux-x64'),
    '/home/example/Documents/Notes/.obsidian/plugins/termy/binaries/termy-server-linux-x64',
  );
});

test('absolute Unix manifest paths take precedence over the vault directory', () => {
  assert.equal(
    resolvePluginDir('/home/example/Notes', '.obsidian', 'termy', '/opt/plugins/termy', 'linux'),
    '/opt/plugins/termy',
  );
});

test('missing and empty manifest paths use the custom config directory on macOS', () => {
  for (const manifestDir of [undefined, '']) {
    assert.equal(
      resolvePluginDir('/Users/example/Documents/Example Notes', '.custom', 'termy', manifestDir, 'darwin'),
      '/Users/example/Documents/Example Notes/.custom/plugins/termy',
    );
  }
});

test('an absolute config directory is preserved when the manifest path is missing', () => {
  assert.equal(
    resolvePluginDir('/home/example/Notes', '/opt/obsidian-config', 'termy', undefined, 'linux'),
    '/opt/obsidian-config/plugins/termy',
  );
});

test('Windows relative manifest paths support either separator', () => {
  for (const manifestDir of ['.obsidian/plugins/termy', '.obsidian\\plugins\\termy']) {
    assert.equal(
      resolvePluginDir('F:\\example-vault', '.custom', 'termy', manifestDir, 'win32'),
      'F:\\example-vault\\.obsidian\\plugins\\termy',
    );
  }
});

test('absolute Windows manifest paths preserve drive letters and UNC shares', () => {
  for (const manifestDir of ['D:\\plugins\\termy', '//server/share/plugins/termy']) {
    assert.equal(
      resolvePluginDir('F:\\example-vault', '.obsidian', 'termy', manifestDir, 'win32'),
      manifestDir.replace(/\//g, '\\'),
    );
  }
});

test('UNC vault roots survive the fallback path and redundant segments are normalized', () => {
  assert.equal(
    resolvePluginDir('\\\\server\\share\\Example Notes', '.custom', 'termy', undefined, 'win32'),
    '\\\\server\\share\\Example Notes\\.custom\\plugins\\termy',
  );
  assert.equal(
    resolvePluginDir('/home/example/Notes/', '.obsidian', 'termy', './.obsidian//plugins/../plugins/termy', 'linux'),
    '/home/example/Notes/.obsidian/plugins/termy',
  );
});
