/**
 * Fan-out hub for agent events.
 *
 * Multiple {@link AgentEventSource}s push into the same bus; the
 * {@link AgentOutputView} (and any future consumers like a status-bar
 * indicator) subscribe to receive a unified, ordered stream.
 *
 * Design choices worth flagging:
 *
 * - **Ordering is per-bus, not per-source.** Two sources interleaving
 *   events get a deterministic order based on publish time. If a
 *   future feature needs strict per-session ordering, it should layer
 *   that on top of the envelope's `sessionId`.
 *
 * - **Subscribers receive a small replay buffer on subscribe.** This
 *   matches the Obsidian use case where a user opens the Agent panel
 *   *after* the agent has already streamed a few tokens — without
 *   replay the panel would mysteriously start mid-message.
 *
 * - **No promise-based dispatch.** Subscribers are called synchronously.
 *   If a subscriber needs to do async work it should schedule that
 *   itself; the bus does not await anything to avoid head-of-line
 *   blocking when the renderer is slow.
 */

import type { AgentEvent, AgentEventEnvelope } from './agentEventTypes';
import type { AgentEventPublisher, AgentEventSource } from './agentEventSource';

/** Default replay buffer size. Roughly fits a single conversation turn. */
const DEFAULT_REPLAY_BUFFER_SIZE = 256;

/**
 * Subscriber callback. Throwing from a subscriber is treated as a bug —
 * the bus catches and logs the error so other subscribers still see
 * the event, but does not retry.
 */
export type AgentEventSubscriber = (envelope: AgentEventEnvelope) => void;

export interface AgentEventBusOptions {
  /** Override the replay buffer size. Set to 0 to disable replay. */
  replayBufferSize?: number;
  /** Logger used for subscriber errors. Defaults to `console.error`. */
  onSubscriberError?: (error: unknown) => void;
}

export class AgentEventBus {
  private readonly sources = new Map<string, AgentEventSource>();
  private readonly subscribers = new Set<AgentEventSubscriber>();
  private readonly replayBuffer: AgentEventEnvelope[] = [];
  private readonly replayBufferSize: number;
  private readonly onSubscriberError: (error: unknown) => void;
  private nextEventId = 1;
  private clock: () => number = () => Date.now();

  constructor(options: AgentEventBusOptions = {}) {
    this.replayBufferSize = options.replayBufferSize ?? DEFAULT_REPLAY_BUFFER_SIZE;
    this.onSubscriberError = options.onSubscriberError ?? ((error) => {
      // eslint-disable-next-line no-console -- bus is logger-of-last-resort, see class doc.
      console.error('[AgentEventBus] subscriber threw:', error);
    });
  }

  /**
   * Register a source and start it. The bus injects a publisher that
   * stamps envelopes with monotonically increasing ids and dispatches
   * to all current subscribers.
   *
   * If a source with the same name is already registered, its previous
   * registration is stopped first. This lets callers replace a mock
   * source with a real one without juggling lifecycles manually.
   */
  async addSource(source: AgentEventSource): Promise<void> {
    const previous = this.sources.get(source.name);
    if (previous) {
      await previous.stop();
    }
    this.sources.set(source.name, source);

    const publisher: AgentEventPublisher = (event: AgentEvent) => {
      this.publish(source.name, event);
    };

    await source.start(publisher);
  }

  /**
   * Stop and unregister a source by name. No-op if the name is unknown.
   */
  async removeSource(name: string): Promise<void> {
    const source = this.sources.get(name);
    if (!source) {
      return;
    }
    this.sources.delete(name);
    await source.stop();
  }

  /**
   * Subscribe to all subsequent events. The returned function
   * unsubscribes. Subscribers receive a synchronous replay of the
   * buffered events first, in their original order.
   */
  subscribe(subscriber: AgentEventSubscriber): () => void {
    this.subscribers.add(subscriber);
    for (const envelope of this.replayBuffer) {
      this.dispatchTo(subscriber, envelope);
    }
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  /**
   * Number of subscribers currently attached. Exposed for tests and
   * for the view's "connected sources" status indicator.
   */
  get subscriberCount(): number {
    return this.subscribers.size;
  }

  /**
   * Number of registered sources. Exposed for tests.
   */
  get sourceCount(): number {
    return this.sources.size;
  }

  /**
   * Stop every registered source. Used during plugin unload.
   *
   * Sources are stopped in parallel because stopping is idempotent and
   * a slow source (e.g. waiting for a child process to exit) should
   * not block the others.
   */
  async stopAll(): Promise<void> {
    const sources = [...this.sources.values()];
    this.sources.clear();
    await Promise.allSettled(sources.map((source) => source.stop()));
  }

  /**
   * Override the wall-clock function. Tests use this to make
   * timestamps deterministic; production code should leave it alone.
   */
  setClockForTesting(clock: () => number): void {
    this.clock = clock;
  }

  /**
   * Snapshot of the replay buffer. Exposed for tests. Mutating the
   * returned array does not affect bus state.
   */
  getReplayBufferForTesting(): AgentEventEnvelope[] {
    return [...this.replayBuffer];
  }

  private publish(sourceName: string, event: AgentEvent): void {
    const envelope: AgentEventEnvelope = {
      id: String(this.nextEventId++),
      timestamp: this.clock(),
      source: sourceName,
      event,
    };

    if (this.replayBufferSize > 0) {
      this.replayBuffer.push(envelope);
      while (this.replayBuffer.length > this.replayBufferSize) {
        this.replayBuffer.shift();
      }
    }

    // Snapshot the subscriber set so a subscriber that unsubscribes
    // mid-iteration cannot perturb the iteration order.
    for (const subscriber of [...this.subscribers]) {
      this.dispatchTo(subscriber, envelope);
    }
  }

  private dispatchTo(subscriber: AgentEventSubscriber, envelope: AgentEventEnvelope): void {
    try {
      subscriber(envelope);
    } catch (error) {
      this.onSubscriberError(error);
    }
  }
}
