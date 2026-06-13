import type { AgentConfig } from '../services/agentStream/agentConfig.ts';

export function getCustomAgentSettingsRows(
  agents: readonly AgentConfig[],
): readonly AgentConfig[] {
  return agents.filter((agent) => !agent.isBuiltIn);
}
