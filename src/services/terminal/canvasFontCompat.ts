/**
 * Compatibility shim for a Chromium 150 canvas font parsing regression.
 *
 * Chromium 150 changed `CSSParser::ParseFont()` to parse the font shorthand directly and to require
 * the stream to be at its end right after parsing (crrev.com/c/8525429). The follow-up
 * `ConsumeWhitespace` fix (crrev.com/c/8573817) is not part of Electron 43, so assigning a font
 * string that starts with whitespace to a 2D context silently fails and the context keeps the font
 * it had before.
 *
 * xterm.js composes glyph fonts as `${italic} ${weight} ${size}px ${family}`. For non-italic glyphs
 * the italic slot is empty, so every such string starts with a space. Cell metrics are measured
 * through CSS, which tolerates the whitespace, while glyphs are painted through canvas, which now
 * rejects it: the grid keeps its real size and non-italic glyphs fall back to the default 10px font.
 *
 * See https://github.com/ZyphrZero/Termy/issues/32
 */

type CanvasFontSetter = (this: object, value: unknown) => void;

interface PatchedPrototypeEntry {
  originalDescriptor: PropertyDescriptor;
  patchedSetter: CanvasFontSetter;
  active: boolean;
}

const patchedPrototypes = new WeakMap<object, PatchedPrototypeEntry>();
const trackedPrototypes = new Set<WeakRef<object>>();
const scopeProbeCache = new WeakMap<object, boolean>();

/** Leading whitespace carries no meaning in the CSS font shorthand, so trimming it is lossless. */
export function trimCanvasFontValue(value: unknown): unknown {
  if (typeof value !== 'string' || value.length === 0) {
    return value;
  }
  const firstCode = value.charCodeAt(0);
  if (firstCode > 0x20 && firstCode < 0x80) {
    return value;
  }
  const trimmed = value.trimStart();
  return trimmed === value ? value : trimmed;
}

function isObjectLike(value: unknown): value is object {
  return typeof value === 'function' || (typeof value === 'object' && value !== null);
}

function sweepDeadPrototypeRefs(): void {
  for (const ref of trackedPrototypes) {
    if (!ref.deref()) {
      trackedPrototypes.delete(ref);
    }
  }
}

function tryCreateProbeCanvas(scope: Window): HTMLCanvasElement | null | undefined {
  if (typeof (scope as Partial<Window>).createEl === 'function') {
    return scope.createEl('canvas');
  }

  const doc = (scope as unknown as Record<string, unknown>).document;
  if (isObjectLike(doc)) {
    const docWithFactory = doc as { createElement?: (tag: string) => unknown };
    if (typeof docWithFactory.createElement === 'function') {
      const element = docWithFactory.createElement('canvas');
      return isObjectLike(element) ? (element as HTMLCanvasElement) : null;
    }
  }

  return undefined;
}

/**
 * Probe whether the given window's 2D canvas context rejects font strings with leading whitespace.
 * When no DOM canvas factory is available on `scope` (for example in minimal synthetic scopes),
 * defaults to `true` so callers can still install the lossless shim.
 */
export function needsCanvasFontCompat(scope: Window): boolean {
  if (!isObjectLike(scope)) {
    return false;
  }

  const cached = scopeProbeCache.get(scope);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const canvas = tryCreateProbeCanvas(scope);
    if (canvas === undefined) {
      return true;
    }
    const ctx = isObjectLike(canvas) && typeof canvas.getContext === 'function'
      ? canvas.getContext('2d')
      : null;
    if (!ctx) {
      scopeProbeCache.set(scope, false);
      return false;
    }

    ctx.font = '10px sans-serif';
    ctx.font = ' 24px monospace';
    const rejected = !ctx.font.includes('24px');
    scopeProbeCache.set(scope, rejected);
    return rejected;
  } catch {
    scopeProbeCache.set(scope, false);
    return false;
  }
}

