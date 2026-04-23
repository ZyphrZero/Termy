import * as assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertSupportedNodeVersion,
  parseNodeMajorVersion,
} from './upload-r2-assets.js';

test('parseNodeMajorVersion extracts the major version from semver strings', () => {
  assert.equal(parseNodeMajorVersion('20.18.0'), 20);
  assert.equal(parseNodeMajorVersion('24.9.0'), 24);
});

test('parseNodeMajorVersion returns null for malformed version strings', () => {
  assert.equal(parseNodeMajorVersion('not-a-version'), null);
  assert.equal(parseNodeMajorVersion(''), null);
});

test('assertSupportedNodeVersion accepts Node 20 and newer', () => {
  assert.doesNotThrow(() => assertSupportedNodeVersion('20.0.0'));
  assert.doesNotThrow(() => assertSupportedNodeVersion('22.15.1'));
});

test('assertSupportedNodeVersion rejects Node versions older than 20 with a clear message', () => {
  assert.throws(
    () => assertSupportedNodeVersion('18.20.8'),
    /requires Node\.js v20\+.*Wrangler.*18\.20\.8/i
  );
});
