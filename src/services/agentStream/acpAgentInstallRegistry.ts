import type { AgentConfig } from './agentConfig';

export type AcpInstallCommandKind = 'npm-package' | 'upstream-cli';

export interface AcpAgentInstallEntry {
  readonly agentId: string;
  readonly registryId: string;
  readonly label: string;
  readonly command: string;
  readonly args?: readonly string[];
  readonly npmPackage?: string;
  readonly installDocsUrl?: string;
  readonly installCommandKind: AcpInstallCommandKind;
  readonly installCommands: Partial<Record<NodeJS.Platform, string>>;
}

export const ACP_AGENT_INSTALL_REGISTRY: readonly AcpAgentInstallEntry[] = [
  {
    agentId: 'claude-code',
    registryId: 'claude-acp',
    label: 'Claude Code ACP',
    command: 'claude-code-acp',
    npmPackage: '@zed-industries/claude-code-acp',
    installDocsUrl: 'https://github.com/zed-industries/claude-code-acp#readme',
    installCommandKind: 'npm-package',
    installCommands: {
      darwin: 'npm install -g @zed-industries/claude-code-acp',
      linux: 'npm install -g @zed-industries/claude-code-acp',
      win32: 'npm install -g @zed-industries/claude-code-acp',
    },
  },
  {
    agentId: 'codex',
    registryId: 'codex-acp',
    label: 'Codex ACP',
    command: 'codex-acp',
    npmPackage: '@zed-industries/codex-acp',
    installDocsUrl: 'https://github.com/zed-industries/codex-acp',
    installCommandKind: 'npm-package',
    installCommands: {
      darwin: 'npm install -g @zed-industries/codex-acp',
      linux: 'npm install -g @zed-industries/codex-acp',
      win32: 'npm install -g @zed-industries/codex-acp',
    },
  },
  {
    agentId: 'opencode',
    registryId: 'opencode',
    label: 'OpenCode ACP',
    command: 'opencode',
    args: ['acp'],
    npmPackage: 'opencode-ai',
    installDocsUrl: 'https://opencode.ai/docs',
    installCommandKind: 'upstream-cli',
    installCommands: {
      darwin: 'curl -fsSL https://opencode.ai/install | bash',
      linux: 'curl -fsSL https://opencode.ai/install | bash',
      win32: 'npm install -g opencode-ai',
    },
  },
] as const;

const ACP_AGENT_INSTALL_INDEX = new Map<string, AcpAgentInstallEntry>(
  ACP_AGENT_INSTALL_REGISTRY.map((entry) => [entry.agentId, entry]),
);

export function getAcpAgentInstallEntry(
  agentId: string,
): AcpAgentInstallEntry | undefined {
  return ACP_AGENT_INSTALL_INDEX.get(agentId);
}

export function getAcpInstallCommandForPlatform(
  entry: AcpAgentInstallEntry,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const command = entry.installCommands[platform];
  return command && command.length > 0 ? command : null;
}

export function isAcpAgentUsingRegistryCommand(
  agent: AgentConfig,
  entry: AcpAgentInstallEntry,
): boolean {
  return (
    agent.command === entry.command
    && JSON.stringify(agent.args ?? []) === JSON.stringify(entry.args ?? [])
  );
}
