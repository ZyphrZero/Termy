import type { TerminalHandle } from '../../api';
import type { TerminalInstance } from './terminalInstance';
import { snapshotTerminalCreationOptions } from './terminalCreationOptions.ts';

type HandleTerminal = Pick<TerminalInstance, 'id' | 'getTitle' | 'setTitle' | 'write' | 'isAlive' | 'focus'>;

/** Keep the public handle independent of workspace leaves, which can change during window moves. */
export function createTerminalApiHandle(
  terminal: HandleTerminal,
  controls: { isClosed: () => boolean; focus: () => Promise<void>; close: () => Promise<void> },
): TerminalHandle {
  const requireTerminal = () => {
    if (controls.isClosed()) throw new Error('Termy terminal is closed');
    return terminal;
  };
  let closing: Promise<void> | undefined;
  return Object.freeze({
    id: terminal.id,
    get isClosed() { return controls.isClosed(); },
    getTitle: () => requireTerminal().getTitle(),
    setTitle: (title: string) => {
      snapshotTerminalCreationOptions({ title });
      requireTerminal().setTitle(title);
    },
    write: (data: string) => {
      const instance = requireTerminal();
      if (typeof data !== 'string') throw new TypeError('Terminal input must be a string');
      if (!instance.isAlive()) throw new Error('Termy terminal is disconnected or has exited');
      instance.write(data);
    },
    focus: async () => {
      requireTerminal();
      await controls.focus();
      requireTerminal().focus();
    },
    close: () => {
      if (closing) return closing;
      if (controls.isClosed()) return Promise.resolve();
      closing = controls.close();
      return closing;
    },
  });
}
