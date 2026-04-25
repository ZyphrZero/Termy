import * as assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectTerminalReferenceCandidatePaths,
  fileUriToPlatformPath,
  findUniqueTerminalEntryByBasename,
  getVaultRelativePathFromAbsolute,
  isAbsoluteTerminalPath,
  joinTerminalPaths,
  normalizeDroppedEntryPath,
  normalizeDroppedEntryReference,
  normalizeTerminalRawToken,
  normalizeTerminalReferencePath,
  normalizeTerminalToken,
  normalizeVaultPath,
} from './terminalPathUtils.ts';

test('normalizeTerminalToken strips wrappers and decodes escaped drag payload text', () => {
  assert.equal(
    normalizeTerminalToken('  <file:///C:/Program%20Files/Termy>  '),
    'file:///C:/Program Files/Termy'
  );
  assert.equal(normalizeTerminalToken('"[[Folder/File.md]]"'), '[[Folder/File.md]]');
});

test('normalizeTerminalRawToken strips wrappers without decoding URL separators', () => {
  assert.equal(
    normalizeTerminalRawToken('  <file:///C:/repo/A%26B%23C.md>  '),
    'file:///C:/repo/A%26B%23C.md'
  );
});

test('normalizeVaultPath canonicalizes vault-style separators and relative segments', () => {
  assert.equal(normalizeVaultPath(' /folder\\child/../note.md '), 'folder/note.md');
  assert.equal(normalizeVaultPath('\\folder\\nested\\file.ts'), 'folder/nested/file.ts');
});

test('normalizeTerminalReferencePath removes diff prefixes and matches the target platform', () => {
  assert.equal(normalizeTerminalReferencePath('b/src/services/file.ts', 'win32'), 'src\\services\\file.ts');
  assert.equal(normalizeTerminalReferencePath('a\\src\\services\\file.ts', 'linux'), 'src/services/file.ts');
});

test('fileUriToPlatformPath converts file URIs into local platform paths', () => {
  assert.equal(
    fileUriToPlatformPath('file:///Users/lihanqing/Documents/GitHub/Termy/%E8%BF%9C%E5%B1%B1%E8%BF%91%E9%9B%AA%EF%BC%9A%E4%B8%80%E4%B8%AA%E4%BA%BA%E7%9A%84%E5%B7%9D%E8%A5%BF%E6%97%85%E9%80%94.md', 'darwin'),
    '/Users/lihanqing/Documents/GitHub/Termy/远山近雪：一个人的川西旅途.md'
  );
  assert.equal(
    fileUriToPlatformPath('file:///C:/Users/test/Documents/Note%20One.md', 'win32'),
    'C:\\Users\\test\\Documents\\Note One.md'
  );
  assert.equal(
    fileUriToPlatformPath('file://server/share/folder/file.txt', 'win32'),
    '\\\\server\\share\\folder\\file.txt'
  );
  assert.equal(
    fileUriToPlatformPath('file:///Users/test/Note%20One.md', 'linux'),
    '/Users/test/Note One.md'
  );
  assert.equal(
    fileUriToPlatformPath('file://localhost/Users/test/Note%20One.md', 'darwin'),
    '/Users/test/Note One.md'
  );
  assert.equal(
    fileUriToPlatformPath('file:///C:/Users/test/Hash%23Note.md#line=3', 'win32'),
    'C:\\Users\\test\\Hash#Note.md'
  );
  assert.equal(fileUriToPlatformPath('obsidian://open?file=Folder%2FNote.md', 'win32'), null);
  assert.equal(fileUriToPlatformPath('vscode://file/C:/repo/src/main.ts', 'win32'), null);
  assert.equal(fileUriToPlatformPath('C:\\repo\\src\\main.ts', 'win32'), null);
});

