import test from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'os';
import { getHomeDir, getPlatform, isLinux, isMacOS, isWindows } from './platform.ts';

test('getPlatform mirrors the current Node platform', () => {
  assert.equal(getPlatform(), process.platform);
});

test('isWindows / isMacOS / isLinux are mutually exclusive on the current host', () => {
  const flags = [isWindows(), isMacOS(), isLinux()];
  const trueCount = flags.filter(Boolean).length;
  assert.ok(trueCount <= 1, `expected at most one platform flag, got ${trueCount}`);

  if (process.platform === 'win32') {
    assert.equal(isWindows(), true);
  } else if (process.platform === 'darwin') {
    assert.equal(isMacOS(), true);
  } else if (process.platform === 'linux') {
    assert.equal(isLinux(), true);
  }
});

test('getHomeDir mirrors os.homedir()', () => {
  assert.equal(getHomeDir(), homedir());
});
