export interface Win32InputModeKeyboardEventLike {
  type: string;
  key: string;
  code?: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  location?: number;
  repeat?: boolean;
  getModifierState?: (key: string) => boolean;
}

const DOM_KEY_LOCATION_RIGHT = 2;
const DOM_KEY_LOCATION_NUMPAD = 3;

const WIN32_CONTROL_KEY_STATE = {
  RIGHT_ALT_PRESSED: 0x0001,
  LEFT_ALT_PRESSED: 0x0002,
  RIGHT_CTRL_PRESSED: 0x0004,
  LEFT_CTRL_PRESSED: 0x0008,
  SHIFT_PRESSED: 0x0010,
  NUMLOCK_ON: 0x0020,
  SCROLLLOCK_ON: 0x0040,
  CAPSLOCK_ON: 0x0080,
  ENHANCED_KEY: 0x0100,
} as const;

const VIRTUAL_KEYS = {
  BACKSPACE: 0x08,
  TAB: 0x09,
  ENTER: 0x0d,
  SHIFT: 0x10,
  CONTROL: 0x11,
  ALT: 0x12,
  ESCAPE: 0x1b,
  SPACE: 0x20,
  PAGE_UP: 0x21,
  PAGE_DOWN: 0x22,
  END: 0x23,
  HOME: 0x24,
  LEFT: 0x25,
  UP: 0x26,
  RIGHT: 0x27,
  DOWN: 0x28,
  INSERT: 0x2d,
  DELETE: 0x2e,
  META_LEFT: 0x5b,
  META_RIGHT: 0x5c,
  CONTEXT_MENU: 0x5d,
  NUMPAD_0: 0x60,
  NUMPAD_1: 0x61,
  NUMPAD_2: 0x62,
  NUMPAD_3: 0x63,
  NUMPAD_4: 0x64,
  NUMPAD_5: 0x65,
  NUMPAD_6: 0x66,
  NUMPAD_7: 0x67,
  NUMPAD_8: 0x68,
  NUMPAD_9: 0x69,
  NUMPAD_MULTIPLY: 0x6a,
  NUMPAD_ADD: 0x6b,
  NUMPAD_SUBTRACT: 0x6d,
  NUMPAD_DECIMAL: 0x6e,
  NUMPAD_DIVIDE: 0x6f,
  F1: 0x70,
  F2: 0x71,
  F3: 0x72,
  F4: 0x73,
  F5: 0x74,
  F6: 0x75,
  F7: 0x76,
  F8: 0x77,
  F9: 0x78,
  F10: 0x79,
  F11: 0x7a,
  F12: 0x7b,
  F13: 0x7c,
  F14: 0x7d,
  F15: 0x7e,
  F16: 0x7f,
  F17: 0x80,
  F18: 0x81,
  F19: 0x82,
  F20: 0x83,
  F21: 0x84,
  F22: 0x85,
  F23: 0x86,
  F24: 0x87,
  NUMLOCK: 0x90,
  SCROLLLOCK: 0x91,
} as const;

