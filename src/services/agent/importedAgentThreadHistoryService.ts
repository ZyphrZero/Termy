import type { AgentEvent } from '../agentStream/agentEventTypes.ts';

type FsModule = typeof import('fs');
type PathModule = typeof import('path');

export interface ImportedAgentThread {
  readonly id: string;
  readonly title?: string;
  readonly cwd: string;
  readonly updatedAt: number;
  readonly importedAt: number;
  readonly events: readonly AgentEvent[];
}

export interface ImportedAgentThreadListItem {
  readonly id: string;
  readonly title?: string;
  readonly cwd: string;
  readonly updatedAt: number;
  readonly importedAt: number;
}

interface StoreFile {
  readonly version: number;
  readonly providers: Record<string, readonly ImportedAgentThread[]>;
}

const STORE_FILE_NAME = 'agent-thread-history.json';

export class ImportedAgentThreadHistoryService {
  private readonly filePath: string;
  private readonly fs: FsModule;

  constructor(pluginDir: string) {
    const path = window.require('path') as PathModule;
    this.fs = window.require('fs') as FsModule;
    this.filePath = path.join(pluginDir, STORE_FILE_NAME);
  }

  listThreads(providerId: string): ImportedAgentThreadListItem[] {
    const store = this.readStore();
    const threads = store.providers[providerId] ?? [];
    return threads
      .map(({ events: _events, ...thread }) => thread)
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }

  loadThread(providerId: string, threadId: string): AgentEvent[] {
    const thread = this.readThread(providerId, threadId);
    const sessionId = `${providerId}:${threadId}`;
    return thread.events.map((event) => ({ ...event, sessionId }));
  }

  saveThread(providerId: string, thread: ImportedAgentThread): void {
    const store = this.readStore();
    const current = store.providers[providerId] ?? [];
    const nextProviderThreads = [
      thread,
      ...current.filter((item) => item.id !== thread.id),
    ].sort((left, right) => right.updatedAt - left.updatedAt);
    this.writeStore({
      version: 1,
      providers: {
        ...store.providers,
        [providerId]: nextProviderThreads,
      },
    });
  }

  stop(): void {
    // File-backed service has no process or watcher to tear down.
  }

  private readThread(providerId: string, threadId: string): ImportedAgentThread {
    const thread = this.readStore().providers[providerId]?.find((item) => item.id === threadId);
    if (!thread) {
      throw new Error(`Imported thread not found: ${providerId}/${threadId}`);
    }
    return thread;
  }

  private readStore(): StoreFile {
    if (!this.fs.existsSync(this.filePath)) {
      return { version: 1, providers: {} };
    }
    const parsed = JSON.parse(this.fs.readFileSync(this.filePath, 'utf8')) as StoreFile;
    if (parsed.version !== 1) {
      throw new Error(`Unsupported imported thread history version: ${parsed.version}`);
    }
    return parsed;
  }

  private writeStore(store: StoreFile): void {
    this.fs.mkdirSync(this.requireParentDir(), { recursive: true });
    this.fs.writeFileSync(this.filePath, JSON.stringify(store, null, 2), 'utf8');
  }

  private requireParentDir(): string {
    const path = window.require('path') as PathModule;
    return path.dirname(this.filePath);
  }
}
