import type { AgentSessionId } from '../agentEventTypes.ts';

export class AcpSessionMapper {
  private readonly agentId: string;
  private readonly serverToPanel = new Map<string, AgentSessionId>();
  private latestPanelId: AgentSessionId | null = null;

  constructor(agentId: string) {
    this.agentId = agentId;
  }

  latest(): AgentSessionId | null {
    return this.latestPanelId;
  }

  all(): AgentSessionId[] {
    return [...this.serverToPanel.values()];
  }

  clear(): void {
    this.serverToPanel.clear();
    this.latestPanelId = null;
  }

  panelIdFor(serverSessionId: string): AgentSessionId {
    const existing = this.serverToPanel.get(serverSessionId);
    if (existing) {
      this.latestPanelId = existing;
      return existing;
    }
    const panelSessionId = `${this.agentId}:${serverSessionId}`;
    this.serverToPanel.set(serverSessionId, panelSessionId);
    this.latestPanelId = panelSessionId;
    return panelSessionId;
  }
}
