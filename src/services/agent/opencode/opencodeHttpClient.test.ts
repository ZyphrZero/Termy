import { test } from 'node:test';
import assert from 'node:assert/strict';

import { __testing } from './opencodeHttpClient.ts';

const { parseSseBlock } = __testing;

test('parses a regular SSE data block', () => {
  const block = 'data: {"id":"abc","type":"server.heartbeat","properties":{}}';
  const event = parseSseBlock(block);
  assert.ok(event);
  assert.equal(event?.id, 'abc');
  assert.equal(event?.type, 'server.heartbeat');
  assert.deepEqual(event?.properties, {});
});

test('skips comment-only blocks', () => {
  assert.equal(parseSseBlock(': keep-alive'), null);
});

test('returns null for empty blocks', () => {
  assert.equal(parseSseBlock(''), null);
});

test('returns null when the JSON is malformed', () => {
  assert.equal(parseSseBlock('data: not-json'), null);
});

test('returns null when type is missing', () => {
  // Without `type`, the consumer cannot route the event so we drop it.
  assert.equal(parseSseBlock('data: {"id":"x","properties":{}}'), null);
});

test('coerces missing properties into an empty object', () => {
  const event = parseSseBlock('data: {"id":"abc","type":"x"}');
  assert.ok(event);
  assert.deepEqual(event?.properties, {});
});

test('tolerates leading event: line', () => {
  // OpenCode does not emit `event: ...` lines today (everything is the
  // default `message` event), but the parser must skip non-data lines
  // without breaking.
  const block = 'event: message\ndata: {"id":"y","type":"x","properties":{}}';
  const event = parseSseBlock(block);
  assert.ok(event);
  assert.equal(event?.type, 'x');
});
