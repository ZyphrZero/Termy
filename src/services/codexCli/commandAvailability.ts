type CodexCommandProbeResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  error?: Pick<Error, 'message'>;
};

export function isCodexCliUnavailableResult(result: CodexCommandProbeResult): boolean {
  const errorMessage = normalizeCodexCommandText(result.error?.message ?? '');
  if (errorMessage.includes('enoent')) {
    return true;
  }

  const texts = [result.stderr, result.stdout]
    .map((value) => normalizeCodexCommandText(value))
    .filter((value) => value.length > 0);

  return texts.some((text) =>
    /^['"]codex(?:\.cmd)?['"]\s/.test(text)
    || /\bcodex(?:\.cmd)?: (command )?not found\b/.test(text)
    || /\bcodex(?:\.cmd)?\b.*not recognized as an internal or external command\b/.test(text),
  );
}

function normalizeCodexCommandText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}
