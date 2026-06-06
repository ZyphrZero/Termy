export interface SessionListItem {
  readonly id: string;
  readonly title?: string;
  readonly updatedAt?: number;
  readonly time?: {
    readonly updated?: number;
  };
  readonly cwd?: string;
}

export interface LiveAgentSession {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: number;
  readonly cwd: string;
  readonly live: true;
}

export function isLiveAgentSession(session: SessionListItem): session is LiveAgentSession {
  return 'live' in session && session.live === true;
}

export function upsertLiveAgentSession<T extends SessionListItem>(
  sessions: readonly T[],
  live: LiveAgentSession,
): Array<T | LiveAgentSession> {
  return [live, ...sessions.filter((session) => session.id !== live.id)];
}

export function mergeLiveAgentSessions<T extends SessionListItem>(
  current: readonly (T | LiveAgentSession)[],
  history: readonly T[],
): Array<T | LiveAgentSession> {
  const liveSessions = current.filter(isLiveAgentSession);
  const liveIds = new Set(liveSessions.map((session) => session.id));
  return [
    ...liveSessions,
    ...history.filter((session) => !liveIds.has(session.id)),
  ];
}

export function requireSessionCwd(
  sessions: readonly SessionListItem[],
  sessionId: string,
): string {
  const session = sessions.find((item) => item.id === sessionId);
  const cwd = session?.cwd?.trim();
  if (!cwd) {
    throw new Error(`Thread "${sessionId}" is missing cwd`);
  }
  return cwd;
}

export interface ThreadMetaOverlay {
  readonly providerId: string;
  readonly threadId: string;
  readonly title?: string;
  readonly archived?: boolean;
}

export type ProviderIconConfig =
  | {
      readonly kind: 'brand';
      readonly icon: string;
    }
  | {
      readonly kind: 'lucide';
      readonly icon: string;
    };

export interface ProviderThreadSource {
  readonly providerId: string;
  readonly providerLabel: string;
  readonly providerIcon?: ProviderIconConfig;
  readonly sessions: readonly SessionListItem[];
  readonly activeSessionId: string | null;
  readonly live?: boolean;
}

export interface ThreadPoolItem {
  readonly key: string;
  readonly providerId: string;
  readonly providerLabel: string;
  readonly providerIcon?: ProviderIconConfig;
  readonly threadId: string;
  readonly title: string;
  readonly updatedAt: number;
  readonly active: boolean;
  readonly live: boolean;
}

export interface BuildThreadPoolOptions {
  readonly providers: readonly ProviderThreadSource[];
  readonly selectedProviderId: string | null;
  readonly getMeta: (providerId: string, threadId: string) => ThreadMetaOverlay | undefined;
  readonly untitledTitle: string;
}

export function buildThreadPoolItems(options: BuildThreadPoolOptions): ThreadPoolItem[] {
  const items: ThreadPoolItem[] = [];
  for (const provider of options.providers) {
    for (const session of provider.sessions) {
      const meta = options.getMeta(provider.providerId, session.id);
      if (meta?.archived) continue;
      const title = pickThreadTitle(meta?.title, session.title, options.untitledTitle);
      items.push({
        key: `${provider.providerId}\u0000${session.id}`,
        providerId: provider.providerId,
        providerLabel: provider.providerLabel,
        providerIcon: provider.providerIcon,
        threadId: session.id,
        title,
        updatedAt: getSessionUpdatedAt(session),
        active: provider.providerId === options.selectedProviderId && session.id === provider.activeSessionId,
        live: provider.live === true || isLiveAgentSession(session),
      });
    }
  }
  return items.sort((left, right) => right.updatedAt - left.updatedAt);
}

function pickThreadTitle(metaTitle: string | undefined, sessionTitle: string | undefined, emptyTitle: string): string {
  const renamed = metaTitle?.trim();
  if (renamed && renamed.length > 0) return renamed;
  const title = sessionTitle?.trim();
  if (title && title.length > 0) return title;
  return emptyTitle;
}

function getSessionUpdatedAt(session: SessionListItem): number {
  if (typeof session.updatedAt === 'number') return session.updatedAt;
  if (typeof session.time?.updated === 'number') return session.time.updated;
  throw new Error(`Thread "${session.id}" is missing updatedAt`);
}
