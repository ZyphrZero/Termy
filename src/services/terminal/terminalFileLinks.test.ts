import * as assert from 'node:assert/strict';
import test from 'node:test';

import { parseTerminalFileUriLinks } from './terminalFileLinks.ts';

test('parseTerminalFileUriLinks detects encoded Claude Code file URLs', () => {
  const text = 'Open file:///Users/lihanqing/Documents/GitHub/Termy/%E8%BF%9C%E5%B1%B1%E8%BF%91%E9%9B%AA%EF%BC%9A%E4%B8%80%E4%B8%AA%E4%BA%BA%E7%9A%84%E5%B7%9D%E8%A5%BF%E6%97%85%E9%80%94.md now';

  assert.deepEqual(parseTerminalFileUriLinks(text), [
    {
      uri: 'file:///Users/lihanqing/Documents/GitHub/Termy/%E8%BF%9C%E5%B1%B1%E8%BF%91%E9%9B%AA%EF%BC%9A%E4%B8%80%E4%B8%AA%E4%BA%BA%E7%9A%84%E5%B7%9D%E8%A5%BF%E6%97%85%E9%80%94.md',
      startIndex: 5,
      endIndex: text.indexOf(' now'),
    },
  ]);
});

test('parseTerminalFileUriLinks trims common wrapper and sentence punctuation', () => {
  const text = '(file:///Users/test/Note%20One.md), then <file:///Users/test/Other.md>.';

  assert.deepEqual(parseTerminalFileUriLinks(text), [
    {
      uri: 'file:///Users/test/Note%20One.md',
      startIndex: 1,
      endIndex: 33,
    },
    {
      uri: 'file:///Users/test/Other.md',
      startIndex: 42,
      endIndex: 69,
    },
  ]);
});

test('parseTerminalFileUriLinks ignores non-file URLs', () => {
  assert.deepEqual(
    parseTerminalFileUriLinks('https://example.com file-ish:///tmp/Nope.md'),
    [],
  );
});
