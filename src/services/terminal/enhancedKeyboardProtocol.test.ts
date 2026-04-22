import * as assert from 'node:assert/strict';
import test from 'node:test';

import {
  decodeBinaryInput,
  EnhancedKeyboardProtocol,
  evaluateKeyboardDecision,
  type EnhancedKeyboardProtocolHandlers,
  type KeyboardEventLike,
} from './enhancedKeyboardProtocol.ts';

function createKeyboardEvent(
  key: string,
  overrides: Partial<KeyboardEventLike> = {}
): KeyboardEventLike & { prevented: boolean } {
  const event: KeyboardEventLike & { prevented: boolean } = {
    type: 'keydown',
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
  const textWrites: string[] = [];
  const clipboardWrites: string[] = [];
  let selection = 'selected text';
  let clearedSelection = false;
  const errors: Array<{ message: string; error: unknown }> = [];

  const handlers: EnhancedKeyboardProtocolHandlers = {
    queueInput(data) {
      queuedInput.push(data);
    },
    flushPendingInput() {},
    writeBinary(data) {
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
    writeText(text) {
      textWrites.push(text);
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
    textWrites,
    clipboardWrites,
    errors,
    get clearedSelection() {
      return clearedSelection;
    },
  };
}

test('evaluateKeyboardDecision keeps Ctrl+C without selection on the xterm default path', () => {
  const event = createKeyboardEvent('c', { ctrlKey: true });
  const decision = evaluateKeyboardDecision(event, { hasSelection: false });
  assert.deepEqual(decision, { type: 'allow-default' });
});

test('evaluateKeyboardDecision converts Shift+Enter into an explicit newline input', () => {
  const event = createKeyboardEvent('Enter', { shiftKey: true });
  const decision = evaluateKeyboardDecision(event, { hasSelection: false });
  assert.deepEqual(decision, { type: 'send-input', data: '\n' });
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
  assert.deepEqual(harness.textWrites, ['clipboard text']);
});

test('handleKeyboardEvent queues a newline for Shift+Enter and bypasses xterm enter handling', () => {
  const harness = createProtocolHarness();
  const event = createKeyboardEvent('Enter', { shiftKey: true });

  const allowed = harness.protocol.handleKeyboardEvent(event);

  assert.equal(allowed, false);
  assert.equal(event.prevented, true);
  assert.deepEqual(harness.queuedInput, ['\n']);
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
