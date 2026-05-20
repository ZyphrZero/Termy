/**
 * Stable identifiers for the AI agent providers Termy embeds in the
 * Agent panel.
 *
 * The panel UI uses these to render its provider tabs and to scope
 * `AgentEventBus` source names (e.g. `'opencode-http:<sessionId>'`)
 * so two providers can stream into the panel without colliding.
 *
 * Keep this enum dependency-free — the file is consumed by both the
 * main process glue and by view code that runs in the renderer.
 */
export type AgentProviderId = 'claude-code' | 'opencode';

/**
 * Stable provider tab order for the panel header. Claude Code leads
 * because it is Termy's primary AI launcher and is what most users
 * reach for first.
 */
export const AGENT_PROVIDER_ORDER: ReadonlyArray<AgentProviderId> = [
  'claude-code',
  'opencode',
] as const;

/** Provider tab the panel selects on first open. */
export const DEFAULT_AGENT_PROVIDER: AgentProviderId = 'claude-code';

export interface AgentProviderInfo {
  readonly id: AgentProviderId;
  /** Short label rendered in the provider tab. */
  readonly label: string;
  /**
   * Lobehub icon key used to render the brand mark on the provider
   * tab. See `lobeIconAssets` for the canonical catalog.
   */
  readonly lobeIconKey: string;
  /** Whether the provider is implemented yet. Disabled tabs render greyed-out. */
  readonly enabled: boolean;
}

export const AGENT_PROVIDERS: Record<AgentProviderId, AgentProviderInfo> = {
  'claude-code': {
    id: 'claude-code',
    label: 'Claude Code',
    lobeIconKey: 'claudecode',
    enabled: true,
  },
  opencode: {
    id: 'opencode',
    label: 'OpenCode',
    lobeIconKey: 'opencode',
    enabled: true,
  },
};
