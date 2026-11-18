import { inflateRawSync } from "node:zlib";
import { readZip, ZipFormatError } from "../book-archive/zip.js";

export type DissectSourceEncoding = "utf-8" | "utf-16le" | "gb18030" | "docx" | "epub";

export interface ExtractedSourceFile {
  readonly name: string;
  readonly text: string;
  readonly encoding: DissectSourceEncoding;
  readonly chaptersFromSpine?: readonly { readonly title: string; readonly text: string }[];
}

export interface UploadedSourceInput {
  readonly name: string;
  readonly bytes: Uint8Array;
}

const MAX_UPLOAD_ENTRIES = 10_000;
const MAX_UPLOAD_TOTAL_BYTES = 256 * 1024 * 1024;

export class SourceExtractError extends Error {
  constructor(message: string, readonly status: 400 | 413 | 422 = 400) {
    super(message);
    this.name = "SourceExtractError";
  }
}

export function decodeTextBytes(bytes: Uint8Array): { readonly text: string; readonly encoding: "utf-8" | "utf-16le" | "gb18030" } {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return {
      text: normalizeLineEndings(new TextDecoder("utf-8").decode(bytes.subarray(3))),
      encoding: "utf-8",
    };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return {
      text: normalizeLineEndings(new TextDecoder("utf-16le").decode(bytes.subarray(2))),
      encoding: "utf-16le",
    };
  }
  try {
    return {
      text: normalizeLineEndings(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
      encoding: "utf-8",
    };
  } catch {
    return {
      text: normalizeLineEndings(new TextDecoder("gb18030").decode(bytes)),
      encoding: "gb18030",
    };
  }
}

function normalizeLineEndings(text: string): string {
  return text.replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n");
}

function decodeXmlEntities(input: string): string {
  return input
    .replace(/&nbsp;|&#160;|&#xA0;/giu, " ")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&apos;|&#39;/giu, "'")
    .replace(/&amp;/giu, "&")
    .replace(/&#(\d+);/gu, (_, code) => {
      const cp = Number.parseInt(code, 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
    })
    .replace(/&#x([0-9a-f]+);/giu, (_, hex) => {
      const cp = Number.parseInt(hex, 16);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
    });
}

function readZipPermissive(bytes: Uint8Array): Map<string, Uint8Array> {
  try {
    return readZip(bytes, {
      maxEntries: MAX_UPLOAD_ENTRIES,
      maxEntryBytes: 64 * 1024 * 1024,
      maxTotalBytes: MAX_UPLOAD_TOTAL_BYTES,
    });
  } catch (error) {
    // 某些第三方工具打出的 docx/epub 中央目录可能带额外标志或非严格编码；降级用宽松中央目录解析但仍防越界与解压炸弹。
    if (error instanceof ZipFormatError && (error.code === "corrupt" || error.code === "not-zip")) {
      return readStandardOfficeZip(bytes);
    }
    if (error instanceof ZipFormatError) {
      throw new SourceExtractError(`压缩文档读取失败：${error.message}`, 400);
    }
    throw error;
  }
}

/** 面向外部 DOCX/EPUB 的最小兼容 Zip 读取器（防越界、防解压炸弹，容忍非 UTF-8 文件名或 data descriptor）。 */
function readStandardOfficeZip(bytes: Uint8Array): Map<string, Uint8Array> {
  if (bytes.length < 22) throw new SourceExtractError("文件不是有效的 DOCX/EPUB（zip）文档。", 400);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  const minOffset = Math.max(0, bytes.length - 65_557);
  for (let i = bytes.length - 22; i >= minOffset; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new SourceExtractError("文件不是有效的 DOCX/EPUB（找不到 zip 目录）。", 400);
  const entryCount = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (entryCount > MAX_UPLOAD_ENTRIES || centralOffset + centralSize > eocd) {
    throw new SourceExtractError("文档目录损坏或条目过多。", 400);
  }
  const files = new Map<string, Uint8Array>();
  let cursor = centralOffset;
  let total = 0;
  const utf8 = new TextDecoder("utf-8");
  for (let idx = 0; idx < entryCount; idx += 1) {
    if (cursor + 46 > eocd || view.getUint32(cursor, true) !== 0x02014b50) {
      throw new SourceExtractError("文档目录条目损坏。", 400);
    }
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLen = view.getUint16(cursor + 28, true);
    const extraLen = view.getUint16(cursor + 30, true);
    const commentLen = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    if (cursor + 46 + nameLen > eocd) throw new SourceExtractError("文档目录越界。", 400);
    const name = utf8.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLen)).replace(/\\/g, "/");
    cursor += 46 + nameLen + extraLen + commentLen;
    if (!name || name.endsWith("/") || name.includes("..")) continue;
    if (localOffset + 30 > centralOffset || view.getUint32(localOffset, true) !== 0x04034b50) {
      throw new SourceExtractError(`文档条目「${name}」本地头损坏。`, 400);
    }
    const lNameLen = view.getUint16(localOffset + 26, true);
    const lExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > centralOffset) throw new SourceExtractError(`文档条目「${name}」数据越界。`, 400);
    if (uncompressedSize > 64 * 1024 * 1024 || total + uncompressedSize > MAX_UPLOAD_TOTAL_BYTES) {
      throw new SourceExtractError("文档解压后体积超过上限，请拆卷后导入。", 413);
    }
    total += uncompressedSize;
    const payload = bytes.subarray(dataStart, dataEnd);
    let data: Uint8Array;
    if (method === 0) {
      data = new Uint8Array(payload);
    } else if (method === 8) {
      data = new Uint8Array(inflateRawSync(payload, { maxOutputLength: Math.max(uncompressedSize, 64 * 1024 * 1024) }));
    } else {
      continue;
    }
    files.set(name, data);
  }
  return files;
}

