import type { App, Command } from 'obsidian';

export interface ObsidianCommandOption {
  id: string;
  name: string;
  searchableText: string;
}

type CommandManagerLike = {
  listCommands?: () => Command[];
  commands?: Record<string, Command>;
};

type AppWithCommands = App & { commands?: CommandManagerLike };

const DEFAULT_RESULT_LIMIT = 20;

export function listObsidianCommandOptions(app: App): ObsidianCommandOption[] {
  const manager = (app as AppWithCommands).commands;
  if (!manager) return [];
  const commands = resolveCommandList(manager);
  return commands
    .filter((command) => typeof command.id === 'string' && command.id.trim().length > 0)
    .map((command) => {
      const id = command.id.trim();
      const name = (command.name || '').trim() || id;
      const searchableText = normalizeText(`${id} ${name}`);
      return { id, name, searchableText };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function searchObsidianCommandOptions(
  options: readonly ObsidianCommandOption[],
  query: string,
  limit = DEFAULT_RESULT_LIMIT
): ObsidianCommandOption[] {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return options.slice(0, limit);
  const terms = normalizedQuery.split(' ').filter((term) => term.length > 0);
  const compactQuery = normalizedQuery.replace(/\s+/g, '');

  return options
    .map((option) => ({ option, score: scoreCommandOption(option, terms, compactQuery) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.option.name.localeCompare(b.option.name))
    .slice(0, limit)
    .map((item) => item.option);
}

function resolveCommandList(manager: CommandManagerLike): Command[] {
  if (manager.commands && typeof manager.commands === 'object') {
    return Object.values(manager.commands);
  }
  if (typeof manager.listCommands === 'function') {
    try {
      return manager.listCommands();
    } catch {
      return [];
    }
  }
  return [];
}

function scoreCommandOption(
  option: ObsidianCommandOption,
  terms: readonly string[],
  compactQuery: string
): number {
  const normalizedId = normalizeText(option.id);
  const normalizedName = normalizeText(option.name);
  let score = 0;

  for (const term of terms) {
    const indexInOption = option.searchableText.indexOf(term);
    if (indexInOption < 0) return 0;
    score += 80 - Math.min(indexInOption, 50);
    if (normalizedId === term) score += 260;
    if (normalizedId.startsWith(term)) score += 150;
    if (normalizedName.startsWith(term)) score += 110;
  }

  if (isSubsequence(compactQuery, compactText(option.searchableText))) {
    score += 45;
  }

  return score;
}

function compactText(value: string): string {
  return value.replace(/[\s:._-]/g, '');
}

function isSubsequence(query: string, target: string): boolean {
  if (!query) return true;
  let queryIndex = 0;
  for (const char of target) {
    if (char === query[queryIndex]) {
      queryIndex += 1;
      if (queryIndex >= query.length) return true;
    }
  }
  return false;
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}
