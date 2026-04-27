import { describe, expect, it } from "vitest";
import { parseTxt, parseFile } from "../tools/import/file-parser.js";

describe("parseTxt", () => {
  it("returns empty chapters for empty text", () => {
    expect(parseTxt("").chapters).toEqual([]);
    expect(parseTxt("   \n\n  ").chapters).toEqual([]);
  });

  it("treats single block as one chapter", () => {
    const result = parseTxt("第一章 开端\n这是正文内容。");
    expect(result.chapters).toHaveLength(1);
    expect(result.chapters[0].title).toBe("第一章 开端");
    expect(result.chapters[0].content).toBe("这是正文内容。");
  });

  it("splits multiple chapters by double newlines", () => {
    const text = [
      "第一章 开端",
      "正文一。",
      "",
      "第二章 发展",
      "正文二。",
      "",
      "第三章 高潮",
      "正文三。",
    ].join("\n");

    const result = parseTxt(text);
    expect(result.chapters).toHaveLength(3);
    expect(result.chapters[0].title).toBe("第一章 开端");
    expect(result.chapters[1].title).toBe("第二章 发展");
    expect(result.chapters[2].title).toBe("第三章 高潮");
    expect(result.chapters[2].content).toBe("正文三。");
  });

  it("truncates at 100 chapters", () => {
    const segments: string[] = [];
    for (let i = 0; i < 120; i++) {
      segments.push(`第${i + 1}章\n内容${i + 1}`);
    }
    const text = segments.join("\n\n");
    const result = parseTxt(text);
    expect(result.chapters).toHaveLength(100);
  });
});

describe("parseFile", () => {
  it("parses .txt files", () => {
    const result = parseFile("标题\n内容", "novel.txt");
    expect(result.chapters).toHaveLength(1);
  });

  it("parses .md files", () => {
    const result = parseFile("标题\n内容", "novel.md");
    expect(result.chapters).toHaveLength(1);
  });

  it("returns empty for unsupported formats", () => {
    expect(parseFile("content", "novel.docx").chapters).toEqual([]);
    expect(parseFile("content", "novel.epub").chapters).toEqual([]);
  });
});
