import { describe, expect, it, vi } from "vitest";

import { NOVEL_SESSION_TOOL_DEFINITIONS } from "./tool-registry";

function tool(name: string) {
  return NOVEL_SESSION_TOOL_DEFINITIONS.find((definition) => definition.name === name);
}

describe("novel tool registry lore/memory boundary", () => {
  it("注册 lore 静态设定工具作为唯一入口；jingwei.read / jingwei.write 兼容别名已下线", () => {
    expect(tool("lore.read")?.description).toContain("静态设定");
    expect(tool("lore.write")?.description).toContain("静态设定");

    // 别名下线后不再注册；jingwei.audit 是独有功能，保留
    expect(tool("jingwei.read")).toBeUndefined();
    expect(tool("jingwei.write")).toBeUndefined();
    expect(tool("jingwei.audit")?.description).toContain("经纬审计门禁");
  });

  /**
   * 剧情工具：lore.relate 写动态关系（needs-review），lore.progress 推进动态字段
   * 并留演变台账。两者都是 agent 写剧情的结构化出口，不是静态设定工具。
   */
  it("registers lore.relate and lore.progress as story progress tools", () => {
    expect(tool("lore.relate")?.description).toContain("relationships");
    expect(tool("lore.relate")?.description).toContain("needs-review");
    expect(tool("lore.relate")?.risk).toBe("draft-write");
    expect(tool("lore.relate")?.renderer).toBe("jingwei.write");
    expect(tool("lore.relate")?.visibility).toBe("author");
    expect(tool("lore.relate")?.runtimeStatus).toBe("ready");

    expect(tool("lore.progress")?.description).toContain("jingwei_progressions");
    expect(tool("lore.progress")?.description).toContain("canon");
    expect(tool("lore.progress")?.risk).toBe("draft-write");
    expect(tool("lore.progress")?.renderer).toBe("jingwei.write");
    expect(tool("lore.progress")?.runtimeStatus).toBe("ready");
  });

  it("registers memory tools for dynamic retrieval, graph, pending events, and admin operations", () => {
    expect(tool("memory.read")?.description).toContain("动态叙事记忆");
    expect(tool("memory.graph")?.description).toContain("关系图");
    expect(tool("memory.events")?.description).toContain("Pending NarrativeEvents");
    expect(tool("memory.read")?.visibility).toBe("author");
    expect(tool("memory.graph")?.visibility).toBe("author");
    expect(tool("memory.events")?.visibility).toBe("author");

    for (const name of ["memory.list", "memory.read_entry", "memory.search", "memory.dedup", "memory.export", "memory.stats"]) {
      expect(tool(name)?.description).toContain("管理层");
      expect(tool(name)?.risk).toBe("read");
      expect(tool(name)?.visibility).toBe("advanced");
    }
    for (const name of ["memory.update", "memory.delete", "memory.bulk_approve", "memory.bulk_delete"]) {
      expect(tool(name)?.description).toContain("管理层");
      expect(tool(name)?.risk).toBe("confirmed-write");
      expect(tool(name)?.visibility).toBe("advanced");
    }
  });

  it("registers jingwei.audit as a read-only lore audit gate", () => {
    expect(tool("jingwei.audit")?.description).toContain("审计门禁");
    expect(tool("jingwei.audit")?.description).toContain("active + confirmed + participates_in_ai");
    expect(tool("jingwei.audit")?.risk).toBe("read");
    expect(tool("jingwei.audit")?.visibility).toBe("advanced");
  });

  it("does not advertise candidates as cockpit snapshot core output", () => {
    const description = tool("cockpit.snapshot")?.description ?? "";

    expect(description).not.toContain("候选稿");
    expect(description).not.toContain("candidates");
    expect(description).toContain("正式章节");
  });

  it("updates scene spec workflow to use lore/jingwei static settings and memory dynamic recall", () => {
    const description = tool("scene.spec")?.description ?? "";
    expect(description).toContain("write.preflight");
    expect(description).toContain("lore.read");
    expect(description).toContain("memory.read");
    expect(description).toContain("章后结算");
  });

  it("registers market research tools as book-agnostic public ranking tools", () => {
    expect(tool("market.scan")?.description).toContain("公开榜单");
    expect(tool("market.scan")?.description).toContain("经纬/Lore");
    expect(tool("market.scan")?.risk).toBe("read");
    expect(tool("market.scan")?.scope).toBe("universal");
    expect(tool("market.query")?.description).toContain("历史快照");
    expect(tool("market.ranks")?.description).toContain("自定义榜");
    expect(tool("market.ranks")?.risk).toBe("read");
    expect(tool("market.ranks")?.scope).toBe("universal");
    expect(tool("market.sample_public_chapters")?.description).toContain("fanqieBookId");
    expect(tool("market.sample_public_chapters")?.description).toContain("不入库");
  });

  it("registers write context gate and settlement/discard tools", () => {
    expect(tool("write.preflight")?.risk).toBe("read");
    expect(tool("memory.settle_range")?.risk).toBe("confirmed-write");
    expect(tool("chapter.discard_range")?.risk).toBe("destructive");
    expect(tool("pipeline.write")?.description).toContain("context-not-ready");
    expect(tool("chapter.propose_selection")).toMatchObject({ risk: "draft-write", renderer: "chapter.selection-candidate", runtimeStatus: "ready" });
  });

  it("registers import closed-loop and book.dissect tools", () => {
    const dissect = tool("book.dissect")?.description ?? "";
    expect(dissect).toContain("写后续");
    expect(dissect).toContain("同人");
    expect(dissect).toContain("改编");
    expect(dissect).toContain("经纬草稿");
    expect(dissect).toContain("settle");
    expect(tool("pipeline.import_chapters")?.description).toContain("autoSettle");
    // 内部调模型的 style.import / rewrite.segment / outline.suggest_next 已下线
    expect(tool("style.import")).toBeUndefined();
    expect(tool("rewrite.segment")).toBeUndefined();
    expect(tool("outline.suggest_next")).toBeUndefined();
  });

  it("registers volume outline, character arc and publish check tools", () => {
    expect(tool("outline.volume")?.description).toContain("卷");
    expect(tool("outline.volume")?.risk).toBe("confirmed-write");
    expect(tool("arc.character")?.description).toContain("弧线");
    expect(tool("arc.character")?.risk).toBe("confirmed-write");
    expect(tool("publish.check")?.description).toContain("敏感词");
    expect(tool("publish.check")?.risk).toBe("read");
  });

  it("forwards search category and author visibility filters through jingwei.read", async () => {
    const handleJingweiSearch = vi.fn(async () => ({ ok: true, summary: "ok" }));
    vi.resetModules();
    vi.doMock("./jingwei-read.js", () => ({
      handleJingweiReadBrief: vi.fn(async () => ({ ok: true, summary: "ok" })),
      handleJingweiReadCategory: vi.fn(async () => ({ ok: true, summary: "ok" })),
      handleJingweiSearch,
    }));

    try {
      const { handleJingweiRead } = await import("./jingwei-read-unified.js");
      await handleJingweiRead({
        bookId: "book-1",
        scope: "search",
        query: "B-17",
        categories: ["foreshadowing"],
        includeUnconfirmed: true,
        chapterNumber: 2,
        tokenBudget: 800,
        limit: 5,
        detailLevel: "full",
      });

      expect(handleJingweiSearch).toHaveBeenCalledWith({
        bookId: "book-1",
        query: "B-17",
        categories: ["foreshadowing"],
        includeUnconfirmed: true,
        chapterNumber: 2,
        tokenBudget: 800,
        limit: 5,
        detailLevel: "full",
      });
    } finally {
      vi.doUnmock("./jingwei-read.js");
      vi.resetModules();
    }
  });
});