const VIRTUAL_KEYS_BY_CODE: Record<string, number> = {
  Backspace: VIRTUAL_KEYS.BACKSPACE,
  Tab: VIRTUAL_KEYS.TAB,
  Enter: VIRTUAL_KEYS.ENTER,
  NumpadEnter: VIRTUAL_KEYS.ENTER,
  ShiftLeft: VIRTUAL_KEYS.SHIFT,
  ShiftRight: VIRTUAL_KEYS.SHIFT,
  ControlLeft: VIRTUAL_KEYS.CONTROL,
  ControlRight: VIRTUAL_KEYS.CONTROL,
  AltLeft: VIRTUAL_KEYS.ALT,
  AltRight: VIRTUAL_KEYS.ALT,
  Escape: VIRTUAL_KEYS.ESCAPE,
  Space: VIRTUAL_KEYS.SPACE,
  PageUp: VIRTUAL_KEYS.PAGE_UP,
  PageDown: VIRTUAL_KEYS.PAGE_DOWN,
  End: VIRTUAL_KEYS.END,
  Home: VIRTUAL_KEYS.HOME,
  ArrowLeft: VIRTUAL_KEYS.LEFT,
  ArrowUp: VIRTUAL_KEYS.UP,
  ArrowRight: VIRTUAL_KEYS.RIGHT,
  ArrowDown: VIRTUAL_KEYS.DOWN,
  Insert: VIRTUAL_KEYS.INSERT,
  Delete: VIRTUAL_KEYS.DELETE,
  MetaLeft: VIRTUAL_KEYS.META_LEFT,
  MetaRight: VIRTUAL_KEYS.META_RIGHT,
  ContextMenu: VIRTUAL_KEYS.CONTEXT_MENU,
  Numpad0: VIRTUAL_KEYS.NUMPAD_0,
  Numpad1: VIRTUAL_KEYS.NUMPAD_1,
  Numpad2: VIRTUAL_KEYS.NUMPAD_2,
  Numpad3: VIRTUAL_KEYS.NUMPAD_3,
  Numpad4: VIRTUAL_KEYS.NUMPAD_4,
  Numpad5: VIRTUAL_KEYS.NUMPAD_5,
  Numpad6: VIRTUAL_KEYS.NUMPAD_6,
  Numpad7: VIRTUAL_KEYS.NUMPAD_7,
  Numpad8: VIRTUAL_KEYS.NUMPAD_8,
  Numpad9: VIRTUAL_KEYS.NUMPAD_9,
  NumpadMultiply: VIRTUAL_KEYS.NUMPAD_MULTIPLY,
  NumpadAdd: VIRTUAL_KEYS.NUMPAD_ADD,
  NumpadSubtract: VIRTUAL_KEYS.NUMPAD_SUBTRACT,
  NumpadDecimal: VIRTUAL_KEYS.NUMPAD_DECIMAL,
  NumpadDivide: VIRTUAL_KEYS.NUMPAD_DIVIDE,
  F1: VIRTUAL_KEYS.F1,
  F2: VIRTUAL_KEYS.F2,
  F3: VIRTUAL_KEYS.F3,
  F4: VIRTUAL_KEYS.F4,
  F5: VIRTUAL_KEYS.F5,
  F6: VIRTUAL_KEYS.F6,
  F7: VIRTUAL_KEYS.F7,
  F8: VIRTUAL_KEYS.F8,
  F9: VIRTUAL_KEYS.F9,
  F10: VIRTUAL_KEYS.F10,
  F11: VIRTUAL_KEYS.F11,
  F12: VIRTUAL_KEYS.F12,
  F13: VIRTUAL_KEYS.F13,
  F14: VIRTUAL_KEYS.F14,
  F15: VIRTUAL_KEYS.F15,
  F16: VIRTUAL_KEYS.F16,
  F17: VIRTUAL_KEYS.F17,
  F18: VIRTUAL_KEYS.F18,
  F19: VIRTUAL_KEYS.F19,
  F20: VIRTUAL_KEYS.F20,
  F21: VIRTUAL_KEYS.F21,
  F22: VIRTUAL_KEYS.F22,
  F23: VIRTUAL_KEYS.F23,
  F24: VIRTUAL_KEYS.F24,
  NumLock: VIRTUAL_KEYS.NUMLOCK,
  ScrollLock: VIRTUAL_KEYS.SCROLLLOCK,
  Semicolon: 0xba,
  Equal: 0xbb,
  Comma: 0xbc,
  Minus: 0xbd,
  Period: 0xbe,
  Slash: 0xbf,
  Backquote: 0xc0,
  BracketLeft: 0xdb,
  Backslash: 0xdc,
  BracketRight: 0xdd,
  Quote: 0xde,
  IntlBackslash: 0xe2,
};

