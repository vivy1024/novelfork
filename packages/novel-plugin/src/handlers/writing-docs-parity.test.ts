/**
 * 写作文档引用的工具名必须真实存在。
 *
 * SOP 与管线文档会直接教用户/叙述者调用某个工具。工具改名或下线后文档若不同步，
 * 用户照着做就会撞上「工具不存在」，而这类错误在纯文档评审里很难发现。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { NOVEL_SESSION_TOOL_DEFINITIONS } from "./tool-registry.js";

const DOCS_ROOT = resolve(__dirname, "../../../../docs/learning");
const DOCS = ["08-agent-pipeline.md", "27-writing-sop.md", "26-platform-writing-cards.md"];

function readDoc(name: string): string {
  return readFileSync(resolve(DOCS_ROOT, name), "utf8");
}

/**
 * 非领域引用：宿主能力或第三方工具，不由 novel-plugin 的 tool-registry 提供。
 * 领域工具一律不许进这里 —— 有测试盯着，进来了会报错。
 */
const NON_DOMAIN_REFERENCES = new Set([
  "AskUserQuestion",
]);

const registeredTools = new Set(NOVEL_SESSION_TOOL_DEFINITIONS.map((tool) => tool.name));

/** 抓形如 `foo.bar` 的工具引用（含反引号包裹与调用括号两种写法）。 */
function referencedTools(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/`([a-z_]+\.[a-z_]+)(?:\([^`]*\))?`/gu)) {
    found.add(match[1]!);
  }
  // 表格与正文里未加反引号的调用式引用，如 memory.settle_range 回填
  for (const match of text.matchAll(/\b([a-z]+\.[a-z_]+)\(/gu)) {
    found.add(match[1]!);
  }
  return [...found];
}

describe("写作文档与工具注册表一致性", () => {
  it("registry 非空且包含 S3 新增工具", () => {
    for (const tool of ["write.preflight", "memory.settle_range", "chapter.discard_range", "outline.volume", "publish.check", "book.dissect", "arc.character"]) {
      expect(registeredTools.has(tool), `${tool} 未注册`).toBe(true);
    }
  });

  it.each(DOCS)("%s 引用的工具都存在", (docName) => {
    const referenced = referencedTools(readDoc(docName));
    expect(referenced.length).toBeGreaterThan(0);
    const missing = referenced.filter(
      (tool) => !registeredTools.has(tool) && !NON_DOMAIN_REFERENCES.has(tool),
    );
    expect(
      missing,
      `${docName} 引用了不存在的工具：${missing.join(", ")}。改名/下线工具时请同步文档。`,
    ).toEqual([]);
  });

  it("SOP 覆盖写前硬门与废稿处理", () => {
    const sop = readDoc("27-writing-sop.md");
    // 这两条是 S1/S2 建立的纪律，SOP 必须讲到，否则用户不知道为什么被拦
    expect(sop).toContain("write.preflight");
    expect(sop).toContain("chapter.discard_range");
    expect(sop).toContain("needs-review");
  });

  it("管线文档列出 preflight 的全部阻断码", () => {
    const pipeline = readDoc("08-agent-pipeline.md");
    for (const code of ["missing-directive", "empty-recent-progress", "high-risk-pending", "book-not-found"]) {
      expect(pipeline, `缺少阻断码 ${code}`).toContain(code);
    }
  });

  it("NON_DOMAIN_REFERENCES 不残留已注册工具", () => {
    const stale = [...NON_DOMAIN_REFERENCES].filter((tool) => registeredTools.has(tool));
    expect(stale, `这些已在 registry 中，请从豁免名单删除：${stale.join(", ")}`).toEqual([]);
  });
});
