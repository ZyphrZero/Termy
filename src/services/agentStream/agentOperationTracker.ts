export class AgentOperationTracker {
  private readonly counts = new Map<string, number>();

  acquire(agentId: string): AgentOperationLease {
    this.counts.set(agentId, this.count(agentId) + 1);
    let released = false;
    return {
      release: () => {
        if (released) {
          throw new Error(`Agent operation for "${agentId}" was released twice`);
        }
        released = true;
        this.release(agentId);
      },
    };
  }

  isIdle(agentId: string): boolean {
    return this.count(agentId) === 0;
  }

  private release(agentId: string): void {
    const next = this.count(agentId) - 1;
    if (next < 0) {
      throw new Error(`Agent operation count for "${agentId}" became negative`);
    }
    if (next === 0) {
      this.counts.delete(agentId);
      return;
    }
    this.counts.set(agentId, next);
  }

  private count(agentId: string): number {
    return this.counts.get(agentId) ?? 0;
  }
}

export interface AgentOperationLease {
  release(): void;
}
