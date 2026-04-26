import assert from 'node:assert/strict';
import test from 'node:test';

import { isBlackWhiteSimpleIcon, resolveSimpleIconColor } from './simpleIconColors.ts';

test('OpenAI icons use black-or-white CSS instead of Simple Icons brand color', () => {
  assert.equal(isBlackWhiteSimpleIcon('openai'), true);
  assert.equal(isBlackWhiteSimpleIcon('openaiapi'), true);
  assert.equal(isBlackWhiteSimpleIcon('OpenAI'), true);
  assert.equal(resolveSimpleIconColor('openai', '412991'), null);
  assert.equal(resolveSimpleIconColor('openaiapi', '412991'), null);
  assert.equal(resolveSimpleIconColor('OpenAI', '412991'), null);
});

test('other Simple Icons keep their brand color when available', () => {
  assert.equal(isBlackWhiteSimpleIcon('github'), false);
  assert.equal(resolveSimpleIconColor('github', '181717'), '#181717');
  assert.equal(resolveSimpleIconColor('python', null), null);
});
