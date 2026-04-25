import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("parseMarkdownDirectoryImport", () => {
  it("recognizes advanced template candidates from a small markdown outline fixture", async () => {
    const fixture = readFileSync("src/components/jingwei/__fixtures__/advanced-template-outline.md", "utf-8");
    const { parseMarkdownDirectoryImport } = await import("./markdown-directory-import");

    const result = parseMarkdownDirectoryImport(fixture);

    expect(result.templateHint).toBe("advanced-template");
    expect(result.candidates.map((candidate) => candidate.name)).toEqual([
      "人物关系",
      "势力版图",
      "修炼体系",
      "灵石经济",
      "名场面档案",
      "伏笔总表",
    ]);
  });
});
