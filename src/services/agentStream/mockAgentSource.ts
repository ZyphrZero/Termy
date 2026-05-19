/**
 * Mock agent source used to populate the Agent panel during
 * development and to give the user a "demo what this view does"
 * affordance before any real agent is connected.
 *
 * The script is hand-curated to exercise every event kind the view
 * knows how to render: streaming text, a tool call that progresses
 * from `running` to `completed`, a plan list, a permission request,
 * and a session state transition. If you add a new event kind to
 * {@link AgentEvent}, add a step here too — the demo doubles as a
 * lightweight visual regression suite.
 */

import type { AgentEvent } from './agentEventTypes';
import type { AgentEventPublisher, AgentEventSource } from './agentEventSource';

/**
 * Default delay between scripted events, in milliseconds. Picked so
 * the cadence feels like a real LLM streaming tokens without dragging
 * out a developer's iteration loop.
 */
const DEFAULT_TICK_MS = 80;

/**
 * One step in the mock script. Steps run sequentially. `delayMs` is
 * the wait *before* publishing the event — set it to `0` to fire
 * immediately after the previous step.
 */
interface MockStep {
  delayMs: number;
  event: AgentEvent;
}

const SESSION_ID = 'mock-session';

/**
 * Build the canonical demo script. Pulled into a function so tests
 * can build their own variant without re-declaring the array.
 */
function buildDefaultScript(): MockStep[] {
  const tool = 'mock-tool-1';
  return [
    { delayMs: 0, event: { kind: 'session-state', sessionId: SESSION_ID, state: 'running', detail: 'Mock agent connected' } },
    { delayMs: 200, event: { kind: 'plan', sessionId: SESSION_ID, steps: [
      { id: 'p1', title: 'Read the active note', status: 'in-progress' },
      { id: 'p2', title: 'Summarise key points', status: 'pending' },
      { id: 'p3', title: 'Suggest next actions', status: 'pending' },
    ] } },
    { delayMs: 250, event: { kind: 'text', sessionId: SESSION_ID, channel: 'final', delta: "Sure, let me take a look at " } },
    { delayMs: DEFAULT_TICK_MS, event: { kind: 'text', sessionId: SESSION_ID, channel: 'final', delta: 'the active note. ' } },
    { delayMs: DEFAULT_TICK_MS, event: { kind: 'tool-call', sessionId: SESSION_ID, toolCallId: tool, toolName: 'read_file', toolKind: 'read_file', title: 'Read active note', subtitle: 'notes/Example.md', status: 'running' } },
    { delayMs: 600, event: { kind: 'tool-call-update', sessionId: SESSION_ID, toolCallId: tool, status: 'completed', body: '_Read 42 lines of `notes/Example.md`._' } },
    { delayMs: 200, event: { kind: 'plan', sessionId: SESSION_ID, steps: [
      { id: 'p1', title: 'Read the active note', status: 'completed' },
      { id: 'p2', title: 'Summarise key points', status: 'in-progress' },
      { id: 'p3', title: 'Suggest next actions', status: 'pending' },
    ] } },
    { delayMs: 200, event: { kind: 'text', sessionId: SESSION_ID, channel: 'final', delta: 'Here is what I found:\n\n' } },
    { delayMs: DEFAULT_TICK_MS, event: { kind: 'text', sessionId: SESSION_ID, channel: 'final', delta: '- The note discusses three approaches to terminal rendering.\n' } },
    { delayMs: DEFAULT_TICK_MS, event: { kind: 'text', sessionId: SESSION_ID, channel: 'final', delta: '- It proposes adding an Agent panel separate from the terminal view.\n' } },
    { delayMs: DEFAULT_TICK_MS, event: { kind: 'text', sessionId: SESSION_ID, channel: 'final', delta: '- ACP is mentioned as a future protocol target.\n\n' } },
    { delayMs: 200, event: { kind: 'text', sessionId: SESSION_ID, channel: 'final', delta: 'Here is a sample diff that the same flow would produce in a real agent:\n\n' } },
    { delayMs: 200, event: { kind: 'text', sessionId: SESSION_ID, channel: 'final', delta: '```diff\n--- a/example.ts\n+++ b/example.ts\n@@\n-const greeting = "hello";\n+const greeting = "hello, world";\n```\n' } },
    { delayMs: 250, event: { kind: 'text-done', sessionId: SESSION_ID, channel: 'final' } },
    { delayMs: 200, event: { kind: 'session-state', sessionId: SESSION_ID, state: 'finished', detail: 'Mock turn complete' } },
  ];
}

export interface MockAgentSourceOptions {
  /**
   * Speed multiplier applied to every step's `delayMs`. Tests pass `0`
   * to fire the entire script synchronously.
   */
  speed?: number;
  /** Override the script entirely. Used by tests. */
  script?: MockStep[];
  /**
   * Function used to schedule delayed work. Production uses
   * `globalThis.setTimeout`; tests inject a deterministic scheduler.
   */
  scheduler?: (callback: () => void, ms: number) => unknown;
  /** Counterpart to {@link scheduler}. */
  cancelScheduler?: (handle: unknown) => void;
}

/**
 * Replay the demo script every time the source is started. The view
 * shows what a real agent stream looks like even when no agent is
 * connected — and we get to hot-reload UI changes without spinning up
 * an LLM.
 */
export class MockAgentSource implements AgentEventSource {
  readonly name = 'mock';
  private readonly speed: number;
  private readonly script: MockStep[];
  private readonly scheduler: (callback: () => void, ms: number) => unknown;
  private readonly cancelScheduler: (handle: unknown) => void;
  private running = false;
  private pendingHandle: unknown = null;

  constructor(options: MockAgentSourceOptions = {}) {
    this.speed = options.speed ?? 1;
    this.script = options.script ?? buildDefaultScript();
    const defaultSchedule = (cb: () => void, ms: number): unknown =>
      window.setTimeout(cb, ms);
    const defaultCancel = (handle: unknown): void => {
      if (handle !== null) {
        window.clearTimeout(handle as ReturnType<typeof setTimeout>);
      }
    };
    this.scheduler = options.scheduler ?? defaultSchedule;
    this.cancelScheduler = options.cancelScheduler ?? defaultCancel;
  }

  start(publish: AgentEventPublisher): Promise<void> {
    if (this.running) {
      return Promise.resolve();
    }
    this.running = true;
    this.runScript(publish, 0);
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.running = false;
    if (this.pendingHandle !== null) {
      this.cancelScheduler(this.pendingHandle);
      this.pendingHandle = null;
    }
    return Promise.resolve();
  }

  private runScript(publish: AgentEventPublisher, index: number): void {
    if (!this.running || index >= this.script.length) {
      return;
    }
    const step = this.script[index];
    const delay = Math.max(0, Math.round(step.delayMs * this.speed));
    const fire = (): void => {
      this.pendingHandle = null;
      if (!this.running) {
        return;
      }
      publish(step.event);
      this.runScript(publish, index + 1);
    };

    if (delay === 0) {
      fire();
      return;
    }
    this.pendingHandle = this.scheduler(fire, delay);
  }
}