export function extractTextFromDocxBytes(bytes: Uint8Array): string {
  const entries = readZipPermissive(bytes);
  const docEntry = entries.get("word/document.xml");
  if (!docEntry) {
    throw new SourceExtractError("DOCX 文件中缺少 word/document.xml 正文内容。", 400);
  }
  const xml = new TextDecoder("utf-8").decode(docEntry);
  const paragraphs: string[] = [];
  const pMatches = xml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/gu);
  for (const match of pMatches) {
    const body = match[1] ?? "";
    const withBreaks = body
      .replace(/<w:tab\b[^>]*\/>/gu, "\t")
      .replace(/<w:(?:br|cr)\b[^>]*\/>/gu, "\n");
    const texts: string[] = [];
    for (const tMatch of withBreaks.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>|\n|\t/gu)) {
      if (tMatch[0] === "\n" || tMatch[0] === "\t") texts.push(tMatch[0]);
      else texts.push(decodeXmlEntities(tMatch[1] ?? ""));
    }
    const line = texts.join("").trimEnd();
    paragraphs.push(line);
  }
  const joined = paragraphs.join("\n").replace(/\n{3,}/gu, "\n\n").trim();
  if (!joined) {
    throw new SourceExtractError("未能从 DOCX 文档中提取出有效正文文本。", 400);
  }
  return joined;
}

function htmlToPlainText(html: string): { readonly title: string; readonly text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/iu) ?? html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/iu);
  const rawTitle = titleMatch ? decodeXmlEntities(titleMatch[1]!.replace(/<[^>]+>/gu, "")).trim() : "";
  const stripped = html
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/giu, "")
    .replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/giu, "")
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<\/(?:p|div|h[1-6]|li|blockquote|section|article|tr)>/giu, "\n\n")
    .replace(/<[^>]+>/gu, "");
  const text = decodeXmlEntities(stripped)
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  return { title: rawTitle, text };
}

function resolveZipRelativePath(baseDir: string, rel: string): string {
  const combined = baseDir ? `${baseDir}/${rel}` : rel;
  const stack: string[] = [];
  for (const part of combined.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}

function parseXmlAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of tag.matchAll(/([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu)) {
    attrs[match[1]!] = decodeXmlEntities(match[2] ?? match[3] ?? "");
  }
  return attrs;
}

export function extractTextFromEpubBytes(bytes: Uint8Array): {
  readonly text: string;
  readonly chaptersFromSpine: readonly { readonly title: string; readonly text: string }[];
} {
  const entries = readZipPermissive(bytes);
  const lookup = new Map<string, Uint8Array>();
  for (const [k, v] of entries) lookup.set(k.replace(/\\/g, "/"), v);

  let opfPath: string | null = null;
  const containerBytes = lookup.get("META-INF/container.xml");
  if (containerBytes) {
    const containerXml = new TextDecoder("utf-8").decode(containerBytes);
    const rootFileMatch = containerXml.match(/<rootfile\b[^>]*full-path\s*=\s*(?:"([^"]+)"|'([^']+)')/iu);
    opfPath = rootFileMatch?.[1] ?? rootFileMatch?.[2] ?? null;
  }
  if (!opfPath) {
    opfPath = [...lookup.keys()].find((k) => /\.opf$/iu.test(k)) ?? null;
  }

  const orderedPaths: string[] = [];
  if (opfPath && lookup.has(opfPath)) {
    const opfXml = new TextDecoder("utf-8").decode(lookup.get(opfPath)!);
    const baseDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/")) : "";
    const manifest = new Map<string, { href: string; mediaType: string }>();
    for (const itemMatch of opfXml.matchAll(/<item\b([^>]+)\/?>/giu)) {
      const attrs = parseXmlAttributes(itemMatch[1] ?? "");
      if (attrs.id && attrs.href) {
        manifest.set(attrs.id, {
          href: resolveZipRelativePath(baseDir, decodeURIComponent(attrs.href)),
          mediaType: attrs["media-type"] ?? "",
        });
      }
    }
    for (const refMatch of opfXml.matchAll(/<itemref\b([^>]+)\/?>/giu)) {
      const attrs = parseXmlAttributes(refMatch[1] ?? "");
      const item = attrs.idref ? manifest.get(attrs.idref) : undefined;
      if (!item) continue;
      if (!item.mediaType || /html|xhtml|xml/iu.test(item.mediaType) || /\.(?:x?html?|htm)$/iu.test(item.href)) {
        orderedPaths.push(item.href);
      }
    }
  }

  if (orderedPaths.length === 0) {
    orderedPaths.push(
      ...[...lookup.keys()]
        .filter((k) => /\.(?:x?html?|htm)$/iu.test(k) && !/(?:^|\/)(?:toc|nav|cover)\./iu.test(k))
        .sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true })),
    );
  }

  const chaptersFromSpine: { title: string; text: string }[] = [];
  const decoder = new TextDecoder("utf-8");
  for (const path of orderedPaths) {
    const raw = lookup.get(path);
    if (!raw) continue;
    const { title, text } = htmlToPlainText(decoder.decode(raw));
    if (!text || text.length < 20) continue;
    chaptersFromSpine.push({
      title: title || `第${chaptersFromSpine.length + 1}章`,
      text,
    });
  }

  if (chaptersFromSpine.length === 0) {
    throw new SourceExtractError("未能从 EPUB 文件中提取出有效章节正文（可能是加密或纯图片版 EPUB）。", 400);
  }

  const combined = chaptersFromSpine
    .map((ch, idx) => {
      const hasHeading = /^(?:第[零〇一二两三四五六七八九十百千万\d]+[章节回]|Chapter\s+\d+)/iu.test(ch.title);
      const heading = hasHeading ? ch.title : `第${idx + 1}章 ${ch.title}`;
      const body = ch.text.startsWith(ch.title) ? ch.text.slice(ch.title.length).trim() : ch.text;
      return `${heading}\n${body || ch.text}`;
    })
    .join("\n\n");

  return { text: combined, chaptersFromSpine };
}

