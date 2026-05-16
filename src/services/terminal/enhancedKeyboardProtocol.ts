import {
  encodeWin32InputModeKeyEvent,
} from './win32InputModeEncoder.ts';
import {
  encodeClaudeCodeExtendedKey,
  type ClaudeCodeExtendedKeyboardMode,
} from './claudeCodeTuiSupport.ts';

export interface KeyboardEventLike {
  type: string;
  key: string;
  code?: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  isComposing?: boolean;
  keyCode?: number;
  location?: number;
  repeat?: boolean;
  getModifierState?: (key: string) => boolean;
  preventDefault?: () => void;
}

export interface KeyboardDecisionContext {
  hasSelection: boolean;
  shiftEnterMode?: 'newline' | 'win32-input-mode';
  extendedKeyboardMode?: ClaudeCodeExtendedKeyboardMode;
}

export type KeyboardDecision =
  | { type: 'allow-default' }
  | { type: 'copy-selection' }
  | { type: 'paste-from-clipboard' }
  | { type: 'block-default' }
  | { type: 'send-input'; data: string }
  | { type: 'write-text'; text: string }
  | { type: 'paste-newline' };

export { WIN32_SHIFT_ENTER_SEQUENCE } from './win32InputModeEncoder.ts';

export interface EnhancedKeyboardProtocolHandlers {
  queueInput: (data: string) => void;
  flushPendingInput: () => void;
  writeBinary: (data: Uint8Array) => void;
  hasSelection: () => boolean;
  getSelection: () => string;
  clearSelection: () => void;
  readClipboardText: () => Promise<string>;
  writeClipboardText: (text: string) => Promise<void>;
  insertText: (text: string) => void;
  pasteText: (text: string) => void;
  onError?: (message: string, error: unknown) => void;
}

export function formatPastedTerminalText(text: string, bracketedPasteMode: boolean): string {
  if (!text) {
    return text;
  }

  if (!bracketedPasteMode) {
    return text;
  }

  return `\x1b[200~${text}\x1b[201~`;
}

function isImeCompositionKeyboardEvent(event: KeyboardEventLike): boolean {
  return event.isComposing === true || event.key === 'Process' || event.keyCode === 229;
}

export function evaluateKeyboardDecision(
  event: KeyboardEventLike,
  context: KeyboardDecisionContext
): KeyboardDecision {
  if (context.shiftEnterMode === 'win32-input-mode') {
    // Let xterm's textarea/composition pipeline handle IME process keys so
    // win32-input-mode does not send raw phonetic keystrokes before commit.
    if (isImeCompositionKeyboardEvent(event)) {
      return { type: 'allow-default' };
    }

    if (event.type === 'keypress') {
      return { type: 'block-default' };
    }

    if (event.type === 'keydown' && event.ctrlKey && event.key === 'c' && context.hasSelection) {
      return { type: 'copy-selection' };
    }

    if (event.type === 'keydown' && event.ctrlKey && event.key === 'v') {
      return { type: 'paste-from-clipboard' };
    }

    // Intercept modifier+Enter before win32-input-mode encoding so that
    // programs running inside WSL (e.g. Codex CLI) receive a real newline
    // instead of a win32 KEY_EVENT_RECORD that conpty maps back to plain CR.
    if (event.type === 'keydown' && event.key === 'Enter' && !event.metaKey
      && (event.shiftKey || event.ctrlKey || event.altKey)) {
      return { type: 'paste-newline' };
    }

    const encoded = encodeWin32InputModeKeyEvent(event);
    if (encoded) {
      return { type: 'send-input', data: encoded };
    }

    return { type: 'allow-default' };
  }

  if (event.type !== 'keydown') {
    return { type: 'allow-default' };
  }

  if (event.ctrlKey && event.key === 'c') {
    if (!context.hasSelection) {
      return { type: 'allow-default' };
    }

    return { type: 'copy-selection' };
  }

  if (event.ctrlKey && event.key === 'v') {
    return { type: 'paste-from-clipboard' };
  }

  const extendedKey = encodeClaudeCodeExtendedKey(
    event,
    context.extendedKeyboardMode ?? 'none',
  );
  if (extendedKey) {
    return { type: 'send-input', data: extendedKey };
  }

  if (event.key === 'Enter' && !event.metaKey && (event.shiftKey || event.ctrlKey || event.altKey)) {
    // Shift+Enter, Ctrl+Enter, and Alt+Enter all insert a newline.
    // Use the paste path so that shells with bracketed paste mode (e.g. Codex CLI
    // in WSL) treat the newline as a multiline edit rather than a submit action.
    return { type: 'paste-newline' };
  }

  return { type: 'allow-default' };
}

