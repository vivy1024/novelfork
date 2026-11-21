import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  checkWorkflowDraftFilePath,
  classifyWorkflowNativeWrite,
  explainOutOfScopeNativeWrites,
  workflowDraftRoundStart,
} from "./draft-write-scope.js";

const BOOK = join(tmpdir(), "nf-draft-scope-book");

describe("交稿路径校验（checkWorkflowDraftFilePath）", () => {
  it("本章章节文件放行，可省略 chapters/ 前缀，反斜杠归一", () => {
    expect(checkWorkflowDraftFilePath("chapters/卷01/0003_破局.md", 3)).toEqual({ ok: true, relativePath: "chapters/卷01/0003_破局.md" });
    expect(checkWorkflowDraftFilePath("卷01\\0003_破局.md", 3)).toEqual({ ok: true, relativePath: "chapters/卷01/0003_破局.md" });
  });

  it("索引、废稿、其他章节、非章节文件、越界路径一律拒绝并带三段说明", () => {
    for (const path of [
      "chapters/index.json",
      "index.json",
      "chapters/_discarded/0003_旧稿.md",
      "chapters/卷01/0002_上一章.md",
      "story/pending_hooks.md",
      "chapters/卷01/0003_破局.txt",
      "chapters/../book.json",
      "",
    ]) {
      const result = checkWorkflowDraftFilePath(path, 3);
      expect(result.ok, path).toBe(false);
      if (!result.ok) {
        expect(result.explanation.what).toBeTruthy();
        expect(result.explanation.why).toBeTruthy();
        expect(result.explanation.action).toContain("targetChapterPath");
      }
    }
  });
});

describe("原生写盘落点判定（classifyWorkflowNativeWrite）", () => {
  it("本章草稿放行（绝对路径或按工作目录解析的相对路径）", () => {
    expect(classifyWorkflowNativeWrite([BOOK], 3, join(BOOK, "chapters", "卷01", "0003_破局.md"))).toMatchObject({ kind: "draft" });
    expect(classifyWorkflowNativeWrite([BOOK], 3, "chapters/卷01/0003_破局.md", BOOK)).toMatchObject({ kind: "draft" });
  });

  it("书根下 Runtime 自有元数据（计划文件）放行", () => {
    expect(classifyWorkflowNativeWrite([BOOK], 3, join(BOOK, ".narrafork", "plans", "p.md"))).toMatchObject({ kind: "runtime-metadata" });
  });

  it("权威索引、书内数据、其他章节、书根之外都算越界", () => {
    for (const target of [
      join(BOOK, "chapters", "index.json"),
      join(BOOK, "story", "style_preset.json"),
      join(BOOK, "book.json"),
      join(BOOK, "chapters", "卷01", "0002_上一章.md"),
    ]) {
      expect(classifyWorkflowNativeWrite([BOOK], 3, target), target).toMatchObject({ kind: "violation" });
    }
    const outside = classifyWorkflowNativeWrite([BOOK], 3, join(tmpdir(), "elsewhere", "notes.md"));
    expect(outside).toMatchObject({ kind: "violation", relativePath: null });
  });

  it("书根的任一写法（原样 / realpath）命中即视为书内", () => {
    const alias = join(tmpdir(), "nf-draft-scope-alias");
    expect(classifyWorkflowNativeWrite([alias, BOOK], 3, join(BOOK, "chapters", "0003_破局.md"))).toMatchObject({ kind: "draft" });
  });
});

describe("本轮起点与越界说明", () => {
  it("取最近一次让写章重新开始的事件；候选提交等其他事件不移动起点", () => {
    const events = [
      { seq: 1, at: 100, type: "run_started", payload: {} },
      { seq: 2, at: 200, type: "step_approved", payload: {} },
      { seq: 3, at: 300, type: "candidate_submitted", payload: {} },
      { seq: 4, at: 400, type: "step_rejected", payload: {} },
      { seq: 5, at: 500, type: "step_awaiting_approval", payload: {} },
    ];
    expect(workflowDraftRoundStart(50, events)).toBe(400);
    expect(workflowDraftRoundStart(50, [])).toBe(50);
  });

  it("无越界时为 null；有越界时去重列出并指向 blocker", () => {
    expect(explainOutOfScopeNativeWrites(3, [], "submit")).toBeNull();
    const explanation = explainOutOfScopeNativeWrites(3, [
      { toolName: "Write", display: "chapters/index.json" },
      { toolName: "Write", display: "chapters/index.json" },
      { toolName: "Edit", display: "story/pending_hooks.md" },
    ], "commit");
    expect(explanation?.what).toContain("落盘被拦下");
    expect(explanation?.what.match(/chapters\/index\.json/g)?.length).toBe(1);
    expect(explanation?.action).toContain("blocker");
  });
});
