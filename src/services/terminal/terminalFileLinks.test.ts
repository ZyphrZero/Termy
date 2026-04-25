import * as assert from 'node:assert/strict';
import test from 'node:test';

import { parseTerminalFileUriLinks } from './terminalFileLinks.ts';

test('parseTerminalFileUriLinks detects encoded Claude Code file URLs', () => {
  const text = 'Open file:///Users/example/Documents/Notes/%E7%A4%BA%E4%BE%8B%E7%AC%94%E8%AE%B0.md now';

  assert.deepEqual(parseTerminalFileUriLinks(text), [
    {
      uri: 'file:///Users/example/Documents/Notes/%E7%A4%BA%E4%BE%8B%E7%AC%94%E8%AE%B0.md',
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