export function decodeBinaryInput(data: string): Uint8Array {
  return Uint8Array.from(Buffer.from(data, 'base64'));
}

export class EnhancedKeyboardProtocol {
  private readonly handlers: EnhancedKeyboardProtocolHandlers;
  private readonly getDecisionContext: () => Partial<KeyboardDecisionContext>;
  private suppressWin32ShortcutEvents = false;

  constructor(
    handlers: EnhancedKeyboardProtocolHandlers,
    decisionContext: Partial<KeyboardDecisionContext> | (() => Partial<KeyboardDecisionContext>) = {}
  ) {
    this.handlers = handlers;
    this.getDecisionContext =
      typeof decisionContext === 'function' ? decisionContext : () => decisionContext;
  }

  handleData(data: string): void {
    this.handlers.queueInput(data);
  }

  handleBinary(data: string): void {
    this.handlers.flushPendingInput();
    this.handlers.writeBinary(decodeBinaryInput(data));
  }

  handleKeyboardEvent(event: KeyboardEventLike): boolean {
    const decisionContext = this.getDecisionContext();
    if (this.shouldSuppressWin32ShortcutEvent(event, decisionContext)) {
      event.preventDefault?.();
      return false;
    }

    const decision = evaluateKeyboardDecision(event, {
      hasSelection: this.handlers.hasSelection(),
      shiftEnterMode: decisionContext.shiftEnterMode ?? 'newline',
      extendedKeyboardMode: decisionContext.extendedKeyboardMode ?? 'none',
    });

    switch (decision.type) {
      case 'allow-default':
        return true;
      case 'copy-selection':
        if (decisionContext.shiftEnterMode === 'win32-input-mode') {
          this.suppressWin32ShortcutEvents = true;
        }
        event.preventDefault?.();
        this.copySelection();
        return false;
      case 'paste-from-clipboard':
        if (decisionContext.shiftEnterMode === 'win32-input-mode') {
          this.suppressWin32ShortcutEvents = true;
        }
        event.preventDefault?.();
        this.pasteClipboard();
        return false;
      case 'block-default':
        event.preventDefault?.();
        return false;
      case 'send-input':
        event.preventDefault?.();
        this.handlers.queueInput(decision.data);
        return false;
      case 'write-text':
        if (decisionContext.shiftEnterMode === 'win32-input-mode') {
          this.suppressWin32ShortcutEvents = true;
        }
        event.preventDefault?.();
        this.handlers.flushPendingInput();
        this.handlers.insertText(decision.text);
        return false;
      case 'paste-newline':
        // NOTE: Do NOT set suppressWin32ShortcutEvents here.
        // Unlike copy/paste, newline insertion has no follow-up keyup side effects.
        // Setting the flag would prevent repeat Shift+Enter (holding Shift and
        // pressing Enter multiple times) because the suppression only resets on a
        // bare keyup with no modifiers held.
        event.preventDefault?.();
        this.handlers.flushPendingInput();
        this.handlers.pasteText('\n');
        return false;
    }
  }

  private copySelection(): void {
    const selectedText = this.handlers.getSelection();

    void this.handlers.writeClipboardText(selectedText)
      .then(() => {
        this.handlers.clearSelection();
      })
      .catch((error) => {
        this.handlers.onError?.('Copy failed', error);
      });
  }

  private pasteClipboard(): void {
    void this.handlers.readClipboardText()
      .then((text) => {
        if (text) {
          this.handlers.flushPendingInput();
          this.handlers.pasteText(text);
        }
      })
      .catch((error) => {
        this.handlers.onError?.('Paste failed', error);
      });
  }

  private shouldSuppressWin32ShortcutEvent(
    event: KeyboardEventLike,
    decisionContext: Partial<KeyboardDecisionContext>
  ): boolean {
    if (
      decisionContext.shiftEnterMode !== 'win32-input-mode'
      || !this.suppressWin32ShortcutEvents
    ) {
      return false;
    }

    // Only suppress trailing keyup events from the previous shortcut chord (e.g. the
    // `v`/`c` keyup after Ctrl+V/Ctrl+C, or the final `Control` keyup). A fresh
    // keydown — including a repeat Ctrl+V/Ctrl+C while Ctrl is still held — must
    // re-enter `evaluateKeyboardDecision` so consecutive copy/paste presses keep
    // working. Without this carve-out the flag would block every keydown until the
    // user fully released the modifiers.
    if (event.type !== 'keyup') {
      return false;
    }

    if (!event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
      this.suppressWin32ShortcutEvents = false;
    }

    return true;
  }
}
