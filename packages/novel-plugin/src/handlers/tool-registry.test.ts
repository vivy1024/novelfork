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

describe("T-05a 按动作判定风险（lore.write 与 memory.events）", () => {
  const RANK: Record<string, number> = { read: 0, "draft-write": 1, "confirmed-write": 2, destructive: 3 };
  const risk = (name: string, input: Record<string, unknown>) => {
    const definition = tool(name);
    if (!definition) throw new Error(`tool ${name} not registered`);
    return definition.resolveRisk?.(input) ?? definition.risk;
  };

  it("lore.write 的 retire 与 delete 风险不低于 confirmed-write", () => {
    expect(RANK[risk("lore.write", { action: "retire" })]!).toBeGreaterThanOrEqual(RANK["confirmed-write"]!);
    expect(RANK[risk("lore.write", { action: "delete" })]!).toBeGreaterThanOrEqual(RANK["confirmed-write"]!);
  });

  it("memory.events 的 approve 与 reject 风险不低于 confirmed-write", () => {
    expect(RANK[risk("memory.events", { action: "approve", eventId: "e1" })]!).toBeGreaterThanOrEqual(RANK["confirmed-write"]!);
    expect(RANK[risk("memory.events", { action: "reject", eventId: "e1" })]!).toBeGreaterThanOrEqual(RANK["confirmed-write"]!);
  });

  it("只读与非 canon 的新建/更新不被误升到 confirmed-write 或更高", () => {
    expect(RANK[risk("memory.events", { action: "list" })]!).toBeLessThanOrEqual(RANK["draft-write"]!);
    // 普通 dynamic / reference 写入仍是草稿级；canon 才升级（见下方 canon 用例）。
    expect(RANK[risk("lore.write", { action: "create", category: "relationships" })]!).toBeLessThanOrEqual(RANK["draft-write"]!);
    expect(RANK[risk("lore.write", { action: "update", layer: "dynamic", category: "characters" })]!).toBeLessThanOrEqual(RANK["draft-write"]!);
    expect(RANK[risk("lore.write", { action: "create", layer: "reference", category: "characters" })]!).toBeLessThanOrEqual(RANK["draft-write"]!);
    expect(RANK[risk("lore.write", { action: "create", category: "自定义分类" })]!).toBeLessThanOrEqual(RANK["draft-write"]!);
    // 拒绝拆书候选不写正式库，仍是草稿级。
    expect(RANK[risk("lore.write", { stagingId: "s1", stagingDecision: "reject" })]!).toBeLessThanOrEqual(RANK["draft-write"]!);
  });

  it("lore.write 批量 entries[] 里夹带的 delete/retire 不能被顶层草稿级掩盖", () => {
    expect(risk("lore.write", { entries: [{ action: "retire", title: "旧设定", reason: "过期" }] })).toBe("confirmed-write");
    expect(risk("lore.write", { action: "create", category: "relationships", entries: [
      { action: "create", category: "relationships", title: "A" },
      { action: "delete", title: "B" },
    ] })).toBe("confirmed-write");
    // handler 对每项递归执行，嵌套 entries 同样要扫描。
    expect(risk("lore.write", { entries: [{ entries: [{ action: "retire", title: "C" }] }] })).toBe("confirmed-write");
    // 全部是 dynamic 普通写入的批量仍是草稿级（顶层单条字段在批量时被 handler 忽略，不参与判定）。
    expect(risk("lore.write", { entries: [
      { action: "create", category: "relationships", title: "A" },
      { action: "update", layer: "dynamic", category: "characters", title: "B" },
    ] })).toBe("draft-write");
  });

  it("lore.write 写入或覆盖 canon、晋升拆书候选一律升到 confirmed-write（顶层与 entries[] 都看）", () => {
    expect(risk("lore.write", { action: "create", layer: "canon", category: "characters", title: "主角" })).toBe("confirmed-write");
    expect(risk("lore.write", { action: "update", layer: "canon", category: "characters", title: "主角" })).toBe("confirmed-write");
    expect(risk("lore.write", { action: "update", confirmCanonEdit: true, title: "主角", layer: "dynamic" })).toBe("confirmed-write");
    expect(risk("lore.write", { stagingId: "s1", stagingDecision: "promote" })).toBe("confirmed-write");
    // 不显式给 layer 时 handler 按分类默认层落盘：canon 默认分类等同写 canon。
    expect(risk("lore.write", { action: "create", category: "characters", title: "主角" })).toBe("confirmed-write");
    expect(risk("lore.write", { action: "create", category: "character", title: "主角" })).toBe("confirmed-write");
    // 不给分类时 handler 按标题/正文推断分类，可能落到 canon 分类，按 canon 计。
    expect(risk("lore.write", { action: "create", title: "主角", contentMd: "主角设定" })).toBe("confirmed-write");
    expect(risk("lore.write", { entries: [{ action: "create", layer: "canon", category: "premise", title: "基线" }] })).toBe("confirmed-write");
    expect(risk("lore.write", { entries: [{ action: "update", confirmCanonEdit: true, layer: "dynamic", title: "主角" }] })).toBe("confirmed-write");
    expect(risk("lore.write", { entries: [{ stagingId: "s1", stagingDecision: "promote" }] })).toBe("confirmed-write");
  });

  it("memory.events 的批量 events[] 不携带逐条动作，风险只由顶层 action 决定", () => {
    // handler 只认顶层 action；events[] 里写 approve 也只会按 create 建 pending 事件。
    expect(risk("memory.events", { action: "create", events: [{ action: "approve", eventId: "e1" }] })).toBe("draft-write");
    expect(risk("memory.events", { action: "approve", eventId: "e1", events: [] })).toBe("confirmed-write");
  });

  it("outline.volume / arc.character 与 handler 同样先 trim 并转小写再判定动作", () => {
    // handler 的 parseAction 会把 "SET" / " sync " 解析成写动作；风险判定不能按原样比较而降成只读。
    expect(risk("outline.volume", { action: "SET" })).toBe("confirmed-write");
    expect(risk("outline.volume", { action: " Suggest " })).toBe("draft-write");
    expect(risk("outline.volume", { action: "get" })).toBe("read");
    expect(risk("arc.character", { action: " SYNC " })).toBe("draft-write");
    expect(risk("arc.character", { action: "Refine" })).toBe("draft-write");
    expect(risk("arc.character", {})).toBe("read");
  });
});

describe("T-05a 既有行为守护：book.dissect 的 resolveRisk 不变", () => {
  it("apply 或 settle 为 draft-write，其余为 read", () => {
    const definition = NOVEL_SESSION_TOOL_DEFINITIONS.find((item) => item.name === "book.dissect");
    expect(definition?.resolveRisk?.({ apply: true })).toBe("draft-write");
    expect(definition?.resolveRisk?.({ settle: true })).toBe("draft-write");
    expect(definition?.resolveRisk?.({})).toBe("read");
  });
});