export function extractUploadedSources(files: readonly UploadedSourceInput[]): ExtractedSourceFile {
  if (files.length === 0) {
    throw new SourceExtractError("请至少选择一个原文文件。", 400);
  }

  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true }));
  if (sorted.length === 1) {
    const file = sorted[0]!;
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".docx")) {
      const text = extractTextFromDocxBytes(file.bytes);
      return { name: file.name, text, encoding: "docx" };
    }
    if (lower.endsWith(".epub")) {
      const epub = extractTextFromEpubBytes(file.bytes);
      return { name: file.name, text: epub.text, encoding: "epub", chaptersFromSpine: epub.chaptersFromSpine };
    }
    if (!/\.(?:txt|md|markdown|text)$/iu.test(lower)) {
      throw new SourceExtractError(`不支持的文件格式「${file.name}」，请上传 .txt、.md、.epub 或 .docx。`, 400);
    }
    const decoded = decodeTextBytes(file.bytes);
    return { name: file.name, text: decoded.text, encoding: decoded.encoding };
  }

  const parts: { title: string; text: string }[] = [];
  let primaryEncoding: DissectSourceEncoding = "utf-8";
  for (const file of sorted) {
    const lower = file.name.toLowerCase();
    const baseTitle = (file.name.split(/[\\/]/).pop() ?? file.name).replace(/\.[^.]+$/u, "").trim();
    if (lower.endsWith(".docx")) {
      primaryEncoding = "docx";
      parts.push({ title: baseTitle, text: extractTextFromDocxBytes(file.bytes) });
    } else if (lower.endsWith(".epub")) {
      primaryEncoding = "epub";
      const epub = extractTextFromEpubBytes(file.bytes);
      for (const ch of epub.chaptersFromSpine) parts.push(ch);
    } else if (/\.(?:txt|md|markdown|text)$/iu.test(lower)) {
      const decoded = decodeTextBytes(file.bytes);
      primaryEncoding = decoded.encoding;
      if (decoded.text.trim()) parts.push({ title: baseTitle, text: decoded.text.trim() });
    }
  }

  if (parts.length === 0) {
    throw new SourceExtractError("所选文件夹或文件列表中没有可读取的正文内容（支持 .txt / .md / .epub / .docx）。", 400);
  }

  const text = parts
    .map((part, idx) => {
      const firstLine = part.text.split("\n")[0]?.trim() ?? "";
      const hasHeading = /^(?:#{1,4}\s*)?(?:第[零〇一二两三四五六七八九十百千万\d]+[章节回]|Chapter\s+\d+)/iu.test(firstLine);
      if (hasHeading) return part.text;
      const heading = /^(?:第[零〇一二两三四五六七八九十百千万\d]+[章节回]|Chapter\s+\d+)/iu.test(part.title)
        ? part.title
        : `第${idx + 1}章 ${part.title}`;
      return `${heading}\n${part.text}`;
    })
    .join("\n\n");

  return {
    name: sorted[0]!.name,
    text,
    encoding: primaryEncoding,
    chaptersFromSpine: parts,
  };
}
