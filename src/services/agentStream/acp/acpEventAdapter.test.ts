import assert from 'node:assert/strict';
import test from 'node:test';

import { adaptAcpUpdate, adaptStopReason } from './acpEventAdapter.ts';

test('adaptAcpUpdate maps agent_message_chunk to a final-channel text event', () => {
  const events = adaptAcpUpdate({
    sessionId: 's1',
    update: {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'Hello' },
    },
  });
  assert.equal(events.length, 1);
  const evt = events[0];
  assert.equal(evt.kind, 'text');
  if (evt.kind === 'text') {
    assert.equal(evt.channel, 'final');
    assert.equal(evt.delta, 'Hello');
  }
});

test('adaptAcpUpdate maps agent_thought_chunk to a thought-channel text event', () => {
  const events = adaptAcpUpdate({
    sessionId: 's1',
    update: {
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text: 'thinking' },
    },
  });
  assert.equal(events.length, 1);
  if (events[0].kind === 'text') {
    assert.equal(events[0].channel, 'thought');
  } else {
    assert.fail('expected text event');
  }
});

test('adaptAcpUpdate ignores user_message_chunk (Termy renders user input itself)', () => {
  const events = adaptAcpUpdate({
    sessionId: 's1',
    update: {
      sessionUpdate: 'user_message_chunk',
      content: { type: 'text', text: 'echo' },
    },
  });
  assert.deepEqual(events, []);
});

test('adaptAcpUpdate maps tool_call announcement to a tool-call event', () => {
  const events = adaptAcpUpdate({
    sessionId: 's1',
    update: {
      sessionUpdate: 'tool_call',
      toolCallId: 't1',
      title: 'Read README.md',
      kind: 'read',
      status: 'pending',
    },
  });
  assert.equal(events.length, 1);
  const e = events[0];
  if (e.kind === 'tool-call') {
    assert.equal(e.toolCallId, 't1');
    assert.equal(e.toolKind, 'read_file');
    assert.equal(e.title, 'Read README.md');
    assert.equal(e.status, 'pending');
  } else {
    assert.fail('expected tool-call event');
  }
});

test('adaptAcpUpdate emits a follow-up tool-call-update when announcement carries content', () => {
  const events = adaptAcpUpdate({
    sessionId: 's1',
    update: {
      sessionUpdate: 'tool_call',
      toolCallId: 't1',
      title: 'Run tests',
      kind: 'execute',
      status: 'in_progress',
      content: [
        { type: 'content', content: { type: 'text', text: 'starting' } },
      ],
    },
  });
  assert.equal(events.length, 2);
  const update = events[1];
  if (update.kind === 'tool-call-update') {
    assert.equal(update.toolCallId, 't1');
    assert.equal(update.body, 'starting');
    assert.equal(update.status, 'running');
  } else {
    assert.fail('expected tool-call-update event');
  }
});

test('adaptAcpUpdate maps tool_call_update with diff to a unified diff payload', () => {
  const events = adaptAcpUpdate({
    sessionId: 's1',
    update: {
      sessionUpdate: 'tool_call_update',
      toolCallId: 't1',
      status: 'completed',
      content: [
        {
          type: 'diff',
          path: 'src/foo.ts',
          oldText: 'old',
          newText: 'new',
        },
      ],
    },
  });
  assert.equal(events.length, 1);
  const e = events[0];
  if (e.kind === 'tool-call-update') {
    assert.equal(e.status, 'completed');
    assert.ok(e.diff);
    assert.equal(e.diff?.path, 'src/foo.ts');
    assert.match(e.diff?.unified ?? '', /^-old$/m);
    assert.match(e.diff?.unified ?? '', /^\+new$/m);
  } else {
    assert.fail('expected tool-call-update event');
  }
});

