import assert from 'node:assert/strict';
import test from 'node:test';

import { isCodexCliUnavailableResult } from './commandAvailability.ts';

test('isCodexCliUnavailableResult recognizes ENOENT spawn failures', () => {
  assert.equal(
    isCodexCliUnavailableResult({
      code: null,
      stdout: '',
      stderr: '',
      error: new Error('spawn codex ENOENT'),
    }),
    true,
  );
});

test('isCodexCliUnavailableResult recognizes Windows shell command-not-found output', () => {
  assert.equal(
    isCodexCliUnavailableResult({
      code: 1,
      stdout: '',
      stderr: "'codex' �����ڲ����ⲿ���Ҳ���ǿ����еĳ���\r\n���������ļ���",
    }),
    true,
  );
});

test('isCodexCliUnavailableResult recognizes POSIX command-not-found output', () => {
  assert.equal(
    isCodexCliUnavailableResult({
      code: 127,
      stdout: '',
      stderr: 'codex: command not found',
    }),
    true,
  );
});

test('isCodexCliUnavailableResult ignores ordinary Codex command failures', () => {
  assert.equal(
    isCodexCliUnavailableResult({
      code: 2,
      stdout: '',
      stderr: "error: unknown subcommand 'mcpx'",
    }),
    false,
  );
});
