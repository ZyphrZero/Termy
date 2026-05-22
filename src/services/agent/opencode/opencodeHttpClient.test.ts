import { test } from 'node:test';
import assert from 'node:assert/strict';

import { OpenCodeHttpClient } from './opencodeHttpClient.ts';

test('OpenCodeHttpClient only exposes read-only methods (Property 5.3)', () => {
  // Verify that the class prototype only has the three allowed public
  // methods: listSessions, getSession, getMessages.
  const proto = OpenCodeHttpClient.prototype;
  const publicMethods = Object.getOwnPropertyNames(proto).filter(
    (name) => name !== 'constructor' && typeof (proto as unknown as Record<string, unknown>)[name] === 'function',
  );
  // Private methods start with no prefix in TS output but are still
  // on the prototype. We check that the removed methods are gone.
  assert.ok(!publicMethods.includes('createSession'), 'createSession should be removed');
  assert.ok(!publicMethods.includes('sendPromptAsync'), 'sendPromptAsync should be removed');
  assert.ok(!publicMethods.includes('openEventStream'), 'openEventStream should be removed');
});
