/**
 * Import format detection and normalization.
 *
 * Turns an uploaded/pasted artifact (plain text, Markdown, HTML, EPUB) into
 * plain text that `splitChapters` can consume. Deliberately dependency free:
 * ZIP inflate uses node:zlib when available and DecompressionStream in browsers.
 */

export type ImportFormat = "txt" | "markdown" | "html" | "epub" | "unknown";

export interface FormatDetectionResult {
  readonly format: ImportFormat;
  /** Human readable reason, useful for the import wizard UI. */
  readonly evidence: string;
}

export interface EpubExtractResult {
  readonly plainText: string;
  readonly metadata: { readonly title?: string; readonly author?: string };
  readonly spineItemCount: number;
}

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

function bytesOf(input: ArrayBuffer | Uint8Array): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function startsWithZipSignature(bytes: Uint8Array): boolean {
  return ZIP_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

/**
 * Detect the import format from the artifact head (512 bytes is enough).
 * Accepts either binary bytes or an already decoded string.
 */
export function detectFormat(input: ArrayBuffer | Uint8Array | string): FormatDetectionResult {
  if (typeof input !== "string") {
    const bytes = bytesOf(input);
    if (startsWithZipSignature(bytes)) {
      return { format: "epub", evidence: "ZIP 签名 (PK\\x03\\x04)，按 EPUB 解析" };
    }
    return detectFormat(decodeUtf8(bytes.slice(0, 4096)));
  }

  const head = input.slice(0, 4096);
  const trimmed = head.trimStart();
  if (!trimmed) return { format: "unknown", evidence: "内容为空" };

  const lowered = trimmed.toLowerCase();
  if (
    lowered.startsWith("<!doctype html")
    || lowered.startsWith("<html")
    || lowered.startsWith("<?xml")
    || /<(?:body|div|p|h[1-6])[\s>]/u.test(lowered)
  ) {
    return { format: "html", evidence: "检测到 HTML/XML 标签" };
  }

  if (/^#{1,6}\s/mu.test(head) || /^\s*[-*]\s+\S/mu.test(head) || /```/u.test(head)) {
    return { format: "markdown", evidence: "检测到 Markdown 标记" };
  }

  return { format: "txt", evidence: "按纯文本处理" };
}

const BLOCK_TAGS = "p|div|br|li|tr|h1|h2|h3|h4|h5|h6|section|article|blockquote";

/**
 * Convert HTML into plain text while keeping paragraph boundaries.
 * Uses DOMParser when present (browser/Electron) and falls back to regex stripping.
 */
export function htmlToPlainText(html: string): string {
  const withoutNoise = html
    .replace(/<!--[\s\S]*?-->/gu, "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/giu, "");

  const domParser = (globalThis as { DOMParser?: new () => { parseFromString: (text: string, type: string) => { body?: { textContent?: string | null } | null } } }).DOMParser;
  if (domParser) {
    try {
      const normalized = withoutNoise.replace(new RegExp(`</(?:${BLOCK_TAGS})>`, "giu"), (match) => `\n${match}`);
      const parsed = new domParser().parseFromString(normalized, "text/html");
      const text = parsed.body?.textContent ?? "";
      if (text.trim()) return normalizeWhitespace(text);
    } catch {
      // fall through to regex strip
    }
  }

  const withBreaks = withoutNoise
    .replace(new RegExp(`<(?:${BLOCK_TAGS})[^>]*>`, "giu"), "\n")
    .replace(new RegExp(`</(?:${BLOCK_TAGS})>`, "giu"), "\n")
    .replace(/<[^>]+>/gu, "");
  return normalizeWhitespace(decodeHtmlEntities(withBreaks));
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&#(\d+);/gu, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/giu, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n?/gu, "\n")
    .replace(/[ \t\u00a0]+/gu, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

// ── Minimal ZIP reader (EPUB is a ZIP container) ─────────────────────────────

interface ZipEntry {
  readonly name: string;
  readonly compressionMethod: number;
  readonly compressedSize: number;
  readonly localHeaderOffset: number;
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0)
      | ((bytes[offset + 1] ?? 0) << 8)
      | ((bytes[offset + 2] ?? 0) << 16)
      | ((bytes[offset + 3] ?? 0) << 24)) >>> 0
  );
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const minOffset = Math.max(0, bytes.length - 66_000);
  for (let offset = bytes.length - 22; offset >= minOffset; offset -= 1) {
    if (
      bytes[offset] === 0x50
      && bytes[offset + 1] === 0x4b
      && bytes[offset + 2] === 0x05
      && bytes[offset + 3] === 0x06
    ) {
      return offset;
    }
  }
  return -1;
}

function listZipEntries(bytes: Uint8Array): ZipEntry[] {
  const eocd = findEndOfCentralDirectory(bytes);
  if (eocd < 0) throw new Error("不是有效的 ZIP/EPUB：未找到中央目录。");
  const entryCount = readUint16(bytes, eocd + 10);
  let pointer = readUint32(bytes, eocd + 16);
  const entries: ZipEntry[] = [];
  for (let index = 0; index < entryCount; index += 1) {
    if (readUint32(bytes, pointer) !== 0x02014b50) break;
    const compressionMethod = readUint16(bytes, pointer + 10);
    const compressedSize = readUint32(bytes, pointer + 20);
    const nameLength = readUint16(bytes, pointer + 28);
    const extraLength = readUint16(bytes, pointer + 30);
    const commentLength = readUint16(bytes, pointer + 32);
    const localHeaderOffset = readUint32(bytes, pointer + 42);
    const name = decodeUtf8(bytes.subarray(pointer + 46, pointer + 46 + nameLength));
    entries.push({ name, compressionMethod, compressedSize, localHeaderOffset });
    pointer += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const decompressionStream = (globalThis as { DecompressionStream?: new (format: string) => TransformStream<Uint8Array, Uint8Array> }).DecompressionStream;
  if (decompressionStream) {
    const stream = new Blob([data as unknown as BlobPart]).stream().pipeThrough(new decompressionStream("deflate-raw"));
    const buffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(buffer);
  }
  const zlib = await import("node:zlib");
  return new Uint8Array(zlib.inflateRawSync(data));
}

async function readZipEntry(bytes: Uint8Array, entry: ZipEntry): Promise<string> {
  const header = entry.localHeaderOffset;
  if (readUint32(bytes, header) !== 0x04034b50) throw new Error(`ZIP 条目头无效：${entry.name}`);
  const nameLength = readUint16(bytes, header + 26);
  const extraLength = readUint16(bytes, header + 28);
  const dataStart = header + 30 + nameLength + extraLength;
  const size = entry.compressedSize || readUint32(bytes, header + 18);
  const raw = bytes.subarray(dataStart, dataStart + size);
  if (entry.compressionMethod === 0) return decodeUtf8(raw);
  if (entry.compressionMethod === 8) return decodeUtf8(await inflateRaw(raw));
  throw new Error(`不支持的 ZIP 压缩方式：${entry.compressionMethod}`);
}

function resolveRelative(basePath: string, target: string): string {
  if (!basePath.includes("/")) return target.replace(/^\.\//u, "");
  const baseDir = basePath.slice(0, basePath.lastIndexOf("/"));
  const joined = `${baseDir}/${target.replace(/^\.\//u, "")}`;
  const parts: string[] = [];
  for (const segment of joined.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return parts.join("/");
}

function matchTagText(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<(?:\\w+:)?${tag}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, "iu"));
  return match?.[1]?.replace(/<[^>]+>/gu, "").trim() || undefined;
}

/**
 * Extract reading-order plain text from an EPUB archive.
 * Falls back to alphabetical XHTML order when the OPF spine is unreadable.
 */
export async function extractEpubText(input: ArrayBuffer | Uint8Array): Promise<EpubExtractResult> {
  const bytes = bytesOf(input);
  if (!startsWithZipSignature(bytes)) throw new Error("不是 EPUB：缺少 ZIP 签名。");
  const entries = listZipEntries(bytes);
  const byName = new Map(entries.map((entry) => [entry.name, entry] as const));

  let opfPath: string | undefined;
  const container = byName.get("META-INF/container.xml");
  if (container) {
    const containerXml = await readZipEntry(bytes, container).catch(() => "");
    opfPath = containerXml.match(/full-path="([^"]+)"/iu)?.[1];
  }
  if (!opfPath) {
    opfPath = entries.find((entry) => entry.name.toLowerCase().endsWith(".opf"))?.name;
  }

  const orderedPaths: string[] = [];
  let metadata: { title?: string; author?: string } = {};

  if (opfPath && byName.has(opfPath)) {
    const opfXml = await readZipEntry(bytes, byName.get(opfPath)!).catch(() => "");
    metadata = {
      ...(matchTagText(opfXml, "title") ? { title: matchTagText(opfXml, "title") } : {}),
      ...(matchTagText(opfXml, "creator") ? { author: matchTagText(opfXml, "creator") } : {}),
    };
    const manifest = new Map<string, string>();
    for (const item of opfXml.matchAll(/<item\b[^>]*>/giu)) {
      const tag = item[0];
      const id = tag.match(/\bid="([^"]+)"/iu)?.[1];
      const href = tag.match(/\bhref="([^"]+)"/iu)?.[1];
      if (id && href) manifest.set(id, href);
    }
    for (const ref of opfXml.matchAll(/<itemref\b[^>]*>/giu)) {
      const idref = ref[0].match(/\bidref="([^"]+)"/iu)?.[1];
      const href = idref ? manifest.get(idref) : undefined;
      if (href) orderedPaths.push(resolveRelative(opfPath, decodeHtmlEntities(href)));
    }
  }

  const fallbackPaths = entries
    .map((entry) => entry.name)
    .filter((name) => /\.(?:x?html|htm)$/iu.test(name))
    .sort((left, right) => left.localeCompare(right, "en"));
  const readingOrder = orderedPaths.filter((path) => byName.has(path));
  const paths = readingOrder.length > 0 ? readingOrder : fallbackPaths;

  const sections: string[] = [];
  for (const path of paths) {
    const entry = byName.get(path);
    if (!entry) continue;
    const html = await readZipEntry(bytes, entry).catch(() => "");
    if (!html.trim()) continue;
    const text = htmlToPlainText(html);
    if (text.trim()) sections.push(text.trim());
  }

  return {
    plainText: sections.join("\n\n"),
    metadata,
    spineItemCount: paths.length,
  };
}

