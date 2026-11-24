import * as assert from 'node:assert/strict';
import test from 'node:test';

import {
  installCanvasFontCompat,
  needsCanvasFontCompat,
  trimCanvasFontValue,
  uninstallCanvasFontCompat,
} from './canvasFontCompat.ts';

interface FakeWindowOptions {
  rejectLeadingWhitespace?: boolean;
  canvasFactory?: 'none' | 'obsidian-createEl' | 'dom-document';
}

interface FakeWindow {
  scope: Window;
  context: CanvasRenderingContext2D;
  offscreen: OffscreenCanvasRenderingContext2D;
  contextPrototype: object;
  offscreenPrototype: object;
  getCreatedCanvasCount: () => number;
}

function createFakeWindow(options: FakeWindowOptions = {}): FakeWindow {
  const rejectLeadingWhitespace = options.rejectLeadingWhitespace ?? false;
  const canvasFactory = options.canvasFactory ?? 'none';
  let createdCanvasCount = 0;

  class FakeCanvasContext {
    private value = '10px sans-serif';

    get font(): string {
      return this.value;
    }

    set font(next: string) {
      if (rejectLeadingWhitespace && /^\s/.test(next)) {
        return;
      }
      this.value = rejectLeadingWhitespace ? next : next.trimStart();
    }
  }

  class FakeOffscreenContext {
    private value = '10px sans-serif';

    get font(): string {
      return this.value;
    }

    set font(next: string) {
      if (rejectLeadingWhitespace && /^\s/.test(next)) {
        return;
      }
      this.value = rejectLeadingWhitespace ? next : next.trimStart();
    }
  }

  const makeCanvas = () => {
    createdCanvasCount += 1;
    const ctx = new FakeCanvasContext();
    return {
      getContext: (type: string) => (type === '2d' ? ctx : null),
    };
  };

  const rawScope: Record<string, unknown> = {
    CanvasRenderingContext2D: FakeCanvasContext,
    OffscreenCanvasRenderingContext2D: FakeOffscreenContext,
  };

  if (canvasFactory === 'obsidian-createEl') {
    rawScope.createEl = (tag: string) => (tag === 'canvas' ? makeCanvas() : null);
  } else if (canvasFactory === 'dom-document') {
    rawScope.document = {
      createElement: (tag: string) => (tag === 'canvas' ? makeCanvas() : null),
    };
  }

  return {
    scope: rawScope as unknown as Window,
    context: new FakeCanvasContext() as unknown as CanvasRenderingContext2D,
    offscreen: new FakeOffscreenContext() as unknown as OffscreenCanvasRenderingContext2D,
    contextPrototype: FakeCanvasContext.prototype,
    offscreenPrototype: FakeOffscreenContext.prototype,
    getCreatedCanvasCount: () => createdCanvasCount,
  };
}

test('trimCanvasFontValue removes leading whitespace only', () => {
  assert.equal(trimCanvasFontValue(' normal 14px Menlo'), 'normal 14px Menlo');
  assert.equal(trimCanvasFontValue(' bold 14px Menlo'), 'bold 14px Menlo');
  assert.equal(trimCanvasFontValue('\t\n12px monospace'), '12px monospace');
  assert.equal(trimCanvasFontValue('\u00a014px Menlo'), '14px Menlo');
  assert.equal(trimCanvasFontValue('italic normal 14px Menlo'), 'italic normal 14px Menlo');
  assert.equal(trimCanvasFontValue('bold 14px Menlo '), 'bold 14px Menlo ');
  assert.equal(trimCanvasFontValue(''), '');
});

test('trimCanvasFontValue passes non-string values through', () => {
  const marker = { font: true };
  assert.equal(trimCanvasFontValue(undefined), undefined);
  assert.equal(trimCanvasFontValue(marker), marker);
});

test('installCanvasFontCompat repairs leading whitespace on both 2D context prototypes', (t) => {
  t.after(() => {
    uninstallCanvasFontCompat();
  });
  const fake = createFakeWindow({ rejectLeadingWhitespace: true });

  assert.equal(installCanvasFontCompat(fake.scope), true);

  fake.context.font = ' normal 14px Menlo';
  assert.equal(fake.context.font, 'normal 14px Menlo');

  fake.context.font = ' bold 14px Menlo';
  assert.equal(fake.context.font, 'bold 14px Menlo');

  fake.offscreen.font = '  12px monospace';
  assert.equal(fake.offscreen.font, '12px monospace');
});

test('installCanvasFontCompat leaves already valid font strings untouched', (t) => {
  t.after(() => {
    uninstallCanvasFontCompat();
  });
  const fake = createFakeWindow({ rejectLeadingWhitespace: true });
  installCanvasFontCompat(fake.scope);

  fake.context.font = 'italic bold 18px "Source Code Pro", monospace';
  assert.equal(fake.context.font, 'italic bold 18px "Source Code Pro", monospace');
});

test('installCanvasFontCompat is idempotent per window', (t) => {
  t.after(() => {
    uninstallCanvasFontCompat();
  });
  const fake = createFakeWindow({ rejectLeadingWhitespace: true });

  assert.equal(installCanvasFontCompat(fake.scope), true);
  assert.equal(installCanvasFontCompat(fake.scope), false);

  fake.context.font = ' normal 14px Menlo';
  assert.equal(fake.context.font, 'normal 14px Menlo');
});

