export type ProviderTabConfig =
  | {
      readonly id: string;
      readonly label: string;
      readonly icon?: string;
      readonly iconKind: 'brand';
    }
  | {
      readonly id: string;
      readonly label: string;
      readonly icon: string;
      readonly iconKind: 'lucide';
    };

export interface AgentProviderConfig {
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
}

export interface BuildProviderTabsOptions {
  readonly enabledAgents: readonly AgentProviderConfig[];
  readonly terminalProvider?: ProviderTabConfig | null;
}

export function buildProviderTabs(options: BuildProviderTabsOptions): ProviderTabConfig[] {
  const terminalTabs = options.terminalProvider ? [options.terminalProvider] : [];
  const agentTabs = options.enabledAgents.map((agent) => ({
    id: agent.id,
    label: agent.label,
    icon: agent.icon,
    iconKind: 'brand' as const,
  }));
  return terminalTabs.concat(agentTabs);
}
