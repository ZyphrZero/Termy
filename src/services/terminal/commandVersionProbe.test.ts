import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compareVersions,
  extractVersionString,
} from './commandVersionProbe.ts';

test('extractVersionString pulls a basic semver token', () => {
  // claude --version on Anthropic's native installer prints exactly this shape.
  assert.equal(extractVersionString('2.1.143 (Claude Code)'), '2.1.143');
});

test('extractVersionString preserves a pre-release suffix', () => {
  assert.equal(extractVersionString('codex 0.42.1-rc.4'), '0.42.1-rc.4');
});

test('extractVersionString returns null when no semver-ish token exists', () => {
  assert.equal(extractVersionString('error: not installed'), null);
});

test('extractVersionString handles multi-line --version output', () => {
  // Some CLIs emit a banner before the version string on the second line.
  const raw = 'Claude Code\nversion 1.7.2\nlicense …';
  assert.equal(extractVersionString(raw), '1.7.2');
});

test('dsh-tui version detection uses the upgraded profile rather than the global launcher', () => {
  const raw = '@deepseek-harness-tui/dsh-tui 0.10.2 (launcher)\r\nprofile: 0.14.0  C:\\example\\profiles\\dsh-tui';
  assert.equal(extractVersionString(raw, 'dsh-tui'), '0.14.0');
});

test('dsh-tui version detection reports an older profile even when the launcher is newer', () => {
  const raw = '@deepseek-harness-tui/dsh-tui 0.14.0 (launcher)\nprofile: 0.10.2  /example/profiles/dsh-tui';
  assert.equal(extractVersionString(raw, 'dsh-tui'), '0.10.2');
});

test('dsh-tui profile versions preserve pre-release suffixes', () => {
  const raw = '@deepseek-harness-tui/dsh-tui 0.10.2 (launcher)\nprofile: 0.14.0-rc.1  /example/profiles/dsh-tui';
  assert.equal(extractVersionString(raw, 'dsh-tui'), '0.14.0-rc.1');
});

test('a missing dsh-tui profile cannot use the launcher version or a version in its path', () => {
  const raw = '@deepseek-harness-tui/dsh-tui 0.10.2 (launcher)\nprofile: not installed  /example/9.9.9/dsh-tui';
  assert.equal(extractVersionString(raw, 'dsh-tui'), null);
});

test('dsh-tui profile parsing does not accept a partial version token', () => {
  const raw = '@deepseek-harness-tui/dsh-tui 0.10.2 (launcher)\nprofile: 0.14.0-invalid!  /example/profiles/dsh-tui';
  assert.equal(extractVersionString(raw, 'dsh-tui'), null);
});

test('dsh-tui output without a profile line keeps the legacy single-version format', () => {
  assert.equal(extractVersionString('@deepseek-harness-tui/dsh-tui 0.9.0', 'dsh-tui'), '0.9.0');
});

test('other commands keep their first-version parsing even when a profile line is present', () => {
  const raw = 'example-cli 1.0.0\nprofile: 2.0.0';
  assert.equal(extractVersionString(raw, 'example-cli'), '1.0.0');
});

test('compareVersions returns 0 for equal releases', () => {
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
});

test('compareVersions returns positive when left is newer', () => {
  assert.ok(compareVersions('1.2.4', '1.2.3') > 0);
  assert.ok(compareVersions('1.3.0', '1.2.9') > 0);
  assert.ok(compareVersions('2.0.0', '1.99.99') > 0);
});

test('compareVersions returns negative when left is older', () => {
  assert.ok(compareVersions('1.2.3', '1.2.4') < 0);
});

test('compareVersions tolerates differing dotted-component counts', () => {
  // "1.2" should be treated as "1.2.0" so we never accidentally claim
  // "1.2" is newer than "1.2.0".
  assert.equal(compareVersions('1.2', '1.2.0'), 0);
  assert.ok(compareVersions('1.2.1', '1.2') > 0);
});

test('compareVersions ranks a release above its pre-release', () => {
  assert.ok(compareVersions('1.2.3', '1.2.3-rc.1') > 0);
  assert.ok(compareVersions('1.2.3-rc.1', '1.2.3') < 0);
});

test('compareVersions falls back to lexicographic order on equal pre-release prefix', () => {
  // We do not implement full semver pre-release ordering; this is a
  // guarded test so the simple heuristic does not silently change.
  assert.ok(compareVersions('1.2.3-rc.1', '1.2.3-rc.2') < 0);
});