const SCAN_CODES_BY_CODE: Record<string, number> = {
  Escape: 0x01,
  Digit1: 0x02,
  Digit2: 0x03,
  Digit3: 0x04,
  Digit4: 0x05,
  Digit5: 0x06,
  Digit6: 0x07,
  Digit7: 0x08,
  Digit8: 0x09,
  Digit9: 0x0a,
  Digit0: 0x0b,
  Minus: 0x0c,
  Equal: 0x0d,
  Backspace: 0x0e,
  Tab: 0x0f,
  KeyQ: 0x10,
  KeyW: 0x11,
  KeyE: 0x12,
  KeyR: 0x13,
  KeyT: 0x14,
  KeyY: 0x15,
  KeyU: 0x16,
  KeyI: 0x17,
  KeyO: 0x18,
  KeyP: 0x19,
  BracketLeft: 0x1a,
  BracketRight: 0x1b,
  Enter: 0x1c,
  ControlLeft: 0x1d,
  KeyA: 0x1e,
  KeyS: 0x1f,
  KeyD: 0x20,
  KeyF: 0x21,
  KeyG: 0x22,
  KeyH: 0x23,
  KeyJ: 0x24,
  KeyK: 0x25,
  KeyL: 0x26,
  Semicolon: 0x27,
  Quote: 0x28,
  Backquote: 0x29,
  ShiftLeft: 0x2a,
  Backslash: 0x2b,
  KeyZ: 0x2c,
  KeyX: 0x2d,
  KeyC: 0x2e,
  KeyV: 0x2f,
  KeyB: 0x30,
  KeyN: 0x31,
  KeyM: 0x32,
  Comma: 0x33,
  Period: 0x34,
  Slash: 0x35,
  ShiftRight: 0x36,
  NumpadMultiply: 0x37,
  AltLeft: 0x38,
  Space: 0x39,
  CapsLock: 0x3a,
  F1: 0x3b,
  F2: 0x3c,
  F3: 0x3d,
  F4: 0x3e,
  F5: 0x3f,
  F6: 0x40,
  F7: 0x41,
  F8: 0x42,
  F9: 0x43,
  F10: 0x44,
  NumLock: 0x45,
  ScrollLock: 0x46,
  Numpad7: 0x47,
  Numpad8: 0x48,
  Numpad9: 0x49,
  NumpadSubtract: 0x4a,
  Numpad4: 0x4b,
  Numpad5: 0x4c,
  Numpad6: 0x4d,
  NumpadAdd: 0x4e,
  Numpad1: 0x4f,
  Numpad2: 0x50,
  Numpad3: 0x51,
  Numpad0: 0x52,
  NumpadDecimal: 0x53,
  IntlBackslash: 0x56,
  F11: 0x57,
  F12: 0x58,
  NumpadEnter: 0x1c,
  ControlRight: 0x1d,
  NumpadDivide: 0x35,
  AltRight: 0x38,
  Home: 0x47,
  ArrowUp: 0x48,
  PageUp: 0x49,
  ArrowLeft: 0x4b,
  ArrowRight: 0x4d,
  End: 0x4f,
  ArrowDown: 0x50,
  PageDown: 0x51,
  Insert: 0x52,
  Delete: 0x53,
  MetaLeft: 0x5b,
  MetaRight: 0x5c,
  ContextMenu: 0x5d,
};

const SPECIAL_KEY_CHAR_CODES: Record<string, number> = {
  Backspace: 0x08,
  Tab: 0x09,
  Enter: 0x0d,
  NumpadEnter: 0x0d,
  Escape: 0x1b,
  Space: 0x20,
};

const ENHANCED_KEY_CODES = new Set([
  'PageUp',
  'PageDown',
  'End',
  'Home',
  'ArrowLeft',
  'ArrowUp',
  'ArrowRight',
  'ArrowDown',
  'Insert',
  'Delete',
  'NumpadDivide',
  'NumpadEnter',
  'ControlRight',
  'AltRight',
  'MetaLeft',
  'MetaRight',
  'ContextMenu',
]);

function normalizeCode(event: Win32InputModeKeyboardEventLike): string | undefined {
  if (event.code) {
    return event.code;
  }

  if (event.key === 'Shift') {
    return event.location === DOM_KEY_LOCATION_RIGHT ? 'ShiftRight' : 'ShiftLeft';
  }
  if (event.key === 'Control') {
    return event.location === DOM_KEY_LOCATION_RIGHT ? 'ControlRight' : 'ControlLeft';
  }
  if (event.key === 'Alt') {
    return event.location === DOM_KEY_LOCATION_RIGHT ? 'AltRight' : 'AltLeft';
  }
  if (event.key === 'Meta') {
    return event.location === DOM_KEY_LOCATION_RIGHT ? 'MetaRight' : 'MetaLeft';
  }
  if (event.key === 'Enter' && event.location === DOM_KEY_LOCATION_NUMPAD) {
    return 'NumpadEnter';
  }

  return undefined;
}

function getModifierState(event: Win32InputModeKeyboardEventLike, key: string): boolean {
  return event.getModifierState?.call(event, key) ?? false;
}

