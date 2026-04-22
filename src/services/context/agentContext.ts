export const CLAUDE_CODE_SSE_PORT_ENV = 'CLAUDE_CODE_SSE_PORT';
export const CODEX_IDE_CONTEXT_PATH_ENV = 'CODEX_IDE_CONTEXT_PATH';
export const CODEX_IDE_CONTEXT_PROMPT_PATH_ENV = 'CODEX_IDE_CONTEXT_PROMPT_PATH';
export const CODEX_MCP_SERVER_NAME = 'termy-context';

export type CodexMcpGetJson = {
  enabled?: boolean;
  transport?: {
    type?: string;
    command?: string;
    args?: string[];
  };
};

export function buildClaudeCodeTerminalEnv(port: number | null): Record<string, string> {
  if (!port) {
    return {};
  }

  return {
    [CLAUDE_CODE_SSE_PORT_ENV]: String(port),
  };
}

export function buildCodexCliTerminalEnv(
  contextFilePath: string,
  contextPromptFilePath: string,
): Record<string, string> {
  return {
    [CODEX_IDE_CONTEXT_PATH_ENV]: contextFilePath,
    [CODEX_IDE_CONTEXT_PROMPT_PATH_ENV]: contextPromptFilePath,
  };
}

export function buildCodexCliDesiredArgs(snapshotFilePath: string): string[] {
  return ['--mcp', '--snapshot-file', snapshotFilePath];
}

export function codexMcpConfigMatches(
  config: CodexMcpGetJson,
  binaryPath: string,
  desiredArgs: string[],
): boolean {
  return (
    config.enabled === true &&
    config.transport?.type === 'stdio' &&
    config.transport.command === binaryPath &&
    arrayEquals(config.transport.args ?? [], desiredArgs)
  );
}

function arrayEquals(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}
