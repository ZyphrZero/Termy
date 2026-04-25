import * as assert from 'node:assert/strict';
import test from 'node:test';

import {
  decodeBinaryInput,
  EnhancedKeyboardProtocol,
  evaluateKeyboardDecision,
  formatPastedTerminalText,
  WIN32_SHIFT_ENTER_SEQUENCE,
  type EnhancedKeyboardProtocolHandlers,
  type KeyboardEventLike,
} from './enhancedKeyboardProtocol.ts';

function createKeyboardEvent(
  key: string,
  overrides: Partial<KeyboardEventLike> = {}
): KeyboardEventLike & { prevented: boolean } {
  const event: KeyboardEventLike & { prevented: boolean } = {
    type: 'keydown',
    code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
    key,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    prevented: false,
    preventDefault() {
      event.prevented = true;
    },
    ...overrides,
  };

  return event;
}

function createProtocolHarness(overrides: Partial<EnhancedKeyboardProtocolHandlers> = {}) {
  const queuedInput: string[] = [];
  const binaryWrites: Uint8Array[] = [];
  const insertedTexts: string[] = [];
  const pastedTexts: string[] = [];
  const operations: string[] = [];
  const clipboardWrites: string[] = [];
  let selection = 'selected text';
  let clearedSelection = false;
  const errors: Array<{ message: string; error: unknown }> = [];

  const handlers: EnhancedKeyboardProtocolHandlers = {
    queueInput(data) {
      operations.push(`queue:${data}`);
      queuedInput.push(data);
    },
    flushPendingInput() {
      operations.push('flush');
    },
    writeBinary(data) {
      operations.push('binary');
      binaryWrites.push(data);
    },
    hasSelection() {
      return selection.length > 0;
    },
    getSelection() {
      return selection;
    },
    clearSelection() {
      clearedSelection = true;
      selection = '';
    },
    async readClipboardText() {
      return 'clipboard text';
    },
    async writeClipboardText(text) {
      clipboardWrites.push(text);
    },
    insertText(text) {
      operations.push(`insert:${text}`);
      insertedTexts.push(text);
    },
    pasteText(text) {
      operations.push(`paste:${text}`);
      pastedTexts.push(text);
    },
    onError(message, error) {
      errors.push({ message, error });
    },
    ...overrides,
  };

  return {
    protocol: new EnhancedKeyboardProtocol(handlers),
    queuedInput,
    binaryWrites,
    insertedTexts,
    pastedTexts,
    operations,
    clipboardWrites,
    errors,
    get clearedSelection() {
      return clearedSelection;
    },
  };
}

function createWin32ProtocolHarness() {
  const harness = createProtocolHarness();
  const protocol = new EnhancedKeyboardProtocol(
    {
      queueInput(data) {
        harness.operations.push(`queue:${data}`);
        harness.queuedInput.push(data);
      },
      flushPendingInput() {
        harness.operations.push('flush');
      },
      writeBinary(data) {
        harness.operations.push('binary');
        harness.binaryWrites.push(data);
      },
      hasSelection() {
        return false;
      },
      getSelection() {
        return '';
      },
      clearSelection() {},
      async readClipboardText() {
        return 'clipboard text';
      },
      async writeClipboardText() {},
      insertText(text) {
        harness.operations.push(`insert:${text}`);
        harness.insertedTexts.push(text);
      },
      pasteText(text) {
        harness.operations.push(`paste:${text}`);
        harness.pastedTexts.push(text);
      },
    },
    () => ({ shiftEnterMode: 'win32-input-mode' })
  );

  return { harness, protocol };
}

test('evaluateKeyboardDecision keeps Ctrl+C without selection on the xterm default path', () => {
  const event = createKeyboardEvent('c', { ctrlKey: true });
  const decision = evaluateKeyboardDecision(event, { hasSelection: false });
  assert.deepEqual(decision, { type: 'allow-default' });
});

test('evaluateKeyboardDecision routes Shift+Enter through text insertion', () => {
  const event = createKeyboardEvent('Enter', { shiftKey: true });
  const decision = evaluateKeyboardDecision(event, { hasSelection: false });
  assert.deepEqual(decision, { type: 'write-text', text: '\n' });
});