function resolveVirtualKeyCode(event: Win32InputModeKeyboardEventLike, code: string | undefined): number | null {
  if (code) {
    if (/^Key[A-Z]$/.test(code)) {
      return code.charCodeAt(code.length - 1);
    }

    if (/^Digit[0-9]$/.test(code)) {
      return code.charCodeAt(code.length - 1);
    }

    const specialVirtualKey = VIRTUAL_KEYS_BY_CODE[code];
    if (specialVirtualKey !== undefined) {
      return specialVirtualKey;
    }
  }

  if (event.key.length === 1) {
    const codePoint = event.key.toUpperCase().codePointAt(0);
    if (codePoint !== undefined && codePoint <= 0x7f) {
      return codePoint;
    }
  }

  return null;
}

function resolveScanCode(code: string | undefined): number {
  if (!code) {
    return 0;
  }

  return SCAN_CODES_BY_CODE[code] ?? 0;
}

function resolveUnicodeChar(event: Win32InputModeKeyboardEventLike, code: string | undefined): number {
  const { key, ctrlKey, altKey, metaKey } = event;
  const isAltGraph = getModifierState(event, 'AltGraph');

  if (code) {
    const specialCharCode = SPECIAL_KEY_CHAR_CODES[code];
    if (specialCharCode !== undefined) {
      return specialCharCode;
    }
  }

  if (SPECIAL_KEY_CHAR_CODES[key] !== undefined) {
    return SPECIAL_KEY_CHAR_CODES[key];
  }

  if ((ctrlKey || altKey || metaKey) && !isAltGraph) {
    return 0;
  }

  if (key.length !== 1) {
    return 0;
  }

  return key.codePointAt(0) ?? 0;
}

function resolveControlKeyState(
  event: Win32InputModeKeyboardEventLike,
  code: string | undefined
): number {
  const { ctrlKey, shiftKey, altKey } = event;
  let state = 0;

  const isAltGraph = getModifierState(event, 'AltGraph');

  if (shiftKey) {
    state |= WIN32_CONTROL_KEY_STATE.SHIFT_PRESSED;
  }

  if (ctrlKey) {
    state |= code === 'ControlRight'
      ? WIN32_CONTROL_KEY_STATE.RIGHT_CTRL_PRESSED
      : WIN32_CONTROL_KEY_STATE.LEFT_CTRL_PRESSED;
  }

  if (altKey) {
    state |= code === 'AltRight'
      ? WIN32_CONTROL_KEY_STATE.RIGHT_ALT_PRESSED
      : WIN32_CONTROL_KEY_STATE.LEFT_ALT_PRESSED;
  }

  if (isAltGraph) {
    state |= WIN32_CONTROL_KEY_STATE.RIGHT_ALT_PRESSED;
    state |= WIN32_CONTROL_KEY_STATE.LEFT_CTRL_PRESSED;
  }

  if (getModifierState(event, 'NumLock')) {
    state |= WIN32_CONTROL_KEY_STATE.NUMLOCK_ON;
  }

  if (getModifierState(event, 'ScrollLock')) {
    state |= WIN32_CONTROL_KEY_STATE.SCROLLLOCK_ON;
  }

  if (getModifierState(event, 'CapsLock')) {
    state |= WIN32_CONTROL_KEY_STATE.CAPSLOCK_ON;
  }

  if (code && ENHANCED_KEY_CODES.has(code)) {
    state |= WIN32_CONTROL_KEY_STATE.ENHANCED_KEY;
  }

  return state;
}

// KEY_EVENT_RECORD-compatible Shift+Enter keydown sequence used by win32-input-mode.
// Equivalent to Vk=13 (VK_RETURN), Sc=28, Uc=13 ('\r'), Kd=1, Cs=16 (SHIFT_PRESSED), Rc=1.
export const WIN32_SHIFT_ENTER_SEQUENCE = '\x1b[13;28;13;1;16;1_';

export function encodeWin32InputModeKeyEvent(
  event: Win32InputModeKeyboardEventLike
): string | null {
  if (event.type !== 'keydown' && event.type !== 'keyup') {
    return null;
  }

  const code = normalizeCode(event);
  const virtualKeyCode = resolveVirtualKeyCode(event, code);
  if (virtualKeyCode === null) {
    return null;
  }

  const scanCode = resolveScanCode(code);
  const unicodeChar = resolveUnicodeChar(event, code);
  const controlKeyState = resolveControlKeyState(event, code);
  const keyDown = event.type === 'keydown' ? 1 : 0;

  return `\x1b[${virtualKeyCode};${scanCode};${unicodeChar};${keyDown};${controlKeyState};1_`;
}
