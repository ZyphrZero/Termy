import type { AgentContextSnapshot } from '../context/agentContextBridge.ts';

export interface EnrichOptions {
  includeCurrentNote?: boolean;
  includeSelection?: boolean;
}

export interface EnrichResult {
  enrichedPrompt: string;
  displayText: string;
}

/**
 * Enriches a raw user prompt with editor context (active note path,
 * selection) in bracket-style format. The display text is always the
 * user's raw input verbatim; the enriched prompt may append context
 * blocks that the provider understands.
 */
export function enrichPromptWithContext(
  rawText: string,
  snapshot: AgentContextSnapshot | null,
  options?: EnrichOptions,
): EnrichResult {
  const displayText = rawText;

  if (!snapshot) {
    return { enrichedPrompt: rawText, displayText };
  }

  const includeCurrentNote = options?.includeCurrentNote ?? false;
  const includeSelection = options?.includeSelection ?? false;

  const blocks: string[] = [];

  if (includeCurrentNote && snapshot.activeFile) {
    blocks.push(`[Current note: ${snapshot.activeFile.vaultPath}]`);
  }

  if (includeSelection && snapshot.selection && snapshot.selection.text.trim().length > 0) {
    const vaultPath = snapshot.activeFile?.vaultPath ?? 'unknown';
    blocks.push(`[Editor selection from ${vaultPath}:\n${snapshot.selection.text}\n]`);
  }

  if (blocks.length === 0) {
    return { enrichedPrompt: rawText, displayText };
  }

  const enrichedPrompt = rawText + '\n' + blocks.join('\n');
  return { enrichedPrompt, displayText };
}