test('evaluateKeyboardDecision routes Shift+Enter through kitty keyboard protocol when enabled', () => {
  const event = createKeyboardEvent('Enter', { shiftKey: true });
  const decision = evaluateKeyboardDecision(event, {
    hasSelection: false,
    extendedKeyboardMode: 'kitty',
  });
  assert.deepEqual(decision, { type: 'send-input', data: '\x1b[13;2u' });
});

test('evaluateKeyboardDecision routes Ctrl+Shift+letter through modifyOtherKeys when enabled', () => {
  const event = createKeyboardEvent('C', { ctrlKey: true, shiftKey: true });
  const decision = evaluateKeyboardDecision(event, {
    hasSelection: false,
    extendedKeyboardMode: 'modifyOtherKeys',
  });
  assert.deepEqual(decision, { type: 'send-input', data: '\x1b[27;6;67~' });
});

test('evaluateKeyboardDecision maps Shift+Enter to win32-input-mode when requested', () => {
  const event = createKeyboardEvent('Enter', { shiftKey: true });
  const decision = evaluateKeyboardDecision(event, {
    hasSelection: false,
    shiftEnterMode: 'win32-input-mode',
  });
  assert.deepEqual(decision, { type: 'send-input', data: WIN32_SHIFT_ENTER_SEQUENCE });
});

test('handleKeyboardEvent copies the current selection and blocks xterm default handling', async () => {
  const harness = createProtocolHarness();
  const event = createKeyboardEvent('c', { ctrlKey: true });

  const allowed = harness.protocol.handleKeyboardEvent(event);
  await Promise.resolve();

  assert.equal(allowed, false);
  assert.equal(event.prevented, true);
  assert.deepEqual(harness.clipboardWrites, ['selected text']);
  assert.equal(harness.clearedSelection, true);
});

test('handleKeyboardEvent pastes clipboard text through the terminal write path', async () => {
  const harness = createProtocolHarness();
  const event = createKeyboardEvent('v', { ctrlKey: true });

  const allowed = harness.protocol.handleKeyboardEvent(event);
  await Promise.resolve();

  assert.equal(allowed, false);
  assert.equal(event.prevented, true);
  assert.deepEqual(harness.pastedTexts, ['clipboard text']);
  assert.deepEqual(harness.insertedTexts, []);
  assert.deepEqual(harness.operations, ['flush', 'paste:clipboard text']);
});

test('handleKeyboardEvent inserts a newline for Shift+Enter without queueing raw input', () => {
  const harness = createProtocolHarness();
  const event = createKeyboardEvent('Enter', { shiftKey: true });

  const allowed = harness.protocol.handleKeyboardEvent(event);

  assert.equal(allowed, false);
  assert.equal(event.prevented, true);
  assert.deepEqual(harness.insertedTexts, ['\n']);
  assert.deepEqual(harness.queuedInput, []);
  assert.deepEqual(harness.pastedTexts, []);
  assert.deepEqual(harness.operations, ['flush', 'insert:\n']);
});

test('handleKeyboardEvent queues the win32-input-mode Shift+Enter sequence when configured', () => {
  const { harness, protocol } = createWin32ProtocolHarness();
  const event = createKeyboardEvent('Enter', { shiftKey: true });

  const allowed = protocol.handleKeyboardEvent(event);

  assert.equal(allowed, false);
  assert.equal(event.prevented, true);
  assert.deepEqual(harness.queuedInput, [WIN32_SHIFT_ENTER_SEQUENCE]);
  assert.deepEqual(harness.insertedTexts, []);
  assert.deepEqual(harness.pastedTexts, []);
  assert.deepEqual(harness.operations, ['queue:\x1b[13;28;13;1;16;1_']);
});

test('handleKeyboardEvent queues win32-input-mode keyup events when configured', () => {
  const { harness, protocol } = createWin32ProtocolHarness();
  const event = createKeyboardEvent('a', { code: 'KeyA', type: 'keyup' });

  const allowed = protocol.handleKeyboardEvent(event);

  assert.equal(allowed, false);
  assert.equal(event.prevented, true);
  assert.deepEqual(harness.queuedInput, ['\x1b[65;30;97;0;0;1_']);
});

test('handleKeyboardEvent blocks keypress default handling in win32-input-mode', () => {
  const { harness, protocol } = createWin32ProtocolHarness();
  const event = createKeyboardEvent('a', { code: 'KeyA', type: 'keypress' });

  const allowed = protocol.handleKeyboardEvent(event);

  assert.equal(allowed, false);
  assert.equal(event.prevented, true);
  assert.deepEqual(harness.queuedInput, []);
  assert.deepEqual(harness.insertedTexts, []);
  assert.deepEqual(harness.pastedTexts, []);
});

