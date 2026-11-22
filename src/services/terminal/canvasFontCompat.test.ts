import * as assert from 'node:assert/strict';
import test from 'node:test';

import { installCanvasFontCompat, trimCanvasFontValue } from './canvasFontCompat.ts';

interface FakeWindow {
  scope: Window;
  context: CanvasRenderingContext2D;
  offscreen: OffscreenCanvasRenderingContext2D;
}

function createFakeWindow(): FakeWindow {
  class FakeCanvasContext {
    private value = '';

    get font(): string {
      return this.value;
    }

    set font(next: string) {
      this.value = next;
    }
  }

  class FakeOffscreenContext {
    private value = '';

    get font(): string {
      return this.value;
    }

    set font(next: string) {
      this.value = next;
    }
  }

  const scope = {
    CanvasRenderingContext2D: FakeCanvasContext,
    OffscreenCanvasRenderingContext2D: FakeOffscreenContext,
  } as unknown as Window;

  return {
    scope,
    context: new FakeCanvasContext() as unknown as CanvasRenderingContext2D,
    offscreen: new FakeOffscreenContext() as unknown as OffscreenCanvasRenderingContext2D,
  };
}

test('trimCanvasFontValue removes leading whitespace only', () => {
  assert.equal(trimCanvasFontValue(' normal 14px Menlo'), 'normal 14px Menlo');
  assert.equal(trimCanvasFontValue('\t12px monospace'), '12px monospace');
  assert.equal(trimCanvasFontValue('italic normal 14px Menlo'), 'italic normal 14px Menlo');
  assert.equal(trimCanvasFontValue('bold 14px Menlo '), 'bold 14px Menlo ');
});

test('trimCanvasFontValue passes non-string values through', () => {
  const marker = { font: true };
  assert.equal(trimCanvasFontValue(undefined), undefined);
  assert.equal(trimCanvasFontValue(marker), marker);
});

test('installCanvasFontCompat repairs leading whitespace on both 2D context prototypes', () => {
  const fake = createFakeWindow();

  assert.equal(installCanvasFontCompat(fake.scope), true);

  fake.context.font = ' normal 14px Menlo';
  assert.equal(fake.context.font, 'normal 14px Menlo');

  fake.offscreen.font = '  12px monospace';
  assert.equal(fake.offscreen.font, '12px monospace');
});

test('installCanvasFontCompat leaves already valid font strings untouched', () => {
  const fake = createFakeWindow();
  installCanvasFontCompat(fake.scope);

  fake.context.font = 'italic bold 18px "Source Code Pro", monospace';
  assert.equal(fake.context.font, 'italic bold 18px "Source Code Pro", monospace');
});

test('installCanvasFontCompat is idempotent per window', () => {
  const fake = createFakeWindow();

  assert.equal(installCanvasFontCompat(fake.scope), true);
  assert.equal(installCanvasFontCompat(fake.scope), false);

  fake.context.font = ' normal 14px Menlo';
  assert.equal(fake.context.font, 'normal 14px Menlo');
});

test('installCanvasFontCompat ignores scopes without canvas prototypes', () => {
  assert.equal(installCanvasFontCompat({} as unknown as Window), false);
});
