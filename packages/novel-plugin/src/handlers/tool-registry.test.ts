import { describe, expect, it, vi } from "vitest";

import {
  NOVEL_RUNTIME_TOOL_CATALOG,
  NOVEL_SESSION_TOOL_DEFINITIONS,
} from "./tool-registry";
import {
  getNovelToolRoutineId,
  LEGACY_NOVEL_TOOL_ROUTINE_GROUPS,
  listNovelToolRoutines,
  NOVEL_TOOL_ROUTINE_TOOL_NAMES,
  NOVEL_TOOL_ROUTINES,
} from "./tool-routines";

function tool(name: string) {
  return NOVEL_SESSION_TOOL_DEFINITIONS.find((definition) => definition.name === name);
}

describe("novel tool registry：25 个核心工具的边界", () => {
  it("只注册 25 个核心工具，旧入口全部下线", () => {
    expect(NOVEL_SESSION_TOOL_DEFINITIONS).toHaveLength(25);
    expect(NOVEL_SESSION_TOOL_DEFINITIONS.map((definition) => definition.name).sort()).toEqual([
      "book.import",
      "book.overview",
      "chapter.audit",
      "chapter.blueprint",
      "chapter.commit",
      "chapter.discard_range",
      "chapter.list",
      "chapter.preflight",
      "chapter.propose_selection",
      "character.inspect",
      "hooks.manage",
      "jingwei.read",
      "jingwei.write",
      "market.radar",
      "mechanism.distill",
      "memory.events",
      "memory.graph",
      "memory.read",
      "memory.search",
      "memory.settle",
      "outline.volume",
      "skills.manage",
      "style.manage",
      "workflow.manage",
      "workflow.step",
    ]);
    // 合并后的旧入口不再单独注册：能力都在上面 25 个工具里，留着就是第二条路径。
    for (const retired of [
      "lore.read",
      "lore.write",
      "lore.relate",
      "lore.progress",
      "jingwei.audit",
      "cockpit.snapshot",
      "write.preflight",
      "scene.spec",
      "pipeline.write",
      "pipeline.import_chapters",
      "chapter.write",
      "chapter.read",
      "memory.list",
      "memory.search_text",
      "memory.settle_chapter",
      "memory.settle_range",
      "memory.update",
      "memory.delete",
      "memory.bulk_approve",
      "memory.bulk_delete",
      "arc.character",
      "character.check_consistency",
      "character.voice.read",
      "character.voice.draft",
      "style.distill_index",
      "style.import",
      "rewrite.apply",
      "rewrite.segment",
      "outline.suggest_next",
      "book.dissect",
      "market.scan",
      "market.query",
      "market.ranks",
      "market.sample_public_chapters",
      "skills.recommend",
      "skills.check_compliance",
      "skills.import_legacy",
      "workflow.get_current_step",
      "workflow.submit_step_output",
      "workflow.report_blocker",
      "workflow.list_recipes",
      "workflow.get_recipe",
      "workflow.edit_recipe",
      "workflow.start_run",
      "publish.check",
      "resource.manage",
      "presets.read",
      "presets.write",
      "beat.read",
      "beat.write",
    ]) {
      expect(tool(retired), `${retired} 应已下线`).toBeUndefined();
    }
  });

  it("经纬静态设定只有一个读写入口：jingwei.read / jingwei.write", () => {
    expect(tool("jingwei.read")?.description).toContain("静态设定");
    expect(tool("jingwei.write")?.description).toContain("静态设定");
    expect(tool("jingwei.read")?.risk).toBe("read");
    expect(tool("jingwei.write")?.risk).toBe("draft-write");
    expect(tool("jingwei.read")?.renderer).toBe("jingwei.read");
    expect(tool("jingwei.write")?.renderer).toBe("jingwei.write");
  });

  /**
   * 剧情工具：action=relate 写动态关系（needs-review），action=progress 推进动态字段
   * 并留演变台账。两者都是 agent 写剧情的结构化出口，不是静态设定工具，合并在 jingwei.write 里。
   */
  it("jingwei.write 用 action 区分关系变化与动态字段推进", () => {
    const description = tool("jingwei.write")?.description ?? "";
    expect(description).toContain("action=relate");
    expect(description).toContain("关系变化");
    expect(description).toContain("action=progress");
    expect(description).toContain("演变台账");
    expect(tool("jingwei.write")?.risk).toBe("draft-write");
    expect(tool("jingwei.write")?.visibility).toBe("author");
    expect(tool("jingwei.write")?.runtimeStatus).toBe("ready");
  });

  it("经纬可用性审计折叠进 jingwei.read(scope=audit)，不再单开工具", () => {
    const description = tool("jingwei.read")?.description ?? "";
    expect(description).toContain("scope=audit");
    expect(description).toContain("门禁");
    expect(tool("jingwei.read")?.risk).toBe("read");
    expect(tool("jingwei.read")?.visibility).toBe("author");
  });

  it("叙事记忆是 5 个只读召回 + 审批 + 结算入口", () => {
    const memoryTools = NOVEL_SESSION_TOOL_DEFINITIONS
      .map((definition) => definition.name)
      .filter((name) => name.startsWith("memory."))
      .sort();
    expect(memoryTools).toEqual([
      "memory.events",
      "memory.graph",
      "memory.read",
      "memory.search",
      "memory.settle",
    ]);

    expect(tool("memory.read")?.description).toContain("动态叙事记忆");
    expect(tool("memory.graph")?.description).toContain("relationship");
    expect(tool("memory.events")?.description).toContain("待确认事件");
    expect(tool("memory.search")?.description).toContain("mode=facts");
    // 正文检索是 memory.search 的一个模式，不是独立工具。
    expect(tool("memory.search")?.description).toContain("mode=text");
    expect(tool("memory.settle")?.description).toContain("action=range");

    for (const name of ["memory.read", "memory.search", "memory.graph"]) {
      expect(tool(name)?.risk, name).toBe("read");
    }
    // 审批与结算会改记忆，不能是只读档。
    expect(tool("memory.events")?.risk).toBe("draft-write");
    expect(tool("memory.settle")?.risk).toBe("confirmed-write");
    expect(tool("memory.settle")?.enabledForModes).not.toContain("read");
    expect(tool("memory.settle")?.enabledForModes).not.toContain("plan");
  });

  it("全书概览用 book.overview，不把候选稿说成核心输出", () => {
    const description = tool("book.overview")?.description ?? "";
    expect(description).toContain("正式章节");
    expect(description).not.toContain("候选稿");
    expect(description).not.toContain("candidates");
    expect(tool("book.overview")?.risk).toBe("read");
    // renderer 复用写作台已注册的驾驶舱渲染器。
    expect(tool("book.overview")?.renderer).toBe("cockpit.snapshot");
  });

  it("写章链路固定为 chapter.preflight → chapter.blueprint → 原生 Write → chapter.commit", () => {
    const blueprint = tool("chapter.blueprint")?.description ?? "";
    expect(blueprint).toContain("chapter.preflight");
    expect(blueprint).toContain("jingwei.read");
    expect(blueprint).toContain("memory.read");
    expect(blueprint).toContain("写正文前");

    const commit = tool("chapter.commit")?.description ?? "";
    expect(commit).toContain("chapter.preflight");
    expect(commit).toContain("context-not-ready");
    expect(commit).toContain("memory.settle");
    expect(tool("chapter.preflight")?.risk).toBe("read");
    expect(tool("chapter.commit")?.risk).toBe("confirmed-write");
    expect(tool("chapter.commit")?.enabledForModes).not.toContain("read");
  });

  it("市场调研合并为 market.radar，并且不需要书籍绑定", () => {
    const description = tool("market.radar")?.description ?? "";
    expect(description).toContain("公开榜单");
    expect(description).toContain("经纬");
    expect(description).toContain("历史快照");
    expect(description).toContain("ranks");
    expect(description).toContain("不入库");
    // 采样入口只认番茄公开书籍 ID，且该字段必须写在 schema 里而不是说明里。
    expect((tool("market.radar")?.inputSchema.properties as Record<string, unknown>).fanqieBookId).toBeDefined();
    expect(tool("market.radar")?.risk).toBe("read");
    expect(tool("market.radar")?.scope).toBe("universal");
  });

  it("结算与作废：memory.settle 承担单章与范围，chapter.discard_range 是唯一的破坏性工具", () => {
    const settle = tool("memory.settle")?.description ?? "";
    expect(settle).toContain("chapterNumber");
    expect(settle).toContain("fromChapter");
    expect(tool("chapter.discard_range")?.risk).toBe("destructive");
    expect(tool("chapter.discard_range")?.visibility).toBe("advanced");
    expect(tool("chapter.propose_selection")).toMatchObject({
      risk: "draft-write",
      renderer: "chapter.selection-candidate",
      runtimeStatus: "ready",
    });
    expect(NOVEL_SESSION_TOOL_DEFINITIONS.filter((definition) => definition.risk === "destructive"))
      .toHaveLength(1);
  });

  it("导入与拆书闭环合并为 book.import", () => {
    const description = tool("book.import")?.description ?? "";
    expect(description).toContain("写后续");
    expect(description).toContain("同人");
    expect(description).toContain("改编");
    expect(description).toContain("经纬草稿");
    expect(description).toContain("settle");
    expect(description).toContain("autoSettle");
    expect(tool("book.import")?.risk).toBe("confirmed-write");
  });

  it("卷纲、角色核查与投稿自检各归一个工具", () => {
    expect(tool("outline.volume")?.description).toContain("卷");
    expect(tool("outline.volume")?.risk).toBe("confirmed-write");
    expect(tool("character.inspect")?.description).toContain("弧线");
    expect(tool("character.inspect")?.description).toContain("声线");
    expect(tool("chapter.audit")?.description).toContain("敏感词");
    expect(tool("chapter.audit")?.risk).toBe("read");
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

describe("T-05a 按动作判定风险（jingwei.write 与 memory.events）", () => {
  const RANK: Record<string, number> = { read: 0, "draft-write": 1, "confirmed-write": 2, destructive: 3 };
  const risk = (name: string, input: Record<string, unknown>) => {
    const definition = tool(name);
    if (!definition) throw new Error(`tool ${name} not registered`);
    return definition.resolveRisk?.(input) ?? definition.risk;
  };

  it("jingwei.write 的 retire 与 delete 风险不低于 confirmed-write", () => {
    expect(RANK[risk("jingwei.write", { action: "retire" })]!).toBeGreaterThanOrEqual(RANK["confirmed-write"]!);
    expect(RANK[risk("jingwei.write", { action: "delete" })]!).toBeGreaterThanOrEqual(RANK["confirmed-write"]!);
  });

  it("memory.events 的 approve 与 reject 风险不低于 confirmed-write", () => {
    expect(RANK[risk("memory.events", { action: "approve", eventId: "e1" })]!).toBeGreaterThanOrEqual(RANK["confirmed-write"]!);
    expect(RANK[risk("memory.events", { action: "reject", eventId: "e1" })]!).toBeGreaterThanOrEqual(RANK["confirmed-write"]!);
    expect(RANK[risk("memory.events", { action: "bulk_approve" })]!).toBeGreaterThanOrEqual(RANK["confirmed-write"]!);
  });

  it("只读与非 canon 的新建/更新不被误升到 confirmed-write 或更高", () => {
    expect(RANK[risk("memory.events", { action: "list" })]!).toBeLessThanOrEqual(RANK["draft-write"]!);
    // 普通 dynamic / reference 写入仍是草稿级；canon 才升级（见下方 canon 用例）。
    expect(RANK[risk("jingwei.write", { action: "create", category: "relationships" })]!).toBeLessThanOrEqual(RANK["draft-write"]!);
    expect(RANK[risk("jingwei.write", { action: "update", layer: "dynamic", category: "characters" })]!).toBeLessThanOrEqual(RANK["draft-write"]!);
    expect(RANK[risk("jingwei.write", { action: "create", layer: "reference", category: "characters" })]!).toBeLessThanOrEqual(RANK["draft-write"]!);
    expect(RANK[risk("jingwei.write", { action: "create", category: "自定义分类" })]!).toBeLessThanOrEqual(RANK["draft-write"]!);
    // 关系变化、动态字段推进、修改候选与剧情线草稿都是草稿级。
    expect(risk("jingwei.write", { action: "relate" })).toBe("draft-write");
    expect(risk("jingwei.write", { action: "progress" })).toBe("draft-write");
    expect(risk("jingwei.write", { action: "propose" })).toBe("draft-write");
    expect(risk("jingwei.write", { action: "propose_storyline" })).toBe("draft-write");
    // 拒绝拆书候选不写正式库，仍是草稿级。
    expect(RANK[risk("jingwei.write", { stagingId: "s1", stagingDecision: "reject" })]!).toBeLessThanOrEqual(RANK["draft-write"]!);
  });

  it("jingwei.write 批量 entries[] 里夹带的 delete/retire 不能被顶层草稿级掩盖", () => {
    expect(risk("jingwei.write", { entries: [{ action: "retire", title: "旧设定", reason: "过期" }] })).toBe("confirmed-write");
    expect(risk("jingwei.write", { action: "create", category: "relationships", entries: [
      { action: "create", category: "relationships", title: "A" },
      { action: "delete", title: "B" },
    ] })).toBe("confirmed-write");
    // handler 对每项递归执行，嵌套 entries 同样要扫描。
    expect(risk("jingwei.write", { entries: [{ entries: [{ action: "retire", title: "C" }] }] })).toBe("confirmed-write");
    // 全部是 dynamic 普通写入的批量仍是草稿级（顶层单条字段在批量时被 handler 忽略，不参与判定）。
    expect(risk("jingwei.write", { entries: [
      { action: "create", category: "relationships", title: "A" },
      { action: "update", layer: "dynamic", category: "characters", title: "B" },
    ] })).toBe("draft-write");
  });

  it("jingwei.write 写入或覆盖 canon、晋升拆书候选一律升到 confirmed-write（顶层与 entries[] 都看）", () => {
    expect(risk("jingwei.write", { action: "create", layer: "canon", category: "characters", title: "主角" })).toBe("confirmed-write");
    expect(risk("jingwei.write", { action: "update", layer: "canon", category: "characters", title: "主角" })).toBe("confirmed-write");
    expect(risk("jingwei.write", { action: "update", confirmCanonEdit: true, title: "主角", layer: "dynamic" })).toBe("confirmed-write");
    expect(risk("jingwei.write", { stagingId: "s1", stagingDecision: "promote" })).toBe("confirmed-write");
    // 不显式给 layer 时 handler 按分类默认层落盘：canon 默认分类等同写 canon。
    expect(risk("jingwei.write", { action: "create", category: "characters", title: "主角" })).toBe("confirmed-write");
    expect(risk("jingwei.write", { action: "create", category: "character", title: "主角" })).toBe("confirmed-write");
    // 不给分类时 handler 按标题/正文推断分类，可能落到 canon 分类，按 canon 计。
    expect(risk("jingwei.write", { action: "create", title: "主角", contentMd: "主角设定" })).toBe("confirmed-write");
    expect(risk("jingwei.write", { entries: [{ action: "create", layer: "canon", category: "premise", title: "基线" }] })).toBe("confirmed-write");
    expect(risk("jingwei.write", { entries: [{ action: "update", confirmCanonEdit: true, layer: "dynamic", title: "主角" }] })).toBe("confirmed-write");
    expect(risk("jingwei.write", { entries: [{ stagingId: "s1", stagingDecision: "promote" }] })).toBe("confirmed-write");
  });

  it("memory.events 的批量 events[] 不携带逐条动作，风险只由顶层 action 决定", () => {
    // handler 只认顶层 action；events[] 里写 approve 也只会按 create 建 pending 事件。
    expect(risk("memory.events", { action: "create", events: [{ action: "approve", eventId: "e1" }] })).toBe("draft-write");
    expect(risk("memory.events", { action: "approve", eventId: "e1", events: [] })).toBe("confirmed-write");
  });

  it("outline.volume / character.inspect 与 handler 同样先 trim 并转小写再判定动作", () => {
    // handler 的 parseAction 会把 "SET" / " SYNC " 解析成写动作；风险判定不能按原样比较而降成只读。
    expect(risk("outline.volume", { action: "SET" })).toBe("confirmed-write");
    expect(risk("outline.volume", { action: " Suggest " })).toBe("draft-write");
    expect(risk("outline.volume", { action: "get" })).toBe("read");
    expect(risk("character.inspect", { action: " ARC_SYNC " })).toBe("draft-write");
    expect(risk("character.inspect", { action: "Voice_Draft" })).toBe("draft-write");
    expect(risk("character.inspect", { action: "consistency" })).toBe("read");
    expect(risk("character.inspect", {})).toBe("read");
  });

  it("hooks.manage / style.manage / mechanism.distill / book.import / workflow 按动作分档", () => {
    // 只读动作不得因为工具默认写风险而被拦。
    expect(risk("hooks.manage", { action: "list" })).toBe("read");
    expect(risk("hooks.manage", { action: " CHECK_DUE " })).toBe("read");
    expect(risk("hooks.manage", { action: "plant" })).toBe("confirmed-write");
    expect(risk("style.manage", { action: "status" })).toBe("read");
    expect(risk("style.manage", { action: "start" })).toBe("draft-write");
    expect(risk("style.manage", { action: "adopt" })).toBe("confirmed-write");
    expect(risk("mechanism.distill", { action: "recall" })).toBe("read");
    expect(risk("mechanism.distill", { action: "extract" })).toBe("draft-write");
    expect(risk("mechanism.distill", { action: "delete" })).toBe("confirmed-write");
    expect(risk("book.import", { action: "dissect" })).toBe("read");
    expect(risk("book.import", { action: "dissect", apply: true })).toBe("draft-write");
    expect(risk("book.import", { action: "import_chapters" })).toBe("confirmed-write");
    expect(risk("workflow.step", { action: "current" })).toBe("read");
    expect(risk("workflow.step", { action: "submit" })).toBe("draft-write");
    expect(risk("workflow.manage", { action: "get" })).toBe("read");
    expect(risk("workflow.manage", { action: "edit" })).toBe("draft-write");
  });
});

describe("T-05a 既有行为守护：book.import(action=dissect) 的 resolveRisk 不变", () => {
  it("apply 或 settle 为 draft-write，其余为 read", () => {
    const definition = NOVEL_SESSION_TOOL_DEFINITIONS.find((item) => item.name === "book.import");
    expect(definition?.resolveRisk?.({ action: "dissect", apply: true })).toBe("draft-write");
    expect(definition?.resolveRisk?.({ action: "dissect", settle: true })).toBe("draft-write");
    expect(definition?.resolveRisk?.({ action: "dissect" })).toBe("read");
  });
});

/**
 * 小说工具在 NarraFork「可选工具」里逐个管理：一个工具一个套路，作者可单独设手动 / 自动 / 常驻。
 * Runtime 只认套路的模式、/load 与持久化加载，产品不再自己决定哪些工具常驻。
 */
describe("小说工具套路（一个工具一个）", () => {
  const ready = NOVEL_RUNTIME_TOOL_CATALOG.filter((entry) => entry.runtimeStatus === "ready");
  const routines = listNovelToolRoutines(ready);
  const routineOf = (name: string) => routines.find((routine) => routine.toolNames.includes(name));
  // 与 Runtime product-host/tool-routines.ts 的 PRODUCT_TOOL_ROUTINE_ID 同一规则。
  const RUNTIME_ROUTINE_ID = /^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+$/;

  it("每个贡献给 Runtime 的小说工具恰好属于一个套路，每个套路只含一个工具", () => {
    const all = routines.flatMap((routine) => routine.toolNames);
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual(ready.map((entry) => entry.name).sort());
    expect(routines.every((routine) => routine.toolNames.length === 1)).toBe(true);
    // 档位表与目录一一对应：新增工具必须登记档位，删掉的工具不能留下孤儿档位。
    expect([...NOVEL_TOOL_ROUTINE_TOOL_NAMES].sort()).toEqual(ready.map((entry) => entry.name).sort());
    expect(NOVEL_TOOL_ROUTINES).toHaveLength(ready.length);
  });

  it("套路 id 是 novelfork.<工具名>（下划线换连字符），能通过 Runtime 的 id 校验且互不重复", () => {
    expect(getNovelToolRoutineId("memory.settle")).toBe("novelfork.memory.settle");
    expect(getNovelToolRoutineId("chapter.discard_range")).toBe("novelfork.chapter.discard-range");
    const ids = NOVEL_TOOL_ROUTINES.map((routine) => routine.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const routine of NOVEL_TOOL_ROUTINES) {
      expect(routine.id).toMatch(RUNTIME_ROUTINE_ID);
      expect(routine.id.startsWith("novelfork.")).toBe(true);
      expect(routine.nameZh).toMatch(/^[^·]+·.+$/u);
      expect(routine.nameEn.trim()).not.toBe("");
      expect(routine.descriptionZh.trim()).not.toBe("");
      expect(routine.descriptionEn.trim()).not.toBe("");
    }
    // 不与旧组 id 冲突，迁移前后两套 id 不会互相遮挡。
    for (const legacy of Object.keys(LEGACY_NOVEL_TOOL_ROUTINE_GROUPS)) expect(ids).not.toContain(legacy);
  });

  it("默认档位：24 个高频工具常驻，只有破坏性作废工具默认手动", () => {
    const manual = ready.filter((entry) => entry.risk === "destructive").map((entry) => entry.name);
    // 破坏性工具不能常驻，必须显式开启或 /load 才可用。
    expect(manual).toEqual(["chapter.discard_range"]);
    for (const name of manual) expect(routineOf(name)?.defaultMode, name).toBe("manual");
    for (const entry of ready.filter((tool) => !manual.includes(tool.name))) {
      expect(routineOf(entry.name)?.defaultMode, entry.name).toBe("resident");
    }
  });

  it("套路名带分组前缀，便于在可选工具页成组阅读", () => {
    expect(routineOf("chapter.commit")?.nameZh).toBe("创作·写章入库");
    expect(routineOf("chapter.list")?.nameZh).toBe("章节·章节目录");
    expect(routineOf("jingwei.read")?.nameZh).toBe("经纬·查经纬设定");
    expect(routineOf("memory.settle")?.nameZh).toBe("记忆·章后记忆结算");
    expect(routineOf("market.radar")?.nameZh).toBe("市场·市场榜单雷达");
    expect(routineOf("workflow.step")?.nameZh).toBe("工作流·工作流工序");
  });

  it("旧组成员冻结为旧版分组规则，供档位迁移使用", () => {
    const legacy = LEGACY_NOVEL_TOOL_ROUTINE_GROUPS;
    const all = Object.values(legacy).flat();
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual(ready.map((entry) => entry.name).sort());
    expect(legacy["novelfork.writing"]).toEqual(expect.arrayContaining(["chapter.commit", "workflow.step"]));
    expect(legacy["novelfork.market"]).toEqual(["market.radar"]);
    // 精简后不再有 advanced 的只读工具，旧「记忆检索」组为空。
    expect(legacy["novelfork.memory-inspect"]).toEqual([]);
    expect(legacy["novelfork.maintenance"]).toEqual(["chapter.discard_range"]);
  });
});