export interface NormalizeImportSourceInput {
  /** Binary artifact (file upload) — preferred when available. */
  readonly bytes?: ArrayBuffer | Uint8Array;
  /** Already decoded text (paste box). */
  readonly text?: string;
  /** Optional file name, used only as a detection hint. */
  readonly fileName?: string;
}

export interface NormalizeImportSourceResult {
  readonly format: ImportFormat;
  readonly evidence: string;
  readonly plainText: string;
  readonly metadata: { readonly title?: string; readonly author?: string };
  readonly warnings: readonly string[];
}

/**
 * One-call normalization used by the import wizard: detect the format and return
 * plain text ready for `splitChapters`.
 */
export async function normalizeImportSource(
  input: NormalizeImportSourceInput,
): Promise<NormalizeImportSourceResult> {
  const warnings: string[] = [];
  const hint = (input.fileName ?? "").toLowerCase();

  if (input.bytes) {
    const detection = detectFormat(input.bytes);
    if (detection.format === "epub" || hint.endsWith(".epub")) {
      try {
        const epub = await extractEpubText(input.bytes);
        if (!epub.plainText.trim()) warnings.push("EPUB 解析成功但未提取到正文，请确认文件内容。");
        return {
          format: "epub",
          evidence: detection.evidence,
          plainText: epub.plainText,
          metadata: epub.metadata,
          warnings,
        };
      } catch (error) {
        warnings.push(`EPUB 解析失败，改按文本处理：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const decoded = decodeUtf8(bytesOf(input.bytes));
    return normalizeImportSource({ text: decoded, fileName: input.fileName });
  }

  const text = input.text ?? "";
  if (!text.trim()) {
    return { format: "unknown", evidence: "内容为空", plainText: "", metadata: {}, warnings: ["没有可导入的内容。"] };
  }

  const detection = detectFormat(text);
  const format = hint.endsWith(".html") || hint.endsWith(".htm") ? "html" : detection.format;
  if (format === "html") {
    const plainText = htmlToPlainText(text);
    if (!plainText.trim()) warnings.push("HTML 去标签后没有正文。");
    return { format: "html", evidence: detection.evidence, plainText, metadata: {}, warnings };
  }

  return {
    format: format === "unknown" ? "txt" : format,
    evidence: detection.evidence,
    plainText: normalizeWhitespace(text),
    metadata: {},
    warnings,
  };
}
