import { spawn } from 'child_process';
import {
  buildCodexCliDesiredArgs,
  CODEX_MCP_SERVER_NAME,
  codexMcpConfigMatches,
  type CodexMcpGetJson,
} from '../context/agentContext';
import { debugLog, debugWarn } from '@/utils/logger';

type CommandResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
};

export async function ensureCodexCliMcpConfigured(
  binaryPath: string,
  snapshotFilePath: string,
): Promise<void> {
  const desiredArgs = buildCodexCliDesiredArgs(snapshotFilePath);

  const currentConfig = await getCurrentMcpConfig();
  if (currentConfig && codexMcpConfigMatches(currentConfig, binaryPath, desiredArgs)) {
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

export async function removeCodexCliMcpConfigured(): Promise<void> {
  const currentConfig = await getCurrentMcpConfig();
  if (!currentConfig) {
    debugLog('[CodexCliMcpConfigurator] Codex MCP server not configured; nothing to remove');
    return;
  }

  const removeResult = await runCodexCommand(['mcp', 'remove', CODEX_MCP_SERVER_NAME]);

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

async function getCurrentMcpConfig(): Promise<CodexMcpGetJson | null> {
  const result = await runCodexCommand(['mcp', 'get', CODEX_MCP_SERVER_NAME, '--json']);
  if (result.error) {
    if (result.error.message.includes('ENOENT')) {
      debugWarn('[CodexCliMcpConfigurator] Codex CLI not found on PATH; skipping MCP auto-registration');
      return null;
    }
    throw result.error;
  }

  if (result.code !== 0) {
    return null;
  }

  try {
    return JSON.parse(result.stdout) as CodexMcpGetJson;
  } catch (error) {
    debugWarn('[CodexCliMcpConfigurator] Failed to parse codex mcp get JSON:', error);
    return null;
  }
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
