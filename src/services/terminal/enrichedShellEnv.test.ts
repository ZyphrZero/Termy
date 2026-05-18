import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractMarkedValue,
  validatePath,
  withEnrichedPath,
} from './enrichedShellEnv.ts';

test('extractMarkedValue slices the value between the BEGIN/END markers', () => {
  const output = [
    'banner line that should be ignored',
    '<<<TERMY_ENRICHED_PATH_BEGIN>>>',
    '/usr/local/bin:/usr/bin:/bin',
    '<<<TERMY_ENRICHED_PATH_END>>>',
    'trailing noise',
  ].join('\n');
  assert.equal(extractMarkedValue(output), '/usr/local/bin:/usr/bin:/bin');
});

test('extractMarkedValue returns null when the begin marker is missing', () => {
  assert.equal(extractMarkedValue('no markers here\nsome PATH content'), null);
});

test('extractMarkedValue returns null when the end marker is missing', () => {
  const output = '<<<TERMY_ENRICHED_PATH_BEGIN>>>\n/usr/bin\n';
  assert.equal(extractMarkedValue(output), null);
});

test('extractMarkedValue trims surrounding whitespace and CR/LF padding', () => {
  const output = '<<<TERMY_ENRICHED_PATH_BEGIN>>>\r\n  C:\\Windows;C:\\foo  \r\n<<<TERMY_ENRICHED_PATH_END>>>';
  assert.equal(extractMarkedValue(output), 'C:\\Windows;C:\\foo');
});

test('validatePath rejects values containing NUL bytes', () => {
  assert.equal(validatePath('/usr/bin\u0000/evil'), false);
});

test('validatePath rejects values that still contain a marker', () => {
  assert.equal(validatePath('/usr/bin <<<TERMY_ENRICHED_PATH_BEGIN>>>'), false);
});

test('validatePath accepts a normal POSIX PATH value', () => {
  assert.equal(validatePath('/usr/local/bin:/usr/bin:/bin'), true);
});

test('validatePath accepts a normal Windows PATH value', () => {
  assert.equal(
    validatePath('C:\\Windows;C:\\Windows\\System32;C:\\Users\\example\\AppData\\Roaming\\fnm\\aliases\\default'),
    true,
  );
});

test('withEnrichedPath returns the base env unchanged when enriched is null', () => {
  const baseEnv = { PATH: '/usr/bin', HOME: '/home/example' };
  const result = withEnrichedPath(baseEnv, null);
  assert.equal(result, baseEnv);
});

test('withEnrichedPath replaces PATH on POSIX', () => {
  const baseEnv = { PATH: '/usr/bin', HOME: '/home/example' };
  const result = withEnrichedPath(baseEnv, '/opt/node/bin:/usr/bin');
  assert.equal(result.PATH, '/opt/node/bin:/usr/bin');
  assert.equal(result.HOME, '/home/example');
  // Original env must remain unchanged.
  assert.equal(baseEnv.PATH, '/usr/bin');
});

test('withEnrichedPath honours the existing case of the PATH key on Windows-style envs', () => {
  // Real Windows envs sometimes expose `Path`, sometimes `PATH`.
  // The helper should reuse the existing key so we don't end up with
  // both set on the spawned child.
  const baseEnv: Record<string, string | undefined> = { Path: 'C:\\Windows' };
  const result = withEnrichedPath(baseEnv, 'C:\\foo;C:\\Windows');
  if (process.platform === 'win32') {
    assert.equal(result.Path, 'C:\\foo;C:\\Windows');
    assert.equal(result.PATH, undefined);
  } else {
    // On POSIX the helper always sets PATH; preserves the original.
    assert.equal(result.PATH, 'C:\\foo;C:\\Windows');
  }
});
