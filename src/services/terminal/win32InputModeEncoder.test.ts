import * as assert from 'node:assert/strict';
import test from 'node:test';

import {
  encodeWin32InputModeKeyEvent,
  WIN32_SHIFT_ENTER_SEQUENCE,
  type Win32InputModeKeyboardEventLike,
} from './win32InputModeEncoder.ts';

function createKeyboardEvent(
  key: string,
  overrides: Partial<Win32InputModeKeyboardEventLike> = {}
): Win32InputModeKeyboardEventLike {
  return {
    type: 'keydown',
    key,
    code: overrides.code ?? (key.length === 1 ? `Key${key.toUpperCase()}` : key),
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...overrides,
  };
}

test('encodeWin32InputModeKeyEvent encodes printable lowercase letters', () => {
  const encoded = encodeWin32InputModeKeyEvent(createKeyboardEvent('a', { code: 'KeyA' }));

  assert.equal(encoded, '\x1b[65;30;97;1;0;1_');
});

test('encodeWin32InputModeKeyEvent encodes shifted printable letters with SHIFT state', () => {
  const encoded = encodeWin32InputModeKeyEvent(createKeyboardEvent('A', {
    code: 'KeyA',
    shiftKey: true,
  }));

  assert.equal(encoded, '\x1b[65;30;65;1;16;1_');
});

test('encodeWin32InputModeKeyEvent encodes Ctrl+letter as a virtual key event without Unicode text', () => {
  const encoded = encodeWin32InputModeKeyEvent(createKeyboardEvent('a', {
    code: 'KeyA',
    ctrlKey: true,
  }));

  assert.equal(encoded, '\x1b[65;30;0;1;8;1_');
});

test('encodeWin32InputModeKeyEvent preserves Unicode text for AltGraph characters', () => {
  const encoded = encodeWin32InputModeKeyEvent(createKeyboardEvent('@', {
    code: 'KeyQ',
    ctrlKey: true,
    altKey: true,
    getModifierState(key) {
      return key === 'AltGraph';
    },
  }));

  assert.equal(encoded, '\x1b[81;16;64;1;11;1_');
});

test('encodeWin32InputModeKeyEvent encodes modifier key presses', () => {
  const encoded = encodeWin32InputModeKeyEvent(createKeyboardEvent('Shift', {
    code: 'ShiftLeft',
    shiftKey: true,
  }));

  assert.equal(encoded, '\x1b[16;42;0;1;16;1_');
});

test('encodeWin32InputModeKeyEvent encodes modifier key releases', () => {
  const encoded = encodeWin32InputModeKeyEvent(createKeyboardEvent('Shift', {
    code: 'ShiftLeft',
    type: 'keyup',
    shiftKey: false,
  }));

  assert.equal(encoded, '\x1b[16;42;0;0;0;1_');
});

test('encodeWin32InputModeKeyEvent encodes Shift+Enter as KEY_EVENT_RECORD input', () => {
  const encoded = encodeWin32InputModeKeyEvent(createKeyboardEvent('Enter', {
    code: 'Enter',
    shiftKey: true,
  }));

  assert.equal(encoded, WIN32_SHIFT_ENTER_SEQUENCE);
});

test('encodeWin32InputModeKeyEvent marks enhanced navigation keys', () => {
  const encoded = encodeWin32InputModeKeyEvent(createKeyboardEvent('ArrowLeft', {
    code: 'ArrowLeft',
  }));

  assert.equal(encoded, '\x1b[37;75;0;1;256;1_');
});

test('encodeWin32InputModeKeyEvent encodes function keys', () => {
  const encoded = encodeWin32InputModeKeyEvent(createKeyboardEvent('F12', {
    code: 'F12',
  }));

  assert.equal(encoded, '\x1b[123;88;0;1;0;1_');
});

test('encodeWin32InputModeKeyEvent includes lock-key state when available', () => {
  const encoded = encodeWin32InputModeKeyEvent(createKeyboardEvent('a', {
    code: 'KeyA',
    getModifierState(key) {
      return key === 'CapsLock' || key === 'NumLock';
    },
  }));

  assert.equal(encoded, '\x1b[65;30;97;1;160;1_');
});

test('encodeWin32InputModeKeyEvent ignores keypress events', () => {
  const encoded = encodeWin32InputModeKeyEvent(createKeyboardEvent('a', {
    code: 'KeyA',
    type: 'keypress',
  }));

  assert.equal(encoded, null);
});