test('handleKeyboardEvent lets xterm handle IME composition keydown events in win32-input-mode', () => {
  const { harness, protocol } = createWin32ProtocolHarness();
  const event = createKeyboardEvent('Process', { code: 'KeyX' }) as KeyboardEventLike & {
    prevented: boolean;
    isComposing?: boolean;
    keyCode?: number;
  };
  event.isComposing = true;
  event.keyCode = 229;

  const allowed = protocol.handleKeyboardEvent(event);

  assert.equal(allowed, true);
  assert.equal(event.prevented, false);
  assert.deepEqual(harness.queuedInput, []);
  assert.deepEqual(harness.insertedTexts, []);
  assert.deepEqual(harness.pastedTexts, []);
});

test('handleKeyboardEvent lets xterm handle win32 IME process keys even when browsers keep the physical key value', () => {
  const { harness, protocol } = createWin32ProtocolHarness();
  const event = createKeyboardEvent('x', { code: 'KeyX' }) as KeyboardEventLike & {
    prevented: boolean;
    keyCode?: number;
  };
  event.keyCode = 229;

  const allowed = protocol.handleKeyboardEvent(event);

  assert.equal(allowed, true);
  assert.equal(event.prevented, false);
  assert.deepEqual(harness.queuedInput, []);
  assert.deepEqual(harness.insertedTexts, []);
  assert.deepEqual(harness.pastedTexts, []);
});

test('handleKeyboardEvent suppresses follow-up win32 shortcut events after local paste handling', async () => {
  const { harness, protocol } = createWin32ProtocolHarness();

  const pasteKeydown = createKeyboardEvent('v', { code: 'KeyV', ctrlKey: true });
  const pasteKeyup = createKeyboardEvent('v', { code: 'KeyV', ctrlKey: true, type: 'keyup' });
  const ctrlKeyup = createKeyboardEvent('Control', {
    code: 'ControlLeft',
    ctrlKey: false,
    type: 'keyup',
  });
  const nextKeydown = createKeyboardEvent('a', { code: 'KeyA' });

  assert.equal(protocol.handleKeyboardEvent(pasteKeydown), false);
  await Promise.resolve();
  assert.deepEqual(harness.pastedTexts, ['clipboard text']);
  assert.deepEqual(harness.insertedTexts, []);
  assert.deepEqual(harness.queuedInput, []);
  assert.deepEqual(harness.operations, ['flush', 'paste:clipboard text']);

  assert.equal(protocol.handleKeyboardEvent(pasteKeyup), false);
  assert.equal(pasteKeyup.prevented, true);
  assert.deepEqual(harness.queuedInput, []);

  assert.equal(protocol.handleKeyboardEvent(ctrlKeyup), false);
  assert.equal(ctrlKeyup.prevented, true);
  assert.deepEqual(harness.queuedInput, []);

  assert.equal(protocol.handleKeyboardEvent(nextKeydown), false);
  assert.deepEqual(harness.queuedInput, ['\x1b[65;30;97;1;0;1_']);
});

test('handleData and handleBinary use the extracted input pipeline callbacks', () => {
  let flushCount = 0;
  const harness = createProtocolHarness({
    flushPendingInput() {
      flushCount += 1;
    },
  });

  harness.protocol.handleData('hello');
  harness.protocol.handleBinary('QUI=');

  assert.deepEqual(harness.queuedInput, ['hello']);
  assert.equal(flushCount, 1);
  assert.equal(harness.binaryWrites.length, 1);
  assert.deepEqual(Array.from(harness.binaryWrites[0]), [65, 66]);
});

test('decodeBinaryInput falls back to base64 decoding that matches xterm binary payloads', () => {
  const decoded = decodeBinaryInput('SGVsbG8=');
  assert.equal(new TextDecoder().decode(decoded), 'Hello');
});

test('formatPastedTerminalText wraps content only when bracketed paste mode is enabled', () => {
  assert.equal(formatPastedTerminalText('line 1\nline 2', false), 'line 1\nline 2');
  assert.equal(
    formatPastedTerminalText('line 1\nline 2', true),
    '\x1b[200~line 1\nline 2\x1b[201~'
  );
});
