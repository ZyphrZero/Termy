/** Pure protocol helpers for the dsh-TUI IDE selection channel. */

export const DSH_TUI_IDE_PORT_ENV = 'DSH_TUI_IDE_PORT';
export const DSH_TUI_IDE_TOKEN_ENV = 'DSH_TUI_IDE_TOKEN';
export const DSH_TUI_IDE_PROTOCOL_VERSION = 2;
export const DSH_TUI_IDE_HELLO_METHOD = 'ide/hello';
export const DSH_TUI_IDE_HELLO_ACK_METHOD = 'ide/hello_ack';
export const DSH_TUI_SELECTION_METHOD = 'selection_changed';

export interface DshTuiSelectionSnapshot {
  path: string;
  startLine: number;
  endLine: number;
  isEmpty: boolean;
  text: string;
}

export interface DshTuiLockPayload {
  port: number;
  token: string;
  workspaceFolders: string[];
  pid: number;
}

export function buildDshTuiBridgeTerminalEnv(
  port: number | null,
  token: string | null,
): Record<string, string> {
  if (!port || !token) return {};
  return {
    [DSH_TUI_IDE_PORT_ENV]: String(port),
    [DSH_TUI_IDE_TOKEN_ENV]: token,
  };
}

export function parseDshTuiHello(
  value: unknown,
): { token: string; protocolVersion: number } | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (record.method !== DSH_TUI_IDE_HELLO_METHOD) return undefined;
  if (record.params === null || typeof record.params !== 'object' || Array.isArray(record.params)) {
    return undefined;
  }

  const params = record.params as Record<string, unknown>;
  if (typeof params.token !== 'string' || params.token.length === 0) return undefined;
  if (params.protocolVersion !== DSH_TUI_IDE_PROTOCOL_VERSION) return undefined;
  return {
    token: params.token,
    protocolVersion: DSH_TUI_IDE_PROTOCOL_VERSION,
  };
}

export function buildDshTuiHelloAck(workspaceFolders: readonly string[]): string {
  return JSON.stringify({
    method: DSH_TUI_IDE_HELLO_ACK_METHOD,
    params: {
      protocolVersion: DSH_TUI_IDE_PROTOCOL_VERSION,
      workspaceFolders: [...workspaceFolders],
    },
  });
}

export function buildDshTuiSelectionChanged(snapshot: DshTuiSelectionSnapshot): string {
  return JSON.stringify({
    method: DSH_TUI_SELECTION_METHOD,
    params: snapshot,
  });
}

export function normalizeDshTuiPath(value: string, caseInsensitive = false): string {
  const normalized = value.replace(/\\/g, '/').replace(/\/$/, '') || '/';
  return caseInsensitive ? normalized.toLowerCase() : normalized;
}

export function workspaceContainsPath(
  workspaceRoot: string,
  candidatePath: string,
  caseInsensitive = false,
): boolean {
  const root = normalizeDshTuiPath(workspaceRoot, caseInsensitive);
  const candidate = normalizeDshTuiPath(candidatePath, caseInsensitive);
  if (root === '/') return candidate.startsWith('/');
  return candidate === root || candidate.startsWith(`${root}/`);
}

export function getDshTuiSelectionLineRange(
  startLine: number,
  endLine: number,
  endCharacter: number,
): { startLine: number; endLine: number } {
  return {
    startLine,
    endLine: endCharacter === 0 && endLine > startLine ? endLine - 1 : endLine,
  };
}

export function sameDshTuiSelection(
  left: DshTuiSelectionSnapshot | null,
  right: DshTuiSelectionSnapshot | null,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.path === right.path
    && left.startLine === right.startLine
    && left.endLine === right.endLine
    && left.isEmpty === right.isEmpty
    && left.text === right.text;
}
