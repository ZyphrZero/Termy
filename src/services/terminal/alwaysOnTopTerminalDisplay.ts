export type AlwaysOnTopTerminalMenuState = 'none' | 'current' | 'other';

export function getAlwaysOnTopTerminalMenuState(
  hasAlwaysOnTopTerminal: boolean,
  isCurrentTerminal: boolean,
): AlwaysOnTopTerminalMenuState {
  if (!hasAlwaysOnTopTerminal) {
    return 'none';
  }

  return isCurrentTerminal ? 'current' : 'other';
}

export function getAlwaysOnTopTerminalLabelKey(state: AlwaysOnTopTerminalMenuState): string {
  switch (state) {
    case 'current':
      return 'terminal.contextMenu.restorePinnedTerminal';
    case 'other':
      return 'terminal.contextMenu.focusPinnedTerminal';
    case 'none':
    default:
      return 'terminal.contextMenu.pinToTop';
  }
}
