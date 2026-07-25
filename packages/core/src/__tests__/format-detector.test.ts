import { deflateRawSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  detectFormat,
  extractEpubText,
  htmlToPlainText,
  normalizeImportSource,
} from "../utils/format-detector.js";
import { splitChapters } from "../utils/chapter-splitter.js";

// ── Minimal in-memory EPUB (ZIP) builder for tests ──────────────────────────

interface ZipFile {
  name: string;
  content: string;
  store?: boolean;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function u32(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

function buildZip(files: readonly ZipFile[]): Uint8Array {
  const encoder = new TextEncoder();
  const local: number[] = [];
  const central: number[] = [];
  let offset = 0;
  let count = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const raw = encoder.encode(file.content);
    const stored = file.store === true;
    const data = stored ? raw : new Uint8Array(deflateRawSync(raw));
    const method = stored ? 0 : 8;
    const checksum = crc32(raw);

    const header = [
      ...u32(0x04034b50),
      ...u16(20),
      ...u16(0),
      ...u16(method),
      ...u16(0),
      ...u16(0),
      ...u32(checksum),
      ...u32(data.length),
      ...u32(raw.length),
      ...u16(nameBytes.length),
      ...u16(0),
      ...nameBytes,
      ...data,
    ];
    local.push(...header);

    central.push(
      ...u32(0x02014b50),
      ...u16(20),
      ...u16(20),
      ...u16(0),
      ...u16(method),
      ...u16(0),
      ...u16(0),
      ...u32(checksum),
      ...u32(data.length),
      ...u32(raw.length),
      ...u16(nameBytes.length),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(offset),
      ...nameBytes,
    );

    offset += header.length;
    count += 1;
  }

  const centralOffset = local.length;
  const eocd = [
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(count),
    ...u16(count),
    ...u32(central.length),
    ...u32(centralOffset),
    ...u16(0),
  ];
  return new Uint8Array([...local, ...central, ...eocd]);
}

function sampleEpub(): Uint8Array {
  return buildZip([
    { name: "mimetype", content: "application/epub+zip", store: true },
    {
      name: "META-INF/container.xml",
      content: `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>`,
    },
    {
      name: "OEBPS/content.opf",
      content: `<?xml version="1.0"?>
<package><metadata><dc:title>测试书</dc:title><dc:creator>某作者</dc:creator></metadata>
<manifest>
  <item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
  <item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
</manifest>
<spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`,
    },
    {
      name: "OEBPS/ch1.xhtml",
      content: `<html><body><h1>第一章 山门</h1><p>韩立走进山门。</p><p>青铜铃响起。</p></body></html>`,
    },
    {
      name: "OEBPS/ch2.xhtml",
      content: `<html><body><h1>第二章 试炼</h1><p>他通过了试炼。</p></body></html>`,
    },
  ]);
}

describe("detectFormat", () => {
  it("detects epub by zip signature", () => {
    const result = detectFormat(sampleEpub());
    expect(result.format).toBe("epub");
  });

  it("detects html by tags", () => {
    expect(detectFormat("<!DOCTYPE html><html><body><p>hi</p></body></html>").format).toBe("html");
    expect(detectFormat("<div>第一章</div>").format).toBe("html");
  });

  it("detects markdown by headings or lists", () => {
    expect(detectFormat("# 第一章\n\n正文").format).toBe("markdown");
    expect(detectFormat("- 条目一\n- 条目二").format).toBe("markdown");
  });

  it("falls back to txt and flags empty input", () => {
    expect(detectFormat("第一章 山门\n韩立走进山门。").format).toBe("txt");
    expect(detectFormat("   ").format).toBe("unknown");
  });
});

describe("htmlToPlainText", () => {
  it("keeps paragraph boundaries and drops script/style", () => {
    const text = htmlToPlainText(
      `<html><head><style>p{color:red}</style></head><body><h1>第一章</h1><p>第一段</p><p>第二段</p><script>x=1</script></body></html>`,
    );
    expect(text).toContain("第一章");
    expect(text).toContain("第一段");
    expect(text).toContain("第二段");
    expect(text).not.toContain("color:red");
    expect(text).not.toContain("x=1");
    expect(text.split("\n").length).toBeGreaterThan(1);
  });

  it("decodes entities", () => {
    expect(htmlToPlainText("<p>a&amp;b&nbsp;c&#39;d</p>")).toContain("a&b c'd");
  });
});

describe("extractEpubText", () => {
  it("extracts spine ordered text and metadata", async () => {
    const result = await extractEpubText(sampleEpub());
    expect(result.spineItemCount).toBe(2);
    expect(result.metadata.title).toBe("测试书");
    expect(result.metadata.author).toBe("某作者");
    expect(result.plainText).toContain("第一章 山门");
    expect(result.plainText).toContain("第二章 试炼");
    expect(result.plainText.indexOf("第一章")).toBeLessThan(result.plainText.indexOf("第二章"));
  });

  it("rejects non-zip input", async () => {
    await expect(extractEpubText(new TextEncoder().encode("plain text"))).rejects.toThrow();
  });
});

describe("normalizeImportSource", () => {
  it("normalizes epub bytes into splittable plain text", async () => {
    const result = await normalizeImportSource({ bytes: sampleEpub(), fileName: "book.epub" });
    expect(result.format).toBe("epub");
    expect(result.metadata.title).toBe("测试书");
    const chapters = splitChapters(result.plainText);
    expect(chapters.length).toBeGreaterThanOrEqual(2);
  });

  it("normalizes html text", async () => {
    const result = await normalizeImportSource({
      text: "<html><body><p>第一章 山门</p><p>韩立走进山门。</p></body></html>",
      fileName: "book.html",
    });
    expect(result.format).toBe("html");
    expect(result.plainText).toContain("韩立走进山门");
  });

  it("passes plain text through", async () => {
    const result = await normalizeImportSource({ text: "第一章 山门\n韩立走进山门。" });
    expect(result.format).toBe("txt");
    expect(result.plainText).toContain("第一章 山门");
  });

  it("warns on empty input", async () => {
    const result = await normalizeImportSource({ text: "  " });
    expect(result.plainText).toBe("");
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