test('joinTerminalPaths and getVaultRelativePathFromAbsolute share one canonical path shape', () => {
  const absolutePath = joinTerminalPaths('C:\\vault', 'src/services/file.ts', 'win32');

  assert.equal(absolutePath, 'C:\\vault\\src\\services\\file.ts');
  assert.equal(
    getVaultRelativePathFromAbsolute(absolutePath, 'C:\\vault', 'win32'),
    'src/services/file.ts'
  );
  assert.equal(
    joinTerminalPaths('/Users/test/vault', './folder/../Note.md', 'darwin'),
    '/Users/test/vault/Note.md'
  );
  assert.equal(
    getVaultRelativePathFromAbsolute('/Users/test/vault/folder/../Note.md', '/Users/test/vault', 'linux'),
    'Note.md'
  );
});

test('collectTerminalReferenceCandidatePaths builds stable absolute candidates from multiple roots', () => {
  assert.deepEqual(
    collectTerminalReferenceCandidatePaths(
      'src/services/file.ts',
      ['C:\\repo\\current', 'C:\\repo', 'C:\\repo'],
      'win32'
    ),
    [
      'C:\\repo\\current\\src\\services\\file.ts',
      'C:\\repo\\src\\services\\file.ts',
    ]
  );
  assert.deepEqual(
    collectTerminalReferenceCandidatePaths(
      './folder/../Note.md',
      ['/Users/test/current', '/Users/test/vault'],
      'darwin'
    ),
    [
      '/Users/test/current/Note.md',
      '/Users/test/vault/Note.md',
    ]
  );
});

test('isAbsoluteTerminalPath detects absolute paths using the target platform rules', () => {
  assert.equal(isAbsoluteTerminalPath('C:\\vault\\file.ts', 'win32'), true);
  assert.equal(isAbsoluteTerminalPath('\\\\server\\share\\file.ts', 'win32'), true);
  assert.equal(isAbsoluteTerminalPath('/home/user/file.ts', 'linux'), true);
  assert.equal(isAbsoluteTerminalPath('C:\\vault\\file.ts', 'linux'), false);
  assert.equal(isAbsoluteTerminalPath('src/file.ts', 'linux'), false);
});

test('normalizeDroppedEntryPath normalizes POSIX drop paths without forcing Windows rules', () => {
  assert.equal(
    normalizeDroppedEntryPath('/Users/test/vault/folder/../Note.md', 'darwin'),
    '/Users/test/vault/Note.md'
  );
  assert.equal(
    normalizeDroppedEntryPath('/home/test/vault//nested/file.ts', 'linux'),
    '/home/test/vault/nested/file.ts'
  );
});

test('normalizeDroppedEntryReference preserves vault-relative directory entry paths on Windows', () => {
  assert.deepEqual(
    normalizeDroppedEntryReference('/考试/15040', 'win32'),
    {
      absolutePath: null,
      vaultPath: '考试/15040',
    }
  );
  assert.deepEqual(
    normalizeDroppedEntryReference('F:\\obsidian-changqiu\\考试\\15040', 'win32'),
    {
      absolutePath: 'F:\\obsidian-changqiu\\考试\\15040',
      vaultPath: null,
    }
  );
});

test('findUniqueTerminalEntryByBasename resolves a unique basename and rejects ambiguous matches', () => {
  assert.deepEqual(
    findUniqueTerminalEntryByBasename('App.tsx', [
      { name: 'App.tsx', path: 'src/App.tsx', kind: 'file' },
    ]),
    { name: 'App.tsx', path: 'src/App.tsx', kind: 'file' },
  );

  assert.equal(
    findUniqueTerminalEntryByBasename('App.tsx', [
      { name: 'App.tsx', path: 'src/App.tsx', kind: 'file' },
      { name: 'App.tsx', path: 'packages/ui/App.tsx', kind: 'file' },
    ]),
    null,
  );

  assert.deepEqual(
    findUniqueTerminalEntryByBasename('assets', [
      { name: 'assets', path: 'docs/assets', kind: 'folder' },
      { name: 'assets', path: 'src/assets.ts', kind: 'file' },
    ]),
    { name: 'assets', path: 'docs/assets', kind: 'folder' },
  );
});
