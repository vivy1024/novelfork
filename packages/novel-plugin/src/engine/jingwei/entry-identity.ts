export interface EntrySourceRef {
  readonly chapterNumber: number;
  readonly excerpt: string;
  readonly path?: string;
  readonly fileName?: string;
  readonly startLine?: number;
  readonly endLine?: number;
}

const CHAPTER_SUMMARY_CATEGORIES = new Set(["chapter-summary", "chapter-summaries"]);

export function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\s\u3000]+/gu, "")
    .replace(/[（）()【】\[\]《》<>「」『』""''·、，。！？!?,.:;；：\-—…~～]+/gu, "")
    .toLowerCase();
}

function chapterNumberFromFields(fields?: Record<string, unknown>): number | undefined {
  const raw = fields?.chapterNumber ?? fields?.chapter_number;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return Math.trunc(raw);
  if (typeof raw === "string" && /^\d+$/u.test(raw.trim())) return Number(raw.trim());
  return undefined;
}

export function chapterSummaryKey(chapterNumber: number): string {
  return `chapter-summaries:chapter:${chapterNumber}`;
}

export function generateEntryKey(
  category: string,
  title: string,
  fields?: Record<string, unknown>,
): string {
  const normalizedCategory = category.trim().toLowerCase() || "unclassified";
  const chapterNumber = chapterNumberFromFields(fields);
  if (CHAPTER_SUMMARY_CATEGORIES.has(normalizedCategory) && chapterNumber !== undefined) {
    return chapterSummaryKey(chapterNumber);
  }
  const normalizedTitle = normalizeText(title.trim());
  return `${normalizedCategory}:${normalizedTitle.slice(0, 48) || "untitled"}`;
}

export function resolveEntryKey(
  input: { entryKey?: string | null; category: string; title: string; fields?: Record<string, unknown> },
  current?: { entryKey?: string | null },
): string {
  if (input.entryKey?.trim()) return input.entryKey.trim();
  if (current?.entryKey?.trim()) return current.entryKey.trim();
  return generateEntryKey(input.category, input.title, input.fields);
}

export function deduplicateAliases(aliases: readonly string[], title?: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  if (title) seen.add(normalizeText(title));
  for (const alias of aliases) {
    const trimmed = alias.trim();
    if (!trimmed) continue;
    const normalized = normalizeText(trimmed);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(trimmed);
  }
  return out;
}

export function mergeAliases(existing: readonly string[], incoming: readonly string[], title?: string): string[] {
  return deduplicateAliases([...existing, ...incoming], title);
}

export function isValidSourceRef(ref: EntrySourceRef): boolean {
  const excerpt = ref.excerpt.trim();
  if (!excerpt) return false;
  if (ref.chapterNumber > 0) return true;
  return Boolean(ref.path?.trim() || ref.fileName?.trim());
}

function sourceRefKey(ref: EntrySourceRef): string {
  if (ref.chapterNumber > 0) return `chapter:${ref.chapterNumber}:${normalizeText(ref.excerpt)}`;
  const locator = ref.path?.trim() || ref.fileName?.trim() || "";
  const range = `${ref.startLine ?? ""}:${ref.endLine ?? ""}`;
  return `file:${locator}:${range}:${normalizeText(ref.excerpt)}`;
}

export function deduplicateSourceRefs(refs: readonly EntrySourceRef[]): EntrySourceRef[] {
  const seen = new Set<string>();
  const out: EntrySourceRef[] = [];
  for (const ref of refs) {
    if (!isValidSourceRef(ref)) continue;
    const excerpt = ref.excerpt.trim();
    const cleaned: EntrySourceRef = {
      chapterNumber: ref.chapterNumber > 0 ? ref.chapterNumber : 0,
      excerpt,
      ...(ref.path?.trim() ? { path: ref.path.trim() } : {}),
      ...(ref.fileName?.trim() ? { fileName: ref.fileName.trim() } : {}),
      ...(typeof ref.startLine === "number" ? { startLine: ref.startLine } : {}),
      ...(typeof ref.endLine === "number" ? { endLine: ref.endLine } : {}),
    };
    const key = sourceRefKey(cleaned);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

export function mergeSourceRefs(
  existing: readonly EntrySourceRef[],
  incoming: readonly EntrySourceRef[],
): EntrySourceRef[] {
  return deduplicateSourceRefs([...existing, ...incoming]);
}
