/**
 * 学习中心教程与实现的一致性。
 *
 * 教程会直接教作者和叙述者用某个工具、点某个检查项。工具改名或下线、检查项换了名字后，
 * 文档若不同步，照着做就会撞上「工具不存在」或找不到按钮，而这类错误在纯文档评审里很难发现。
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { buildWriteViewModel } from "../pages/writing-workbench/write-view-state.js";
import { NOVEL_SESSION_TOOL_DEFINITIONS } from "./tool-registry.js";

const DOCS_ROOT = resolve(__dirname, "../../../../docs/learning");
const LINES = ["book", "craft"] as const;

function readDoc(relativePath: string): string {
  return readFileSync(resolve(DOCS_ROOT, relativePath), "utf8");
}

const ALL_DOCS = LINES.flatMap((line) =>
  readdirSync(resolve(DOCS_ROOT, line))
    .filter((file) => file.endsWith(".md"))
    .map((file) => `${line}/${file}`),
);

/**
 * 非领域引用：宿主能力或第三方工具，不由 novel-plugin 的 tool-registry 提供。
 * 领域工具一律不许进这里 —— 有测试盯着，进来了会报错。
 */
const NON_DOMAIN_REFERENCES = new Set<string>([]);

const registeredTools = new Set(NOVEL_SESSION_TOOL_DEFINITIONS.map((tool) => tool.name));

/** 抓形如 `foo.bar` 的工具引用（含反引号包裹与调用括号两种写法）。 */
function referencedTools(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/`([a-z_-]+\.[a-z_.]+)(?:\([^`]*\))?`/gu)) {
    found.add(match[1]!);
  }
  // 正文里未加反引号的调用式引用，如 memory.settle_range(...)
  for (const match of text.matchAll(/\b([a-z]+\.[a-z_]+)\(/gu)) {
    found.add(match[1]!);
  }
  return [...found];
}

/** write.preflight 可能返回的全部阻断码与提醒码（见 handlers/write-preflight.ts 的类型）。 */
const PREFLIGHT_BLOCKER_CODES = ["missing-directive", "empty-recent-progress", "high-risk-pending", "book-not-found"];
const PREFLIGHT_WARNING_CODES = [
  "style-disabled", "hooks-overdue", "volume-focus-missing", "short-directive", "focus-default-only",
  "high-risk-pending", "empty-chapter-summary", "platform-target-mismatch", "audit-stale",
  "volume-range-drift", "skills-not-acknowledged",
];

describe("学习中心教程与实现一致性", () => {
  it("两条线都有教程", () => {
    expect(ALL_DOCS.filter((doc) => doc.startsWith("book/")).length).toBeGreaterThan(0);
    expect(ALL_DOCS.filter((doc) => doc.startsWith("craft/")).length).toBeGreaterThan(0);
  });

  it("registry 非空且包含教程依赖的工具", () => {
    for (const tool of ["write.preflight", "memory.settle_range", "chapter.discard_range", "publish.check", "style.distill_adopt", "character.voice.draft", "hooks.manage"]) {
      expect(registeredTools.has(tool), `${tool} 未注册`).toBe(true);
    }
  });

  it.each(ALL_DOCS)("%s 引用的工具都存在", (docName) => {
    const referenced = referencedTools(readDoc(docName));
    const missing = referenced.filter(
      (tool) => !registeredTools.has(tool) && !NON_DOMAIN_REFERENCES.has(tool),
    );
    expect(
      missing,
      `${docName} 引用了不存在的工具：${missing.join(", ")}。改名/下线工具时请同步文档。`,
    ).toEqual([]);
  });

  it("写作侧栏里带「一键修」的检查项，都在「写下一章」教程里讲到", () => {
    const model = buildWriteViewModel({
      ok: false,
      blockers: PREFLIGHT_BLOCKER_CODES.map((code) => ({ code, message: code })),
      warningItems: PREFLIGHT_WARNING_CODES.map((code) => ({ code, message: code })),
    });
    const fixable = [...new Set(model.checks.filter((check) => check.fixAction).map((check) => check.label))];
    expect(fixable.length).toBeGreaterThan(0);
    const doc = readDoc("book/04-write-next-chapter.md");
    const missing = fixable.filter((label) => !doc.includes(`「${label}」`));
    expect(missing, `写作侧栏检查项改了名字，请同步 docs/learning/book/04-write-next-chapter.md：${missing.join("、")}`).toEqual([]);
  });

  it("「写下一章」教程讲到写前检查与废稿处理", () => {
    // 这两条是写章纪律：不讲清，作者不知道为什么被拦、写废了该怎么办
    const doc = readDoc("book/04-write-next-chapter.md");
    expect(doc).toContain("write.preflight");
    expect(doc).toContain("chapter.discard_range");
    expect(doc).toContain("一键修");
  });

  it("每节写作课末尾都链到练习它的功能教程", () => {
    for (const docName of ALL_DOCS.filter((doc) => doc.startsWith("craft/"))) {
      const text = readDoc(docName);
      expect(text, `${docName} 缺少「在 NovelFork 里练」`).toContain("## 在 NovelFork 里练");
      expect(text, `${docName} 没有链到任何功能教程`).toMatch(/\/next\/learn\?doc=book-/u);
    }
  });

  it("NON_DOMAIN_REFERENCES 不残留已注册工具", () => {
    const stale = [...NON_DOMAIN_REFERENCES].filter((tool) => registeredTools.has(tool));
    expect(stale, `这些已在 registry 中，请从豁免名单删除：${stale.join(", ")}`).toEqual([]);
  });
});
