/**
 * Bridge → bus glue. Subscribes to {@link IdeBridge}'s sanitized
 * lifecycle / tool-call feed and republishes the events through
 * {@link AgentEventBus} as {@link AgentEvent}s.
 *
 * The transformation is delegated to {@link adaptIdeBridgeEvent} so
 * the testable, side-effect-free part of the work can be exercised
 * without spinning up a WebSocket server.
 */

import type { IdeBridge, IdeBridgeEvent } from '../ideBridge/ideBridge';
import type { AgentEventPublisher, AgentEventSource } from './agentEventSource';
import { adaptIdeBridgeEvent } from './ideBridgeEventAdapter';

export const IDE_BRIDGE_AGENT_SOURCE_NAME = 'ide-bridge';

export class IdeBridgeAgentSource implements AgentEventSource {
  readonly name = IDE_BRIDGE_AGENT_SOURCE_NAME;

  private readonly bridge: IdeBridge;
  private detach: (() => void) | null = null;
  private toolInvocationIndex = 0;

  constructor(bridge: IdeBridge) {
    this.bridge = bridge;
  }

  start(publish: AgentEventPublisher): Promise<void> {
    if (this.detach) {
      // Idempotent start. The bus already guards against duplicate
      // sources but defensive-coding here keeps unit tests honest.
      return Promise.resolve();
    }

    this.detach = this.bridge.onEvent((bridgeEvent: IdeBridgeEvent) => {
      const events = adaptIdeBridgeEvent({
        event: bridgeEvent,
        toolInvocationIndex: ++this.toolInvocationIndex,
      });
      if (!events) return;
      for (const event of events) {
        publish(event);
      }
    });

    return Promise.resolve();
  }

  stop(): Promise<void> {
    if (this.detach) {
      this.detach();
      this.detach = null;
    }
    return Promise.resolve();
  }
}
