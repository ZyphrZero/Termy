import * as assert from 'node:assert/strict';
import test from 'node:test';

import { parseTerminalOutputFileReferences } from './terminalOutputLinks.ts';

test('parses colon-style file references with line and column', () => {
  const references = parseTerminalOutputFileReferences('See src/main.ts:123:45 for details');

  assert.equal(references.length, 1);
  assert.equal(references[0].path, 'src/main.ts');
  assert.equal(references[0].line, 123);
  assert.equal(references[0].column, 45);
});

test('parses parenthesized file references', () => {
  const references = parseTerminalOutputFileReferences('Check src/ui/view.ts(88) next');

  assert.equal(references.length, 1);
  assert.equal(references[0].path, 'src/ui/view.ts');
  assert.equal(references[0].line, 88);
  assert.equal(references[0].column, null);
});

test('parses absolute windows file references', () => {
  const references = parseTerminalOutputFileReferences('Error in C:\\repo\\src\\main.ts:10');

  assert.equal(references.length, 1);
  assert.equal(references[0].path, 'C:\\repo\\src\\main.ts');
  assert.equal(references[0].line, 10);
});

test('parses diff-style file paths without line information when they include separators', () => {
  const references = parseTerminalOutputFileReferences('+++ b/src/services/terminalInstance.ts');

  assert.equal(references.length, 1);
  assert.equal(references[0].path, 'b/src/services/terminalInstance.ts');
  assert.equal(references[0].line, null);
});

test('does not treat ordinary prose with colons as file references', () => {
  const references = parseTerminalOutputFileReferences('Status: ready, version 1.2.3: stable');
  assert.equal(references.length, 0);
});
