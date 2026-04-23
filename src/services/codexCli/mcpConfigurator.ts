import { spawn } from 'child_process';
import {
  buildCodexCliDesiredArgs,
  CODEX_MCP_SERVER_NAME,
  codexMcpConfigMatches,
  type CodexMcpGetJson,
} from '../context/agentContext';
import { debugLog, debugWarn } from '../../utils/logger';
import { isCodexCliUnavailableResult } from './commandAvailability';

type CommandResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
};

type EnsureCodexCliMcpOptions = {
  allowMissingCli?: boolean;
};

type CurrentMcpConfigResult =
  | {
      availability: 'available';
      config: CodexMcpGetJson | null;
    }
  | {
      availability: 'unavailable';
      config: null;
    };

const CODEX_CLI_UNAVAILABLE_MESSAGE = 'Codex CLI is not installed or not available on PATH';

class CodexCliUnavailableError extends Error {
  constructor() {
    super(CODEX_CLI_UNAVAILABLE_MESSAGE);
    this.name = 'CodexCliUnavailableError';
  }
}

export async function ensureCodexCliMcpConfigured(
  binaryPath: string,
  snapshotFilePath: string,
  options: EnsureCodexCliMcpOptions = {},
): Promise<void> {
  const desiredArgs = buildCodexCliDesiredArgs(snapshotFilePath);

  const currentConfigResult = await getCurrentMcpConfig(options);
  if (currentConfigResult.availability === 'unavailable') {
    return;
  }

  if (currentConfigResult.config && codexMcpConfigMatches(currentConfigResult.config, binaryPath, desiredArgs)) {
    debugLog('[CodexCliMcpConfigurator] Codex MCP server already configured');
    return;
  }

  const addResult = await runCodexCommand([
    'mcp',
    'add',
    CODEX_MCP_SERVER_NAME,
    '--',
    binaryPath,
    ...desiredArgs,
  ]);

  if (handleCodexCliUnavailable(addResult, options)) {
    return;
  }

  if (addResult.error) {
    throw addResult.error;
  }

  if (addResult.code !== 0) {
    throw new Error(
      `[CodexCliMcpConfigurator] codex mcp add failed (${addResult.code}): ${addResult.stderr || addResult.stdout}`,
    );
  }

  debugLog('[CodexCliMcpConfigurator] Codex MCP server configured successfully');
}

export async function removeCodexCliMcpConfigured(
  options: EnsureCodexCliMcpOptions = {},
): Promise<void> {
  const currentConfigResult = await getCurrentMcpConfig(options);
  if (currentConfigResult.availability === 'unavailable') {
    return;
  }

  if (!currentConfigResult.config) {
    debugLog('[CodexCliMcpConfigurator] Codex MCP server not configured; nothing to remove');
    return;
  }

  const removeResult = await runCodexCommand(['mcp', 'remove', CODEX_MCP_SERVER_NAME]);

  if (handleCodexCliUnavailable(removeResult, options)) {
    return;
  }

  if (removeResult.error) {
    throw removeResult.error;
  }

  if (removeResult.code !== 0) {
    throw new Error(
      `[CodexCliMcpConfigurator] codex mcp remove failed (${removeResult.code}): ${removeResult.stderr || removeResult.stdout}`,
    );
  }

  debugLog('[CodexCliMcpConfigurator] Codex MCP server removed successfully');
}

async function getCurrentMcpConfig(
  options: EnsureCodexCliMcpOptions,
): Promise<CurrentMcpConfigResult> {
  const result = await runCodexCommand(['mcp', 'get', CODEX_MCP_SERVER_NAME, '--json']);

  if (handleCodexCliUnavailable(result, options)) {
    return {
      availability: 'unavailable',
      config: null,
    };
  }

  if (result.error) {
    throw result.error;
  }

  if (result.code !== 0) {
    return {
      availability: 'available',
      config: null,
    };
  }

  try {
    return {
      availability: 'available',
      config: JSON.parse(result.stdout) as CodexMcpGetJson,
    };
  } catch (error) {
    debugWarn('[CodexCliMcpConfigurator] Failed to parse codex mcp get JSON:', error);
    return {
      availability: 'available',
      config: null,
    };
  }
}

function handleCodexCliUnavailable(
  result: CommandResult,
  options: EnsureCodexCliMcpOptions,
): boolean {
  if (!isCodexCliUnavailableResult(result)) {
    return false;
  }

  if (options.allowMissingCli) {
    debugWarn('[CodexCliMcpConfigurator] Codex CLI not found on PATH; skipping MCP auto-registration');
    return true;
  }

  throw new CodexCliUnavailableError();
}

async function runCodexCommand(args: string[]): Promise<CommandResult> {
  return new Promise<CommandResult>((resolve) => {
    const child = spawn('codex', args, {
      windowsHide: true,
      shell: process.platform === 'win32',
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      resolve({
        code: null,
        stdout,
        stderr,
        error,
      });
    });

    child.on('close', (code) => {
      resolve({
        code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
  });
}