test('needsCanvasFontCompat detects broken Chromium 150 realms and caches the probe per window', (t) => {
  t.after(() => {
    uninstallCanvasFontCompat();
  });

  for (const canvasFactory of ['obsidian-createEl', 'dom-document'] as const) {
    const broken = createFakeWindow({
      rejectLeadingWhitespace: true,
      canvasFactory,
    });

    assert.equal(needsCanvasFontCompat(broken.scope), true);
    assert.equal(needsCanvasFontCompat(broken.scope), true);
    assert.equal(broken.getCreatedCanvasCount(), 1);

    assert.equal(installCanvasFontCompat(broken.scope), true);
    assert.equal(broken.getCreatedCanvasCount(), 1);

    broken.context.font = ' normal 16px monospace';
    assert.equal(broken.context.font, 'normal 16px monospace');
  }
});

test('installCanvasFontCompat skips prototype patching on unaffected Chromium builds', (t) => {
  t.after(() => {
    uninstallCanvasFontCompat();
  });

  const healthy = createFakeWindow({
    rejectLeadingWhitespace: false,
    canvasFactory: 'obsidian-createEl',
  });
  const originalSetter = Object.getOwnPropertyDescriptor(healthy.contextPrototype, 'font')?.set;

  assert.equal(needsCanvasFontCompat(healthy.scope), false);
  assert.equal(installCanvasFontCompat(healthy.scope), false);
  assert.equal(installCanvasFontCompat(healthy.scope), false);
  assert.equal(healthy.getCreatedCanvasCount(), 1);
  assert.equal(
    Object.getOwnPropertyDescriptor(healthy.contextPrototype, 'font')?.set,
    originalSetter,
  );
});

test('uninstallCanvasFontCompat restores original descriptors and prevents wrapper stacking', (t) => {
  t.after(() => {
    uninstallCanvasFontCompat();
  });

  const mainWin = createFakeWindow({
    rejectLeadingWhitespace: true,
    canvasFactory: 'obsidian-createEl',
  });
  const popoutWin = createFakeWindow({
    rejectLeadingWhitespace: true,
    canvasFactory: 'dom-document',
  });
  const originalMainContextSet = Object.getOwnPropertyDescriptor(
    mainWin.contextPrototype,
    'font',
  )?.set;
  const originalMainOffscreenSet = Object.getOwnPropertyDescriptor(
    mainWin.offscreenPrototype,
    'font',
  )?.set;
  const originalPopoutContextSet = Object.getOwnPropertyDescriptor(
    popoutWin.contextPrototype,
    'font',
  )?.set;

  assert.equal(installCanvasFontCompat(mainWin.scope), true);
  assert.equal(installCanvasFontCompat(popoutWin.scope), true);
  assert.notEqual(
    Object.getOwnPropertyDescriptor(mainWin.contextPrototype, 'font')?.set,
    originalMainContextSet,
  );

  // Uninstalling restores exact native descriptors across all realms.
  assert.equal(uninstallCanvasFontCompat(), true);
  assert.equal(uninstallCanvasFontCompat(), false);
  assert.equal(
    Object.getOwnPropertyDescriptor(mainWin.contextPrototype, 'font')?.set,
    originalMainContextSet,
  );
  assert.equal(
    Object.getOwnPropertyDescriptor(mainWin.offscreenPrototype, 'font')?.set,
    originalMainOffscreenSet,
  );
  assert.equal(
    Object.getOwnPropertyDescriptor(popoutWin.contextPrototype, 'font')?.set,
    originalPopoutContextSet,
  );

  // With the shim uninstalled, the broken setter rejects leading whitespace again.
  mainWin.context.font = '10px sans-serif';
  mainWin.context.font = ' normal 18px Menlo';
  assert.equal(mainWin.context.font, '10px sans-serif');

  // Re-installing after plugin reload works cleanly without stacking wrappers.
  assert.equal(installCanvasFontCompat(mainWin.scope), true);
  mainWin.context.font = ' normal 18px Menlo';
  assert.equal(mainWin.context.font, 'normal 18px Menlo');
});

test('uninstallCanvasFontCompat preserves downstream wrappers while disabling trimming', (t) => {
  t.after(() => {
    uninstallCanvasFontCompat();
  });

  const fake = createFakeWindow({
    rejectLeadingWhitespace: true,
    canvasFactory: 'obsidian-createEl',
  });
  installCanvasFontCompat(fake.scope);

  const afterTermyDescriptor = Object.getOwnPropertyDescriptor(fake.contextPrototype, 'font');
  assert.ok(afterTermyDescriptor?.set);

  const observedInputs: unknown[] = [];
  const downstreamSetter = function downstreamFontSetter(this: object, value: unknown): void {
    observedInputs.push(value);
    afterTermyDescriptor.set?.call(this, value);
  };
  Object.defineProperty(fake.contextPrototype, 'font', {
    ...afterTermyDescriptor,
    set: downstreamSetter,
  });

  assert.equal(uninstallCanvasFontCompat(fake.scope), true);
  assert.equal(
    Object.getOwnPropertyDescriptor(fake.contextPrototype, 'font')?.set,
    downstreamSetter,
  );

  fake.context.font = '10px sans-serif';
  fake.context.font = ' normal 20px Menlo';
  assert.deepEqual(observedInputs, ['10px sans-serif', ' normal 20px Menlo']);
  assert.equal(fake.context.font, '10px sans-serif');
});

test('installCanvasFontCompat ignores scopes without canvas prototypes', () => {
  assert.equal(installCanvasFontCompat({} as unknown as Window), false);
});
