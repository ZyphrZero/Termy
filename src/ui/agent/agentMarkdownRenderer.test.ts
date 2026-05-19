import assert from 'node:assert/strict';
import test from 'node:test';

import type { Component } from 'obsidian';

import {
  renderAgentSnapshot,
  type AgentSnapshotRenderer,
} from './agentMarkdownRenderer.ts';
import type { AgentSessionSnapshot } from '../../services/agentStream/agentSessionModel.ts';

/**
 * Bare DOM stand-in for `HTMLElement`, sufficient for the renderer.
 *
 * The renderer uses Obsidian's element extensions (`createDiv`,
 * `createSpan`, `createEl`, `setText`, `empty`, `setAttribute`,
 * `addClass`, `createEl('pre').createEl('code', { text })`, etc.) on
 * top of plain DOM nodes. Replicating just those lets us run the
 * renderer in `node:test` with no jsdom dependency.
 */
class StubElement {
  tag: string;
  className = '';
  textContent = '';
  attributes = new Map<string, string>();
  children: StubElement[] = [];
  parent: StubElement | null = null;
  dataset: Record<string, string> = {};

  constructor(tag: string) {
    this.tag = tag;
  }

  createDiv(opts: { cls?: string; text?: string; attr?: Record<string, string> } = {}): StubElement {
    return this.createEl('div', opts);
  }

  createSpan(opts: { cls?: string; text?: string; attr?: Record<string, string> } = {}): StubElement {
    return this.createEl('span', opts);
  }

  createEl(tag: string, opts: { cls?: string; text?: string; attr?: Record<string, string> } = {}): StubElement {
    const child = new StubElement(tag);
    if (opts.cls) child.className = opts.cls;
    if (opts.text) child.textContent = opts.text;
    if (opts.attr) {
      for (const [k, v] of Object.entries(opts.attr)) {
        child.attributes.set(k, v);
      }
    }
    child.parent = this;
    this.children.push(child);
    return child;
  }

  setText(text: string): void {
    this.textContent = text;
    this.children = [];
  }

  empty(): void {
    this.children = [];
    this.textContent = '';
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  setAttr(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  addClass(cls: string): void {
    this.className = this.className ? `${this.className} ${cls}` : cls;
  }

  /**
   * Recursive search by predicate. Used by tests to locate rendered
   * elements without relying on real DOM `querySelector`.
   */
  findAll(predicate: (el: StubElement) => boolean): StubElement[] {
    const out: StubElement[] = [];
    if (predicate(this)) out.push(this);
    for (const child of this.children) {
      out.push(...child.findAll(predicate));
    }
    return out;
  }

  serializeText(): string {
    if (this.textContent) return this.textContent;
    return this.children.map((c) => c.serializeText()).join(' ').trim();
  }
}

function makeRenderer(): { renderer: AgentSnapshotRenderer; calls: Array<{ markdown: string; classes: string }> } {
  const calls: Array<{ markdown: string; classes: string }> = [];
  return {
    calls,
    renderer: {
      sourcePath: '',
      renderMarkdown: (markdown, target) => {
        const stubTarget = target as unknown as StubElement;
        calls.push({ markdown, classes: stubTarget.className });
        stubTarget.createDiv({ cls: 'rendered-markdown', text: markdown });
        return Promise.resolve();
      },
    },
  };
}

const stubOwner = {} as Component;

test('renderAgentSnapshot draws plan, text and tool blocks in order', async () => {
  const root = new StubElement('div');
  const { renderer, calls } = makeRenderer();

  const snapshot: AgentSessionSnapshot = {
    sessionId: 's1',
    state: 'running',
    plan: [
      { id: 'p1', title: 'Read', status: 'completed' },
      { id: 'p2', title: 'Summarise', status: 'in-progress' },
    ],
    pendingPermissions: [],
    blocks: [
      { kind: 'text', channel: 'final', body: 'Hello, world.', streaming: false },
      {
        kind: 'tool',
        toolCallId: 't1',
        toolName: 'read_file',
        toolKind: 'read_file',
        title: 'Read',
        subtitle: 'notes/Example.md',
        status: 'completed',
        body: 'Read 12 lines',
      },
    ],
  };

  await renderAgentSnapshot(snapshot, root as unknown as HTMLElement, stubOwner, renderer);

  assert.equal(root.attributes.get('data-session-id'), 's1');
  assert.ok(root.findAll((el) => el.className.includes('termy-agent-plan')).length > 0);
  const toolCard = root.findAll((el) => el.className.includes('termy-agent-tool-card'))[0];
  assert.ok(toolCard);
  assert.equal(toolCard.attributes.get('data-tool-call-id'), 't1');
  assert.equal(calls.length, 2, 'one render call per markdown block');
  assert.equal(calls[0].markdown, 'Hello, world.');
  assert.equal(calls[1].markdown, 'Read 12 lines');
});

test('renderAgentSnapshot decorates streaming text blocks with a cursor', async () => {
  const root = new StubElement('div');
  const { renderer } = makeRenderer();

  const snapshot: AgentSessionSnapshot = {
    sessionId: 's1',
    state: 'running',
    plan: [],
    pendingPermissions: [],
    blocks: [
      { kind: 'text', channel: 'final', body: 'partial', streaming: true },
    ],
  };

  await renderAgentSnapshot(snapshot, root as unknown as HTMLElement, stubOwner, renderer);

  const cursor = root.findAll((el) => el.className.includes('termy-agent-cursor'));
  assert.equal(cursor.length, 1);
  const wrapper = root.findAll((el) => el.className.includes('termy-agent-text-block'))[0];
  assert.match(wrapper.className, /is-streaming/);
});

test('renderAgentSnapshot wraps diff payloads in a fenced diff block', async () => {
  const root = new StubElement('div');
  const { renderer, calls } = makeRenderer();

  const snapshot: AgentSessionSnapshot = {
    sessionId: 's1',
    state: 'running',
    plan: [],
    pendingPermissions: [],
    blocks: [
      {
        kind: 'tool',
        toolCallId: 't1',
        toolName: 'edit_file',
        toolKind: 'edit_file',
        title: 'Edit example.ts',
        status: 'completed',
        diff: {
          path: 'example.ts',
          unified: '--- a/example.ts\n+++ b/example.ts\n@@\n-old\n+new',
        },
      },
    ],
  };

  await renderAgentSnapshot(snapshot, root as unknown as HTMLElement, stubOwner, renderer);

  const diffCall = calls.find((c) => c.markdown.includes('```diff'));
  assert.ok(diffCall, 'diff is wrapped in a fenced diff block');
  assert.match(diffCall.markdown, /```diff/);
  assert.match(diffCall.markdown, /-old/);
  assert.match(diffCall.markdown, /\+new/);
});

test('renderAgentSnapshot renders error blocks with title and details', async () => {
  const root = new StubElement('div');
  const { renderer } = makeRenderer();

  const snapshot: AgentSessionSnapshot = {
    sessionId: 's1',
    state: 'errored',
    plan: [],
    pendingPermissions: [],
    blocks: [
      { kind: 'error', message: 'boom', details: 'stack trace' },
    ],
  };

  await renderAgentSnapshot(snapshot, root as unknown as HTMLElement, stubOwner, renderer);

  const card = root.findAll((el) => el.className === 'termy-agent-error-card')[0];
  assert.ok(card);
  const message = root.findAll((el) => el.className === 'termy-agent-error-message')[0];
  assert.equal(message.textContent, 'boom');
});
