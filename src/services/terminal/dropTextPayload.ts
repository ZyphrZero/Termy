export function normalizeDroppedTextPayloadPart(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.replace(/\r\n?/g, '\n').trimEnd();
  if (normalized.trim().length === 0) {
    return null;
  }

  return normalized;
}

export function joinUniqueDroppedTextPayloadParts(values: Iterable<string | null | undefined>): string {
  const uniqueParts: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const normalized = normalizeDroppedTextPayloadPart(value);
    if (!normalized) {
      continue;
    }

    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    uniqueParts.push(normalized);
  }

  return uniqueParts.join('\n');
}

export interface DropTextDataTransferLike {
  types: Iterable<string>;
  getData(type: string): string;
}

export interface DropStringItemLike {
  kind: string;
  getAsString?: ((callback: (value: string) => void) => void) | undefined;
}

const PRIMARY_DROP_TEXT_TYPES = ['text/uri-list', 'text/plain'] as const;
const FALLBACK_IGNORED_DROP_TEXT_TYPES = new Set<string>([
  'Files',
  'text/uri-list',
  'text/plain',
  'text/html',
]);

export function collectPreferredDroppedTextPayload(dataTransfer: DropTextDataTransferLike): string {
  return joinUniqueDroppedTextPayloadParts(
    PRIMARY_DROP_TEXT_TYPES.map((type) => dataTransfer.getData(type))
  );
}

export async function collectFallbackDroppedTextPayload(
  dataTransfer: DropTextDataTransferLike,
  items: Iterable<DropStringItemLike>
): Promise<string> {
  const payloadParts: Array<string | null | undefined> = [dataTransfer.getData('text/html')];

  for (const type of Array.from(dataTransfer.types)) {
    if (FALLBACK_IGNORED_DROP_TEXT_TYPES.has(type)) {
      continue;
    }
    payloadParts.push(dataTransfer.getData(type));
  }

  const stringPayloads = await extractStringItemPayloads(items);
  payloadParts.push(...stringPayloads);

  return joinUniqueDroppedTextPayloadParts(payloadParts);
}

async function extractStringItemPayloads(items: Iterable<DropStringItemLike>): Promise<string[]> {
  const payloads: string[] = [];
  const stringItems = Array.from(items).filter((item) => item.kind === 'string' && typeof item.getAsString === 'function');

  await Promise.all(stringItems.map((item) => new Promise<void>((resolve) => {
    try {
      item.getAsString?.((value) => {
        if (value && value.trim().length > 0) {
          payloads.push(value);
        }
        resolve();
      });
    } catch {
      resolve();
    }
  })));

  return payloads;
}