test('adaptAcpUpdate accepts diff content with empty newText', () => {
  const events = adaptAcpUpdate({
    sessionId: 's1',
    update: {
      sessionUpdate: 'tool_call_update',
      toolCallId: 't1',
      status: 'completed',
      content: [
        {
          type: 'diff',
          path: 'src/deleted.ts',
          oldText: 'old',
          newText: '',
        },
      ],
    },
  });
  assert.equal(events.length, 1);
  const e = events[0];
  if (e.kind === 'tool-call-update') {
    assert.equal(e.status, 'completed');
    assert.ok(e.diff);
    assert.equal(e.diff?.path, 'src/deleted.ts');
    assert.match(e.diff?.unified ?? '', /^-old$/m);
  } else {
    assert.fail('expected tool-call-update event');
  }
});

test('adaptAcpUpdate maps plan entries to plan steps', () => {
  const events = adaptAcpUpdate({
    sessionId: 's1',
    update: {
      sessionUpdate: 'plan',
      entries: [
        { content: 'Step 1', priority: 'high', status: 'completed' },
        { content: 'Step 2', priority: 'medium', status: 'in_progress' },
        { content: 'Step 3', priority: 'low', status: 'pending' },
      ],
    },
  });
  assert.equal(events.length, 1);
  const e = events[0];
  if (e.kind === 'plan') {
    assert.equal(e.steps.length, 3);
    assert.equal(e.steps[0].status, 'completed');
    assert.equal(e.steps[1].status, 'in-progress');
    assert.equal(e.steps[2].status, 'pending');
  } else {
    assert.fail('expected plan event');
  }
});

test('adaptAcpUpdate rejects unknown session update kinds', () => {
  assert.throws(
    () => adaptAcpUpdate({
      sessionId: 's1',
      update: { sessionUpdate: 'future_unknown_kind', payload: 'whatever' } as never,
    }),
    /Unsupported ACP session\/update kind: future_unknown_kind/,
  );
});

test('adaptStopReason maps end_turn to awaiting-input', () => {
  const e = adaptStopReason('s1', 'end_turn');
  if (e.kind === 'session-state') {
    assert.equal(e.state, 'awaiting-input');
    assert.equal(e.detail, 'Turn complete');
  } else {
    assert.fail('expected session-state event');
  }
});

test('adaptStopReason maps refusal to errored', () => {
  const e = adaptStopReason('s1', 'refusal');
  if (e.kind === 'session-state') {
    assert.equal(e.state, 'errored');
  } else {
    assert.fail('expected session-state event');
  }
});

test('adaptStopReason rejects unknown stop reasons', () => {
  assert.throws(
    () => adaptStopReason('s1', 'future_reason' as never),
    /Unsupported ACP stop reason: future_reason/,
  );
});

test('adaptAcpUpdate handles resource_link content blocks', () => {
  const events = adaptAcpUpdate({
    sessionId: 's1',
    update: {
      sessionUpdate: 'agent_message_chunk',
      content: {
        type: 'resource_link',
        uri: 'file:///tmp/a.ts',
        name: 'a.ts',
      },
    },
  });
  assert.equal(events.length, 1);
  if (events[0].kind === 'text') {
    assert.match(events[0].delta, /\[a\.ts\]/);
  } else {
    assert.fail('expected text event');
  }
});

test('adaptAcpUpdate emits no event when chunk content is empty', () => {
  const events = adaptAcpUpdate({
    sessionId: 's1',
    update: {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: '' },
    },
  });
  assert.deepEqual(events, []);
});

test('adaptAcpUpdate rejects unsupported content block types', () => {
  assert.throws(
    () => adaptAcpUpdate({
      sessionId: 's1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'future_content', value: 'x' } as never,
      },
    }),
    /Unsupported ACP content block type: future_content/,
  );
});

test('adaptAcpUpdate rejects unsupported tool statuses', () => {
  assert.throws(
    () => adaptAcpUpdate({
      sessionId: 's1',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 't1',
        title: 'Run',
        status: 'future_status' as never,
      },
    }),
    /Unsupported ACP tool status: future_status/,
  );
});

test('adaptAcpUpdate rejects tool_call_update without status or content', () => {
  assert.throws(
    () => adaptAcpUpdate({
      sessionId: 's1',
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 't1',
      },
    }),
    /ACP tool_call_update must include status or content/,
  );
});
