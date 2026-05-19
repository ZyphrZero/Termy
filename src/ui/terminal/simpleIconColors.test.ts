import assert from 'node:assert/strict';
import test from 'node:test';

import { isBlackWhiteSimpleIcon, resolveSimpleIconColor } from './simpleIconColors.ts';

test('the black/white silhouette set is empty by default', () => {
  // Termy used to route OpenAI / OpenAI API simple-icons silhouettes
  // through a black-or-white CSS rule. Those brand marks now ship via
  // @lobehub/icons-static-svg with `currentColor`, so the simple-icons
  // black/white branch is unused. Keep the helper around for future
  // silhouette-only icons.
  assert.equal(isBlackWhiteSimpleIcon('openai'), false);
  assert.equal(isBlackWhiteSimpleIcon('openaiapi'), false);
  assert.equal(isBlackWhiteSimpleIcon('claude'), false);
});

test('Simple Icons keep their brand color when available', () => {
  assert.equal(isBlackWhiteSimpleIcon('github'), false);
  assert.equal(resolveSimpleIconColor('github', '181717'), '#181717');
  assert.equal(resolveSimpleIconColor('python', null), null);
});
