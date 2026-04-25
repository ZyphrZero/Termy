export interface TerminalFileUriLink {
  uri: string;
  startIndex: number;
  endIndex: number;
}

// Match literal file:// URLs shown in terminal output. OSC 8 hyperlinks are
// handled by xterm's built-in linkHandler path.
export const TERMINAL_FILE_URI_REGEX = /file:[/]{2}[^\s"'!*(){}|\\^<>`]*[^\s"':,.!?{}|\\^~[\]`()<>]/i;

export function parseTerminalFileUriLinks(text: string): TerminalFileUriLink[] {
  const regex = new RegExp(
    TERMINAL_FILE_URI_REGEX.source,
    TERMINAL_FILE_URI_REGEX.flags.includes('g')
      ? TERMINAL_FILE_URI_REGEX.flags
      : `${TERMINAL_FILE_URI_REGEX.flags}g`,
  );
  const links: TerminalFileUriLink[] = [];

  for (const match of text.matchAll(regex)) {
    const uri = match[0];
    const startIndex = match.index ?? 0;
    links.push({
      uri,
      startIndex,
      endIndex: startIndex + uri.length,
    });
  }

  return links;
}
