export const CLAUDE_CODE_SSE_PORT_ENV = 'CLAUDE_CODE_SSE_PORT';
export const OPENCODE_EDITOR_SSE_PORT_ENV = 'OPENCODE_EDITOR_SSE_PORT';
export const TERMY_CONTEXT_PATH_ENV = 'TERMY_CONTEXT_PATH';
export const TERMY_CONTEXT_INSTRUCTIONS_PATH_ENV = 'TERMY_CONTEXT_INSTRUCTIONS_PATH';

export function buildIdeBridgeTerminalEnv(port: number | null): Record<string, string> {
  if (!port) {
    return {};
  }

  return {
    [CLAUDE_CODE_SSE_PORT_ENV]: String(port),
    [OPENCODE_EDITOR_SSE_PORT_ENV]: String(port),
  };
}

export function buildAgentContextTerminalEnv(
  contextFilePath: string,
  contextInstructionsFilePath: string,
): Record<string, string> {
  return {
    [TERMY_CONTEXT_PATH_ENV]: contextFilePath,
    [TERMY_CONTEXT_INSTRUCTIONS_PATH_ENV]: contextInstructionsFilePath,
  };
}