function patchFontSetter(prototype: unknown): boolean {
  if (!isObjectLike(prototype) || patchedPrototypes.has(prototype)) {
    return false;
  }

  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'font');
  if (!descriptor || typeof descriptor.set !== 'function') {
    return false;
  }

  const entry: PatchedPrototypeEntry = {
    originalDescriptor: descriptor,
    patchedSetter: () => undefined,
    active: true,
  };

  const patchedSetter: CanvasFontSetter = function patchedCanvasFontSetter(
    this: object,
    value: unknown,
  ): void {
    const nextValue = entry.active ? trimCanvasFontValue(value) : value;
    descriptor.set?.call(this, nextValue);
  };
  entry.patchedSetter = patchedSetter;

  Object.defineProperty(prototype, 'font', { ...descriptor, set: patchedSetter });
  patchedPrototypes.set(prototype, entry);
  sweepDeadPrototypeRefs();
  trackedPrototypes.add(new WeakRef(prototype));
  return true;
}

function unpatchFontSetter(prototype: unknown): boolean {
  if (!isObjectLike(prototype)) {
    return false;
  }

  const entry = patchedPrototypes.get(prototype);
  if (!entry) {
    return false;
  }

  entry.active = false;
  patchedPrototypes.delete(prototype);

  const current = Object.getOwnPropertyDescriptor(prototype, 'font');
  if (current?.set === entry.patchedSetter) {
    Object.defineProperty(prototype, 'font', entry.originalDescriptor);
  }
  return true;
}

function resolveContextPrototype(scope: Window, key: string): unknown {
  const constructor = (scope as unknown as Record<string, unknown>)[key];
  if (!isObjectLike(constructor)) {
    return undefined;
  }
  return (constructor as { prototype?: unknown }).prototype;
}

/**
 * Install the shim on the given window when its canvas parser rejects leading whitespace.
 * Every canvas realm (the main window and each pop-out window) owns its prototypes, so call this
 * for the window that hosts the terminal. Repeat calls for the same window are no-ops.
 *
 * @returns `true` when this call patched at least one prototype.
 */
export function installCanvasFontCompat(scope: Window = window): boolean {
  if (!isObjectLike(scope)) {
    return false;
  }

  const contextPrototype = resolveContextPrototype(scope, 'CanvasRenderingContext2D');
  const offscreenPrototype = resolveContextPrototype(scope, 'OffscreenCanvasRenderingContext2D');
  if (!isObjectLike(contextPrototype) && !isObjectLike(offscreenPrototype)) {
    return false;
  }

  const contextDone = !isObjectLike(contextPrototype) || patchedPrototypes.has(contextPrototype);
  const offscreenDone =
    !isObjectLike(offscreenPrototype) || patchedPrototypes.has(offscreenPrototype);
  if (contextDone && offscreenDone) {
    return false;
  }

  if (!needsCanvasFontCompat(scope)) {
    return false;
  }

  const patchedContext = patchFontSetter(contextPrototype);
  const patchedOffscreen = patchFontSetter(offscreenPrototype);
  return patchedContext || patchedOffscreen;
}

/**
 * Restore the original `font` property descriptors patched by {@link installCanvasFontCompat}.
 * When `scope` is omitted, restores every patched window realm that is still alive.
 *
 * @returns `true` when at least one prototype was unpatched.
 */
export function uninstallCanvasFontCompat(scope?: Window): boolean {
  if (scope !== undefined) {
    if (!isObjectLike(scope)) {
      return false;
    }
    const unpatchedContext = unpatchFontSetter(
      resolveContextPrototype(scope, 'CanvasRenderingContext2D'),
    );
    const unpatchedOffscreen = unpatchFontSetter(
      resolveContextPrototype(scope, 'OffscreenCanvasRenderingContext2D'),
    );
    sweepDeadPrototypeRefs();
    return unpatchedContext || unpatchedOffscreen;
  }

  let restoredAny = false;
  for (const ref of trackedPrototypes) {
    const prototype = ref.deref();
    if (prototype && unpatchFontSetter(prototype)) {
      restoredAny = true;
    }
  }
  trackedPrototypes.clear();
  return restoredAny;
}
