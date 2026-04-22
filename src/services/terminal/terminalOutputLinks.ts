export interface TerminalOutputFileReference {
  text: string;
  path: string;
  line: number | null;
  column: number | null;
  startIndex: number;
  endIndex: number;
}

const FILE_REFERENCE_PATTERNS = [
  /(?<![A-Za-z0-9_./\\-])((?:[A-Za-z]:\\|\\\\|\/|\.\.\/|\.\/)?(?:[A-Za-z0-9_@~.-]+[\\/])*[A-Za-z0-9_@~.-]+\.[A-Za-z0-9]+)\((\d+)\)/g,
  /(?<![A-Za-z0-9_./\\-])((?:[A-Za-z]:\\|\\\\|\/|\.\.\/|\.\/)?(?:[A-Za-z0-9_@~.-]+[\\/])*[A-Za-z0-9_@~.-]+\.[A-Za-z0-9]+)(?::(\d+))(?::(\d+))?/g,
  /(?<![A-Za-z0-9_./\\-])((?:[A-Za-z]:\\|\\\\|\/|\.\.\/|\.\/)?(?:[ab][\\/])?(?:[A-Za-z0-9_@~.-]+[\\/])+[A-Za-z0-9_@~.-]+\.[A-Za-z0-9]+)(?![:\w])/g,
];

function isLikelyFileReference(path: string, line: number | null): boolean {
  const normalized = path.trim();
  if (!normalized) {
    return false;
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(normalized)) {
    return false;
  }

  if (!/\.[A-Za-z0-9]+$/.test(normalized)) {
    return false;
  }

  if (line === null && !/[\\/]/.test(normalized)) {
    return false;
  }

  return true;
}

function dedupeFileReferences(references: TerminalOutputFileReference[]): TerminalOutputFileReference[] {
  const sorted = [...references].sort((left, right) => {
    if (left.startIndex !== right.startIndex) {
      return left.startIndex - right.startIndex;
    }

    const leftScore = (left.line !== null ? 2 : 0) + (left.column !== null ? 1 : 0);
    const rightScore = (right.line !== null ? 2 : 0) + (right.column !== null ? 1 : 0);
    if (leftScore !== rightScore) {
      return rightScore - leftScore;
    }

    return right.endIndex - left.endIndex;
  });

  const deduped: TerminalOutputFileReference[] = [];

  for (const reference of sorted) {
    const overlapsExisting = deduped.some((existing) => {
      const overlaps = reference.startIndex < existing.endIndex && reference.endIndex > existing.startIndex;
      return overlaps && reference.path === existing.path;
    });

    if (!overlapsExisting) {
      deduped.push(reference);
    }
  }

  return deduped.sort((left, right) => left.startIndex - right.startIndex);
}

export function parseTerminalOutputFileReferences(text: string): TerminalOutputFileReference[] {
  const matches: TerminalOutputFileReference[] = [];

  for (const pattern of FILE_REFERENCE_PATTERNS) {
    pattern.lastIndex = 0;

    for (const match of text.matchAll(pattern)) {
      const fullText = match[0];
      const path = match[1];
      const lineFromParens = match[2] ? Number(match[2]) : null;
      const lineFromColons = match[2] && pattern !== FILE_REFERENCE_PATTERNS[1] ? null : (match[2] ? Number(match[2]) : null);
      const line = pattern === FILE_REFERENCE_PATTERNS[1]
        ? (match[2] ? Number(match[2]) : null)
        : lineFromParens;
      const column = pattern === FILE_REFERENCE_PATTERNS[1] && match[3] ? Number(match[3]) : null;
      const startIndex = match.index ?? 0;
      const endIndex = startIndex + fullText.length;

      if (!isLikelyFileReference(path, line)) {
        continue;
      }

      matches.push({
        text: fullText,
        path,
        line: line ?? lineFromColons,
        column,
        startIndex,
        endIndex,
      });
    }
  }

  return dedupeFileReferences(matches);
}
