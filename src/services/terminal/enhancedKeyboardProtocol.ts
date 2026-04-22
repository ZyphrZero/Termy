export interface KeyboardEventLike {
  type: string;
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  preventDefault?: () => void;
}

export interface KeyboardDecisionContext {
  hasSelection: boolean;
}

export type KeyboardDecision =
  | { type: 'allow-default' }
  | { type: 'copy-selection' }
  | { type: 'paste-from-clipboard' }
  | { type: 'send-input'; data: string };

export interface EnhancedKeyboardProtocolHandlers {
  queueInput: (data: string) => void;
  flushPendingInput: () => void;
  writeBinary: (data: Uint8Array) => void;
  hasSelection: () => boolean;
  getSelection: () => string;
  clearSelection: () => void;
  readClipboardText: () => Promise<string>;
  writeClipboardText: (text: string) => Promise<void>;
  writeText: (text: string) => void;
  onError?: (message: string, error: unknown) => void;
}

export function evaluateKeyboardDecision(
  event: KeyboardEventLike,
  context: KeyboardDecisionContext
): KeyboardDecision {
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

  if (event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey && event.key === 'Enter') {
    return { type: 'send-input', data: '\n' };
  }

  return { type: 'allow-default' };
}

export function decodeBinaryInput(data: string): Uint8Array {
  if (typeof atob === 'function') {
    return Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
  }

  return Uint8Array.from(Buffer.from(data, 'base64'));
}

export class EnhancedKeyboardProtocol {
  private readonly handlers: EnhancedKeyboardProtocolHandlers;

  constructor(handlers: EnhancedKeyboardProtocolHandlers) {
    this.handlers = handlers;
  }

  handleData(data: string): void {
    this.handlers.queueInput(data);
  }

  handleBinary(data: string): void {
    this.handlers.flushPendingInput();
    this.handlers.writeBinary(decodeBinaryInput(data));
  }

  handleKeyboardEvent(event: KeyboardEventLike): boolean {
    const decision = evaluateKeyboardDecision(event, {
      hasSelection: this.handlers.hasSelection(),
    });

    switch (decision.type) {
      case 'allow-default':
        return true;
      case 'copy-selection':
        event.preventDefault?.();
        this.copySelection();
        return false;
      case 'paste-from-clipboard':
        event.preventDefault?.();
        this.pasteClipboard();
        return false;
      case 'send-input':
        event.preventDefault?.();
        this.handlers.queueInput(decision.data);
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
          this.handlers.writeText(text);
        }
      })
      .catch((error) => {
        this.handlers.onError?.('Paste failed', error);
      });
  }
}
