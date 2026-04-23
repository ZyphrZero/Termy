import * as assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectFallbackDroppedTextPayload,
  collectPreferredDroppedTextPayload,
  joinUniqueDroppedTextPayloadParts,
  normalizeDroppedTextPayloadPart,
  resolveDroppedTextInput,
} from './dropTextPayload.ts';

test('joinUniqueDroppedTextPayloadParts deduplicates repeated plain-text drag payloads', () => {
  const payload = joinUniqueDroppedTextPayloadParts([
    '- line one\r\n',
    '- line one',
    '',
    null,
    undefined,
    '- line one\r\n',
  ]);

  assert.equal(payload, '- line one');
});

test('joinUniqueDroppedTextPayloadParts preserves distinct payload order', () => {
  const payload = joinUniqueDroppedTextPayloadParts([
    'first value',
    'second value',
    'first value',
    'third value',
  ]);

  assert.equal(payload, 'first value\nsecond value\nthird value');
});

test('normalizeDroppedTextPayloadPart keeps leading indentation but removes empty trailing whitespace', () => {
  assert.equal(normalizeDroppedTextPayloadPart('  indented text  \r\n'), '  indented text');
  assert.equal(normalizeDroppedTextPayloadPart('   \r\n'), null);
});

test('collectPreferredDroppedTextPayload reads only lightweight text payload types', () => {
  const requestedTypes: string[] = [];
  const payload = collectPreferredDroppedTextPayload({
    types: ['text/plain', 'text/html', 'application/x-custom'],
    getData(type) {
      requestedTypes.push(type);
      return {
        'text/plain': 'plain text payload',
        'text/uri-list': '',
        'text/html': '<p>heavy html payload</p>',
        'application/x-custom': 'custom payload',
      }[type] ?? '';
    },
  });

  assert.equal(payload, 'plain text payload');
  assert.deepEqual(requestedTypes, ['text/uri-list', 'text/plain']);
});

test('collectFallbackDroppedTextPayload keeps fallback types and async string items', async () => {
  const requestedTypes: string[] = [];
  const payload = await collectFallbackDroppedTextPayload(
    {
      types: ['Files', 'text/plain', 'text/html', 'application/x-custom'],
      getData(type) {
        requestedTypes.push(type);
        return {
          'text/html': '<p>html payload</p>',
          'application/x-custom': 'custom payload',
        }[type] ?? '';
      },
    },
    [
      {
        kind: 'string',
        getAsString(callback) {
          callback('string item payload');
        },
      },
      {
        kind: 'file',
      },
    ]
  );

  assert.equal(payload, '<p>html payload</p>\ncustom payload\nstring item payload');
  assert.deepEqual(requestedTypes, ['text/html', 'application/x-custom']);
});

test('resolveDroppedTextInput prefers fallback paths over basename-only primary text payloads', () => {
  const input = resolveDroppedTextInput(
    'demo',
    'obsidian://open?file=005-AI%2Fdemo',
    (payload) => payload.includes('005-AI%2Fdemo') ? ['F:\\obsidian-changqiu\\005-AI\\demo'] : [],
    (paths) => paths.join(' ')
  );

  assert.deepEqual(input, {
    text: 'F:\\obsidian-changqiu\\005-AI\\demo',
    usePaste: false,
  });
});
