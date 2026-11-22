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
 * rejects it: the grid keeps its real size and regular glyphs fall back to the default 10px font.
 *
 * See https://github.com/ZyphrZero/Termy/issues/32
 */

const patchedPrototypes = new WeakSet<object>();

type CanvasFontSetter = (this: object, value: string) => void;

/** Leading whitespace carries no meaning in the CSS font shorthand, so trimming it is lossless. */
export function trimCanvasFontValue(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trimStart();
  return trimmed === value ? value : trimmed;
}

function isObjectLike(value: unknown): value is object {
  return typeof value === 'function' || (typeof value === 'object' && value !== null);
}

function patchFontSetter(prototype: unknown): boolean {
  if (!isObjectLike(prototype) || patchedPrototypes.has(prototype)) {
    return false;
  }

  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'font');
  if (!descriptor || typeof descriptor.set !== 'function') {
    return false;
  }

  const patchedSetter: CanvasFontSetter = function patchedCanvasFontSetter(
    this: object,
    value: string,
  ): void {
    const trimmed = trimCanvasFontValue(value);
    descriptor.set?.call(this, typeof trimmed === 'string' ? trimmed : value);
  };

  Object.defineProperty(prototype, 'font', { ...descriptor, set: patchedSetter });
  patchedPrototypes.add(prototype);
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
 * Install the shim on the given window. Every canvas realm (the main window and each pop-out window)
 * owns its prototypes, so call this for the window that hosts the terminal. Repeat calls for the
 * same window are no-ops.
 *
 * @returns `true` when this call patched at least one prototype.
 */
export function installCanvasFontCompat(scope: Window = window): boolean {
  if (!isObjectLike(scope)) {
    return false;
  }

  const patchedContext = patchFontSetter(
    resolveContextPrototype(scope, 'CanvasRenderingContext2D'),
  );
  const patchedOffscreen = patchFontSetter(
    resolveContextPrototype(scope, 'OffscreenCanvasRenderingContext2D'),
  );
  return patchedContext || patchedOffscreen;
}
