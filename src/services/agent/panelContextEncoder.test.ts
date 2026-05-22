import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { enrichPromptWithContext } from './panelContextEncoder.ts';
import type { AgentContextSnapshot } from '../context/agentContextBridge.ts';

function makeSnapshot(overrides?: Partial<AgentContextSnapshot>): AgentContextSnapshot {
  return {
    schemaVersion: 1,
    source: 'termy',
    updatedAt: '2024-01-01T00:00:00.000Z',
    vaultRoot: '/Users/example/Documents/Notes',
    workspaceFolders: ['/Users/example/Documents/Notes'],
    activeFile: {
      filePath: '/Users/example/Documents/Notes/notes/demo.md',
      vaultPath: 'notes/demo.md',
      fileUrl: 'file:///Users/example/Documents/Notes/notes/demo.md',
      hasFocus: true,
    },
    openFiles: [],
    selection: {
      text: 'selected text here',
      isEmpty: false,
      from: { line: 0, ch: 0, offset: 0 },
      to: { line: 0, ch: 18, offset: 18 },
    },
    ...overrides,
  };
}

describe('enrichPromptWithContext', () => {
  it('1. null snapshot returns rawText unchanged', () => {
    const result = enrichPromptWithContext('hello', null);
    assert.equal(result.enrichedPrompt, 'hello');
    assert.equal(result.displayText, 'hello');
  });

  it('2. includeCurrentNote=false, includeSelection=false returns rawText unchanged', () => {
    const snapshot = makeSnapshot();
    const result = enrichPromptWithContext('hello', snapshot, {
      includeCurrentNote: false,
      includeSelection: false,
    });
    assert.equal(result.enrichedPrompt, 'hello');
    assert.equal(result.displayText, 'hello');
  });

  it('3. includeCurrentNote=true, no activeFile returns rawText unchanged', () => {
    const snapshot = makeSnapshot({ activeFile: null });
    const result = enrichPromptWithContext('hello', snapshot, {
      includeCurrentNote: true,
      includeSelection: false,
    });
    assert.equal(result.enrichedPrompt, 'hello');
    assert.equal(result.displayText, 'hello');
  });

  it('4. includeCurrentNote=true, has activeFile appends [Current note: ...]', () => {
    const snapshot = makeSnapshot();
    const result = enrichPromptWithContext('hello', snapshot, {
      includeCurrentNote: true,
      includeSelection: false,
    });
    assert.equal(result.enrichedPrompt, 'hello\n[Current note: notes/demo.md]');
    assert.equal(result.displayText, 'hello');
  });

  it('5. includeSelection=true, no selection returns rawText unchanged', () => {
    const snapshot = makeSnapshot({ selection: null });
    const result = enrichPromptWithContext('hello', snapshot, {
      includeCurrentNote: false,
      includeSelection: true,
    });
    assert.equal(result.enrichedPrompt, 'hello');
    assert.equal(result.displayText, 'hello');
  });

  it('6. includeSelection=true, empty selection returns rawText unchanged', () => {
    const snapshot = makeSnapshot({
      selection: {
        text: '   ',
        isEmpty: false,
        from: { line: 0, ch: 0, offset: 0 },
        to: { line: 0, ch: 3, offset: 3 },
      },
    });
    const result = enrichPromptWithContext('hello', snapshot, {
      includeCurrentNote: false,
      includeSelection: true,
    });
    assert.equal(result.enrichedPrompt, 'hello');
    assert.equal(result.displayText, 'hello');
  });

  it('7. includeSelection=true, has selection appends [Editor selection from ...]', () => {
    const snapshot = makeSnapshot();
    const result = enrichPromptWithContext('hello', snapshot, {
      includeCurrentNote: false,
      includeSelection: true,
    });
    assert.equal(
      result.enrichedPrompt,
      'hello\n[Editor selection from notes/demo.md:\nselected text here\n]',
    );
    assert.equal(result.displayText, 'hello');
  });

  it('8. Both true, both present appends both blocks', () => {
    const snapshot = makeSnapshot();
    const result = enrichPromptWithContext('hello', snapshot, {
      includeCurrentNote: true,
      includeSelection: true,
    });
    assert.equal(
      result.enrichedPrompt,
      'hello\n[Current note: notes/demo.md]\n[Editor selection from notes/demo.md:\nselected text here\n]',
    );
    assert.equal(result.displayText, 'hello');
  });

  it('displayText always equals rawText verbatim', () => {
    const snapshot = makeSnapshot();
    const rawText = '  spaces and\nnewlines  ';
    const result = enrichPromptWithContext(rawText, snapshot, {
      includeCurrentNote: true,
      includeSelection: true,
    });
    assert.equal(result.displayText, rawText);
  });
});
