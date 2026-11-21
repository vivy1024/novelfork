import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  closeStorageDatabase,
  initializeStorageDatabase,
  runStorageMigrations,
} from "@vivy1024/novelfork-core";
import type { ToolExecutionContext } from "@vivy1024/novelfork-core/plugins";
import {
  NOVEL_READY_RUNTIME_TOOL_NAMES,
  NOVEL_RUNTIME_TOOL_CATALOG,
} from "./handlers/tool-registry.js";
import { recordWriteRecall } from "./handlers/recall-token.js";
import { createBookRepository } from "./engine/jingwei/repositories/book-repo.js";
import { ensureNarrativeMemorySchema } from "./engine/narrative-memory/storage.js";
import { NOVEL_RUNTIME_CONTRIBUTION } from "./runtime-contribution.js";
import { NOVEL_PLUGIN_MANIFEST } from "./index.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function createBook(
  bookId: string,
  content: string,
  external = false,
): Promise<{ projectRoot: string; bookRoot: string }> {
  const projectRoot = await mkdtemp(join(tmpdir(), "novelfork-runtime-"));
  roots.push(projectRoot);
  const bookRoot = external ? join(projectRoot, "external-workspace") : join(projectRoot, "books", bookId);
  const chapters = join(bookRoot, "chapters");
  const volume = join(chapters, "卷01");
  await mkdir(volume, { recursive: true });
  await writeFile(join(bookRoot, "book.json"), JSON.stringify({
    id: bookId,
    title: `Book ${bookId}`,
    platform: "other",
    genre: "fantasy",
    status: "active",
    targetChapters: 100,
    chapterWordCount: 3000,
    ...(external ? { novelforkExternalWorkspace: true } : {}),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }), "utf8");
  await writeFile(join(volume, "0001-test.md"), content, "utf8");
  await writeFile(join(chapters, "index.json"), JSON.stringify([{
    number: 1,
    title: "第一章",
    fileName: "卷01/0001-test.md",
    wordCount: content.length,
    status: "accepted",
  }]), "utf8");
  return { projectRoot, bookRoot };
}

function context(projectRoot: string, binding?: { bookId: string; root: string }): ToolExecutionContext {
  return {
    runtimeProjectId: "runtime-1",
    projectRoot,
    projectType: "novel",
    enabledPluginIds: ["novelfork-novel"],
    sessionId: "session-1",
    resourceBindings: binding ? { "novel.book": { kind: "novel.book", ...binding } } : {},
  };
}

function tool(name: string) {
  const contribution = NOVEL_RUNTIME_CONTRIBUTION.tools?.find((candidate) => candidate.definition.name === name);
  if (!contribution) throw new Error(`${name} runtime contribution missing`);
  return contribution;
}

/** 单 Agent 契约：工具内部只允许「确定性辅助抽取」调模型，不允许再起创作 Agent 链。 */
const DETERMINISTIC_ASSISTANT_MARKERS = [
  "叙事记忆结算器",
  "角色心理内核分析专家",
  "网文章节摘要器",
  "网文章节张力评分器",
  "状态追踪分析师",
  "事实提取专家",
  "小说内容解构专家",
];

/** 会被记进 generatedSystems 的、属于「内部另起创作 Agent」的系统提示标记。 */
const CREATIVE_AGENT_MARKERS = [
  "章节规划专家",
  "结构化写作蓝图",
  "审稿编辑",
  "修稿编辑",
  "文风分析师",
  "大纲编辑",
  "网文改写编辑",
];

function scenarioGenerator(system: string): string | undefined {
  if (system.includes("叙事记忆结算器")) return JSON.stringify({ events: [], mentionedEntities: [] });
  if (system.includes("章节规划专家") || system.includes("结构化写作蓝图")) {
    return JSON.stringify({
      chapter: 2,
      title: "铃声之后",
      wordTarget: 1200,
      scenes: [{
        characters: ["林舟"],
        location: "山门石阶",
        conflict: "守门人阻止林舟入山",
        mood: "紧张→坚定",
        outcome: "林舟取得试炼资格",
        hooks_used: ["青铜铃"],
        hooks_planted: [],
      }],
      constraints: ["保持第三人称"],
    });
  }
  if (system.includes("文风分析师")) return "# 文风指南\n\n短句推进，动作承载情绪。";
  if (system.includes("大纲编辑")) return JSON.stringify([{ title: "试炼开启", summary: "林舟进入山门试炼。", hooks: ["青铜铃"] }]);
  if (system.includes("审稿编辑") && system.includes("输出格式必须为 JSON")) {
    return JSON.stringify({ passed: true, issues: [], summary: "审计通过" });
  }
  return undefined;
}

const chapterSceneSpec = {
  chapter: 2,
  title: "守卫测试",
  wordTarget: 3000,
  scenes: [{
    characters: ["主角"],
    location: "测试地点",
    conflict: "验证写作守卫",
    mood: "紧张",
    outcome: "拒绝违规正文",
    hooks_used: [],
    hooks_planted: [],
  }],
  constraints: [],
};

function expectModelSchemaIsBounded(schema: unknown): void {
  if (Array.isArray(schema)) {
    schema.forEach(expectModelSchemaIsBounded);
    return;
  }
  if (!schema || typeof schema !== "object") return;
  const record = schema as Record<string, unknown>;
  if (record.type === "object") {
    const properties = record.properties as Record<string, unknown> | undefined;
    // 声明了字段清单的常规对象必须收紧（additionalProperties: false）；
    // 动态 KV 载荷对象（fields / fieldsPatch / payload / node / patch）可显式标 additionalProperties: true
    // 以便同时声明参考字段（避开 Gemini 空 OBJECT 改写）并允许合法自定义键。
    if (properties) {
      expect([false, true]).toContain(record.additionalProperties);
    } else {
      expect(record.additionalProperties).toBeUndefined();
    }
    expect(properties?.bookId).toBeUndefined();
    expect(properties?.sessionId).toBeUndefined();
    expect(properties?.bookRoot).toBeUndefined();
    expect(properties?.skipContextGate).toBeUndefined();
    expect(properties?.writePreflight).toBeUndefined();
    const required = (record.required as readonly string[] | undefined) ?? [];
    expect(required).not.toContain("bookId");
    expect(required).not.toContain("sessionId");
    expect(required).not.toContain("bookRoot");
    expect(required).not.toContain("skipContextGate");
    expect(required).not.toContain("writePreflight");
  }
  Object.values(record).forEach(expectModelSchemaIsBounded);
}

/** 播种一条已应用的近章记忆，让写前硬门「近章记忆为空」放行。 */
function seedAppliedEvent(storage: ReturnType<typeof initializeStorageDatabase>, chapterNumber: number): void {
  storage.sqlite.prepare(`
    INSERT INTO narrative_event (
      id, book_id, chapter_number, event_type, subject, predicate, object,
      evidence_text, confidence, source, status, risk_level, created_at, applied_at
    ) VALUES (?, 'trusted', ?, 'timeline_advanced', '主角', '完成', ?,
      '已有正式进展。', 0.9, 'settle', 'applied', 'low',
      '2026-08-07T00:00:00.000Z', '2026-08-07T00:00:00.000Z')
  `).run(`seed-${chapterNumber}`, chapterNumber, `第${chapterNumber}章`);
}

describe("novel Runtime contribution", () => {
  it("uses the catalog's exact ready tool set", () => {
    expect(NOVEL_READY_RUNTIME_TOOL_NAMES).toHaveLength(25);
    expect(NOVEL_RUNTIME_TOOL_CATALOG).toHaveLength(NOVEL_READY_RUNTIME_TOOL_NAMES.length);
    // 25 个核心工具：8 写章与章节 + 4 经纬与大纲 + 5 叙事记忆 + 8 专项与工作流。
    expect(NOVEL_READY_RUNTIME_TOOL_NAMES).toEqual(expect.arrayContaining([
      "book.overview",
      "chapter.preflight",
      "chapter.blueprint",
      "chapter.commit",
      "chapter.list",
      "chapter.audit",
      "chapter.propose_selection",
      "chapter.discard_range",
      "jingwei.read",
      "jingwei.write",
      "hooks.manage",
      "outline.volume",
      "memory.read",
      "memory.search",
      "memory.graph",
      "memory.events",
      "memory.settle",
      "character.inspect",
      "style.manage",
      "mechanism.distill",
      "book.import",
      "market.radar",
      "skills.manage",
      "workflow.step",
      "workflow.manage",
    ]));
    // 合并前的旧入口不得残留：留着就是第二条绕过门禁的路径。
    expect(NOVEL_READY_RUNTIME_TOOL_NAMES).not.toEqual(expect.arrayContaining([
      "cockpit.snapshot",
      "write.preflight",
      "scene.spec",
      "pipeline.write",
      "chapter.read",
      "chapter.write",
      "lore.read",
      "lore.write",
      "jingwei.audit",
      "memory.search_text",
      "memory.list",
      "memory.settle_chapter",
      "memory.settle_range",
      "arc.character",
      "character.check_consistency",
      "publish.check",
      "resource.manage",
      "presets.read",
      "presets.write",
      "beat.read",
      "beat.write",
    ]));
    const readyNames = [...NOVEL_READY_RUNTIME_TOOL_NAMES].sort();
    expect(NOVEL_RUNTIME_TOOL_CATALOG.filter((entry) => entry.runtimeStatus === "ready").map((entry) => entry.name).sort())
      .toEqual(readyNames);
    expect(NOVEL_RUNTIME_CONTRIBUTION.tools?.map((entry) => entry.definition.name).sort())
      .toEqual(readyNames);
    expect(NOVEL_RUNTIME_TOOL_CATALOG.filter((entry) => entry.runtimeStatus !== "ready")).toHaveLength(0);
  });

  it("publishes only the Writing Skills Runtime contract", () => {
    const definitions = new Map((NOVEL_RUNTIME_CONTRIBUTION.tools ?? []).map((entry) => [entry.definition.name, entry.definition]));
    const skillToolNames = [...definitions.keys()].filter((name) => name.startsWith("skills.")).sort();

    // 推荐与合规检查合并为一个只读入口。
    expect(skillToolNames).toEqual(["skills.manage"]);
    // 旧 Preset / Beat 入口已下线：Writing Skills 物化到 .novelfork/skills/，由 Runtime 的 Skill 机制交给 agent。
    expect(definitions.has("presets.read")).toBe(false);
    expect(definitions.has("presets.write")).toBe(false);
    expect(definitions.has("presets.check_compliance")).toBe(false);
    expect(definitions.has("skills.recommend")).toBe(false);
    expect(definitions.has("skills.check_compliance")).toBe(false);
    expect(definitions.has("skills.import_legacy")).toBe(false);

    const skills = definitions.get("skills.manage")!;
    const schema = skills.inputSchema as Record<string, unknown>;
    const properties = schema.properties as Record<string, unknown>;
    // 只读建议：两个动作都不写账。
    expect(skills.risk).toBe("read");
    expect(properties.action).toBeDefined();
    expect(properties.maxCount).toBeDefined();
    expect(properties.content).toBeDefined();
    expect(schema.required).toEqual(["action"]);
    expect(skills.scope).toBe("novel");
    const catalogEntry = NOVEL_RUNTIME_TOOL_CATALOG.find((entry) => entry.name === "skills.manage");
    expect(catalogEntry?.renderer).toBe("writing-skills.compliance");
  });

  it("contributes the authoritative NovelFork writing workflow prompt", () => {
    const prompt = NOVEL_RUNTIME_CONTRIBUTION.promptExtensions?.[0]?.content ?? "";
    expect(prompt).toContain("NovelFork 小说创作运行时");
    expect(prompt).toContain("可信的 novel.book 资源绑定");
    // 写章链路：预检 → 蓝图 → 原生 Write → 入库。
    expect(prompt).toContain("chapter.preflight");
    expect(prompt).toContain("chapter.blueprint");
    expect(prompt).toContain("chapter.commit");
    expect(prompt).toContain("targetChapterPath");
    expect(prompt).toContain("禁止用写作理论");
    expect(prompt).toContain("用与作者相同的语言回复；书的语言为中文时一律用中文");
    // 提示里只能点名真实存在的工具，否则模型会照着调一个不存在的工具。
    for (const retired of ["write.preflight", "pipeline.write", "scene.spec", "chapter.write", "memory.settle_range"]) {
      expect(prompt, `系统提示仍点名已下线工具 ${retired}`).not.toContain(retired);
    }
  });

  it("contributes the generated NovelFork learning catalog without empty metadata", () => {
    const learning = NOVEL_RUNTIME_CONTRIBUTION.learning;
    const docs = learning?.docs ?? [];
    const documentIds = docs.map((doc) => doc.id);

    // 两条线：「用 NovelFork 写书」按作者任务讲功能，「网文写作课」讲写作本身。
    expect(learning?.categories.map((category) => category.id)).toEqual([
      "novelfork-book",
      "novelfork-craft",
    ]);
    expect(documentIds).toEqual(expect.arrayContaining([
      "book-first-run",
      "book-new-book",
      "book-write-next-chapter",
      "book-revise",
      "book-style-preset",
      "book-character-voice",
      "book-style-vault",
      "book-foreshadow-memory",
      "book-relations",
      "book-workflow",
      "book-export-archive",
      "craft-opening",
      "craft-de-ai",
      "craft-revision",
    ]));
    expect(new Set(documentIds).size).toBe(documentIds.length);
    // 与 Runtime 自带文档（overview、skills……）重名的贡献会被静默丢弃，所以 id 一律带线前缀。
    expect(docs.every((doc) => /^(book|craft)-/u.test(doc.id))).toBe(true);
    expect(docs.every((doc) => doc.category === (doc.id.startsWith("book-") ? "novelfork-book" : "novelfork-craft"))).toBe(true);
    expect(docs.every((doc) => doc.title["zh-CN"].trim() && doc.summary["zh-CN"].trim() && doc.sections.length > 0)).toBe(true);

    const actions = docs.flatMap((doc) => doc.actions);
    expect(actions.every((action) => action.href.startsWith("/next") && !/\/:[A-Za-z]/u.test(action.href))).toBe(true);
    expect(actions.every((action) => action.label["zh-CN"].trim().length > 0)).toBe(true);
    const learnTargets = actions
      .map((action) => /^\/next\/learn\?doc=([^&#]+)/u.exec(action.href)?.[1])
      .filter((id): id is string => Boolean(id));
    expect(learnTargets.length).toBeGreaterThan(0);
    expect(learnTargets.filter((id) => !documentIds.includes(id))).toEqual([]);

    // 学习中心把正文当纯文本显示：生成物里不应残留 Markdown 标记。
    const bodies = docs.flatMap((doc) => doc.sections.map((section) => section.body["zh-CN"]));
    expect(bodies.some((body) => /\*\*|`|^\|/mu.test(body))).toBe(false);
    expect(docs.find((doc) => doc.id === "book-start-here")?.sections
      .some((section) => section.body["zh-CN"].includes("章后结算"))).toBe(true);
  });

  it("registers market tools without requiring a book binding", () => {
    const names = (NOVEL_RUNTIME_CONTRIBUTION.tools ?? []).map((entry) => entry.definition.name);
    expect(names).toContain("market.radar");
    for (const retired of ["market.scan", "market.query", "market.ranks", "market.sample_public_chapters"]) {
      expect(names).not.toContain(retired);
    }
    const schema = tool("market.radar").definition.inputSchema as Record<string, unknown>;
    const properties = schema.properties as Record<string, unknown>;
    // 采样番茄公开书籍靠 fanqieBookId，而不是当前作品的 bookId。
    expect(properties.fanqieBookId).toBeDefined();
    expect(properties.bookId).toBeUndefined();
    expect(tool("market.radar").definition.scope).toBe("universal");
  });

  it("does not expose host-controlled fields in any model schema", () => {
    for (const contribution of NOVEL_RUNTIME_CONTRIBUTION.tools ?? []) {
      expectModelSchemaIsBounded(contribution.definition.inputSchema);
      if (contribution.definition.validationInputSchema) {
        expectModelSchemaIsBounded(contribution.definition.validationInputSchema);
      }
    }
  });

  it("精简的模型 schema 只去掉展示，完整校验 schema 随贡献一起交给宿主", () => {
    const definitions = new Map((NOVEL_RUNTIME_CONTRIBUTION.tools ?? []).map((entry) => [entry.definition.name, entry.definition]));
    const trimmed = [...definitions.values()].filter((definition) => definition.validationInputSchema).map((definition) => definition.name);
    expect(trimmed.sort()).toEqual(["chapter.audit", "chapter.commit", "chapter.preflight"]);
    for (const name of trimmed) {
      const definition = definitions.get(name)!;
      const model = definition.inputSchema.properties as Record<string, Record<string, unknown>>;
      const full = definition.validationInputSchema!.properties as Record<string, Record<string, unknown>>;
      // 校验用的完整 schema 保留蓝图结构；字段集合只多不少。
      expect(full.sceneSpec?.properties).toBeDefined();
      expect(model.sceneSpec?.properties).toBeUndefined();
      expect(Object.keys(model).every((key) => key in full)).toBe(true);
      expect(definition.inputSchema.required).toEqual(definition.validationInputSchema!.required);
    }
    // sceneSpec 完整子结构只在 chapter.blueprint 里展开一次（它是蓝图的唯一权威入口）。
    expect(definitions.get("chapter.blueprint")!.validationInputSchema).toBeUndefined();
    expect((definitions.get("chapter.blueprint")!.inputSchema.properties as Record<string, Record<string, unknown>>)
      .sceneSpec?.properties).toBeDefined();
  });

  it("publishes stable NUG-compatible NovelFork tool schemas", () => {
    const definitions = new Map((NOVEL_RUNTIME_CONTRIBUTION.tools ?? []).map((entry) => [entry.definition.name, entry.definition]));

    // 数组字段必须声明 items 类型，否则宿主 schema 校验会退化成 any。
    const jingweiWriteSchema = definitions.get("jingwei.write")?.inputSchema as Record<string, unknown>;
    const jingweiWriteProperties = jingweiWriteSchema.properties as Record<string, Record<string, unknown>>;
    for (const field of ["aliases", "tags", "relatedEntryIds"]) {
      expect(jingweiWriteProperties[field]?.items).toMatchObject({ type: "string" });
    }

    // 自由 KV 载荷对象（fields / fieldsPatch）补齐了常见参考字段避免触发网关空 OBJECT 改写，
    // 同时显式保留 additionalProperties: true 允许写入任意自定义字段。
    for (const field of ["fields", "fieldsPatch"]) {
      expect(jingweiWriteProperties[field]?.type).toBe("object");
      expect(jingweiWriteProperties[field]?.properties).toBeDefined();
      expect(jingweiWriteProperties[field]?.additionalProperties).toBe(true);
    }
    const preflightSchema = definitions.get("chapter.preflight")?.inputSchema as Record<string, unknown>;
    const preflightProperties = preflightSchema.properties as Record<string, Record<string, unknown>>;
    expect(preflightProperties.writePreflight).toBeUndefined();
    expect(preflightProperties.skipContextGate).toBeUndefined();

    // 结构明确的嵌套对象（endgameReserve / filter / entries[] / events[] / chapters[] / ops[]）均声明具体子字段。
    const outlineProperties = (definitions.get("outline.volume")!.inputSchema.properties) as Record<string, Record<string, unknown>>;
    expect(outlineProperties.endgameReserve?.type).toBe("object");
    expect(outlineProperties.endgameReserve?.properties).toMatchObject({
      trumpCards: expect.objectContaining({ type: "array" }),
      ladders: expect.objectContaining({ type: "array" }),
    });

    const eventsProperties = (definitions.get("memory.events")!.inputSchema.properties) as Record<string, Record<string, unknown>>;
    expect(eventsProperties.filter?.type).toBe("object");
    expect(eventsProperties.filter?.properties).toBeDefined();
    expect((eventsProperties.events?.items as Record<string, unknown> | undefined)?.properties).toBeDefined();

    // 确认所有 25 个小说工具暴露给模型的 schema 中都不再存在空 properties 的 OBJECT（避免 Gemini 网关改写为必填 reason）。
    const findEmptyObjectPaths = (node: unknown, path: string): string[] => {
      if (!node || typeof node !== "object") return [];
      if (Array.isArray(node)) return node.flatMap((item, idx) => findEmptyObjectPaths(item, `${path}[${idx}]`));
      const obj = node as Record<string, unknown>;
      const issues: string[] = [];
      if (obj.type === "object") {
        const props = obj.properties && typeof obj.properties === "object" && !Array.isArray(obj.properties)
          ? Object.keys(obj.properties as Record<string, unknown>)
          : [];
        if (props.length === 0) issues.push(path);
      }
      if (obj.properties && typeof obj.properties === "object" && !Array.isArray(obj.properties)) {
        for (const [k, v] of Object.entries(obj.properties as Record<string, unknown>)) {
          issues.push(...findEmptyObjectPaths(v, `${path}.${k}`));
        }
      }
      if (obj.items) {
        issues.push(...findEmptyObjectPaths(obj.items, `${path}[]`));
      }
      return issues;
    };
    const emptyObjectPaths: string[] = [];
    for (const [name, def] of definitions) {
      emptyObjectPaths.push(...findEmptyObjectPaths(def.inputSchema, name));
    }
    expect(emptyObjectPaths).toEqual([]);
  });

  it("injects the trusted binding bookId instead of accepting a model bookId", async () => {
    const trusted = await createBook("trusted", "trusted content");
    const result = await tool("chapter.list").handler(
      { chapterNumber: 1 },
      context(trusted.projectRoot, { bookId: "trusted", root: trusted.bookRoot }),
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      bookId: "trusted",
      chapters: [expect.objectContaining({ number: 1, title: "第一章", path: "chapters/卷01/0001-test.md" })],
    });
  });

  it("writes only a book-compliant complete chapter in the trusted binding", async () => {
    const trusted = await createBook("trusted", "旧正文");
    const storage = initializeStorageDatabase({ databasePath: join(trusted.projectRoot, "novelfork.db") });
    runStorageMigrations(storage);
    ensureNarrativeMemorySchema(storage);
    seedAppliedEvent(storage, 1);
    const content = "新的正文。".repeat(600);
    try {
      recordWriteRecall({ sessionId: "session-1", bookId: "trusted", chapterNumber: 1, packageFingerprint: "test" });
      const result = await tool("chapter.commit").handler(
        { chapterNumber: 1, content, sceneSpec: { ...chapterSceneSpec, chapter: 1 } },
        context(trusted.projectRoot, { bookId: "trusted", root: trusted.bookRoot }),
      );

      expect(result.data).toMatchObject({ saved: true, chapterNumber: 1, wordCount: 3000 });
      // 入库会按蓝图标题重命名正式章文件：以返回的 path 为准，不写死文件名。
      const savedPath = (result.data as { path?: string } | undefined)?.path ?? "";
      expect(savedPath).toContain("0001");
      expect(await readFile(join(trusted.bookRoot, savedPath), "utf8")).toBe(content);
      expect(JSON.parse(await readFile(join(trusted.bookRoot, "chapters", "index.json"), "utf8"))).toMatchObject([
        { number: 1, wordCount: 3000 },
      ]);
    } finally {
      closeStorageDatabase();
    }
  });

  it("rejects a short direct chapter.commit without changing the trusted chapter", async () => {
    const trusted = await createBook("trusted", "原始正文");
    const storage = initializeStorageDatabase({ databasePath: join(trusted.projectRoot, "novelfork.db") });
    runStorageMigrations(storage);
    ensureNarrativeMemorySchema(storage);
    seedAppliedEvent(storage, 1);
    try {
      recordWriteRecall({ sessionId: "session-1", bookId: "trusted", chapterNumber: 1, packageFingerprint: "test" });
      const result = await tool("chapter.commit").handler(
        { chapterNumber: 1, content: "过短正文", sceneSpec: { ...chapterSceneSpec, chapter: 1 } },
        context(trusted.projectRoot, { bookId: "trusted", root: trusted.bookRoot }),
      );

      // 字数硬门先于落盘：正文与章节索引一个字节都没动。
      expect(result).toMatchObject({ ok: false, error: "length-out-of-range" });
      expect(await readFile(join(trusted.bookRoot, "chapters", "卷01", "0001-test.md"), "utf8")).toBe("原始正文");
      // 拒存不产生章后结算事件。
      expect(storage.sqlite.prepare(
        "SELECT COUNT(*) AS count FROM narrative_event WHERE book_id = ? AND chapter_number = ?",
      ).get("trusted", 1)).toEqual({ count: 1 });
    } finally {
      closeStorageDatabase();
    }
  });

  it("reads the trusted chapter index and builds bound narrative artifacts", async () => {
    const trusted = await createBook("trusted", "trusted content");
    const storage = initializeStorageDatabase({ databasePath: join(trusted.projectRoot, "novelfork.db") });
    runStorageMigrations(storage);
    ensureNarrativeMemorySchema(storage);
    const trustedContext = context(trusted.projectRoot, { bookId: "trusted", root: trusted.bookRoot });

    try {
      const overview = await tool("book.overview").handler({}, trustedContext);
      expect(overview).toMatchObject({
        ok: true,
        data: { status: "available", book: { id: "trusted" }, storyDir: "story" },
      });
      // 全书概览只回相对路径，宿主目录不得泄漏给模型。
      expect(JSON.stringify(overview)).not.toContain(trusted.projectRoot);

      const chapterList = await tool("chapter.list").handler({}, trustedContext);
      expect(chapterList).toMatchObject({
        ok: true,
        data: { bookId: "trusted", chapters: [{ number: 1, title: "第一章" }] },
      });

      const recall = await tool("memory.read").handler({ purpose: "write" }, trustedContext);
      expect(recall).toMatchObject({ ok: true });
      expect(JSON.stringify(recall)).not.toContain(trusted.projectRoot);

      const graph = await tool("memory.graph").handler({ view: "relationship" }, trustedContext);
      expect(graph).toMatchObject({ ok: true, data: { view: "relationship" } });
    } finally {
      closeStorageDatabase();
    }
  });

  it("creates Narrative Memory events only under the trusted book binding", async () => {
    const trusted = await createBook("trusted", "trusted content");
    const storage = initializeStorageDatabase({ databasePath: join(trusted.projectRoot, "novelfork.db") });
    runStorageMigrations(storage);
    ensureNarrativeMemorySchema(storage);
    try {
      const chapters = await tool("chapter.list").handler(
        {},
        context(trusted.projectRoot, { bookId: "trusted", root: trusted.bookRoot }),
      );
      expect(chapters).toMatchObject({ ok: true, data: { bookId: "trusted" } });

      const result = await tool("memory.events").handler(
        {
          action: "create",
          chapterNumber: 1,
          eventType: "world_fact_introduced",
          subject: "青铜铃",
          predicate: "位于",
          object: "山门",
          evidenceText: "青铜铃悬在山门上。",
        },
        context(trusted.projectRoot, { bookId: "trusted", root: trusted.bookRoot }),
      );

      expect(result).toMatchObject({ ok: true, data: { event: { bookId: "trusted", status: "pending" } } });
      expect(storage.sqlite.prepare("SELECT DISTINCT book_id AS bookId FROM narrative_event").all())
        .toEqual([{ bookId: "trusted" }]);
    } finally {
      closeStorageDatabase();
    }
  });

  it("只按作者的裁决推进事件状态，pending 不等于已确认记忆", async () => {
    const trusted = await createBook("trusted", "trusted content");
    const storage = initializeStorageDatabase({ databasePath: join(trusted.projectRoot, "novelfork.db") });
    runStorageMigrations(storage);
    ensureNarrativeMemorySchema(storage);
    const trustedContext = context(trusted.projectRoot, { bookId: "trusted", root: trusted.bookRoot });
    try {
      const created = await tool("memory.events").handler(
        {
          action: "create",
          chapterNumber: 1,
          eventType: "hook_planted",
          subject: "青铜铃",
          predicate: "指向",
          object: "真正的主人",
          evidenceText: "青铜铃响了一声。",
        },
        trustedContext,
      ) as { ok: boolean; data?: { event?: { id?: string; status?: string } } };
      expect(created.ok).toBe(true);
      // 作者手建的事件一律待确认：风险分级不等于作者已裁决。
      expect(created.data?.event?.status).toBe("pending");
      const eventId = created.data?.event?.id;
      expect(typeof eventId).toBe("string");

      const approved = await tool("memory.events").handler(
        { action: "approve", eventId, reason: "已确认正文发生" },
        trustedContext,
      );
      expect(approved).toMatchObject({ ok: true });
      expect(storage.sqlite.prepare("SELECT status FROM narrative_event WHERE id = ?").get(eventId!))
        .toEqual({ status: "applied" });
    } finally {
      closeStorageDatabase();
    }
  });

  it("publishes bounded import input and confirmation risks", () => {
    const definitions = new Map((NOVEL_RUNTIME_CONTRIBUTION.tools ?? []).map((entry) => [entry.definition.name, entry.definition]));
    const importSchema = definitions.get("book.import")?.inputSchema as Record<string, unknown>;
    const importProperties = importSchema.properties as Record<string, unknown>;

    expect(importProperties.content).toBeDefined();
    expect(importProperties.filePath).toBeDefined();
    expect(importProperties.action).toBeDefined();
    // bookId 由宿主注入，required 里只剩模型真正要给的 action。
    expect(importSchema.required).toEqual(["action"]);

    for (const name of ["chapter.commit", "hooks.manage", "book.import", "memory.settle", "chapter.discard_range"]) {
      const risk = definitions.get(name)?.risk;
      expect(
        risk === "confirmed-write" || risk === "destructive",
        `${name} 应当需要确认（实际 ${String(risk)}）`,
      ).toBe(true);
    }
    // 去 AI 味冗余入口已下线：统一由 Writer 写作纪律 + story-deslop Writing Skill 承担。
    expect(definitions.has("pipeline.revise")).toBe(false);
    expect(definitions.has("rewrite.apply")).toBe(false);
    expect(definitions.has("rewrite.segment")).toBe(false);
  });

  it("executes every migrated domain tool against the trusted book and current host model", async () => {
    const trusted = await createBook("trusted", "林舟走进山门。\n值得注意的是，青铜铃缓缓摇动。\n守门人抬起头。", true);
    await mkdir(join(trusted.bookRoot, "jingwei", "角色"), { recursive: true });
    await writeFile(join(trusted.bookRoot, "jingwei", "角色", "林舟.md"), "# 林舟\n谨慎的少年。", "utf8");
    const storage = initializeStorageDatabase({ databasePath: join(trusted.projectRoot, "novelfork.db") });
    runStorageMigrations(storage);
    ensureNarrativeMemorySchema(storage);
    const now = new Date("2026-08-07T00:00:00.000Z");
    await createBookRepository(storage).create({
      id: "trusted",
      name: "Book trusted",
      jingweiMode: "dynamic",
      currentChapter: 1,
      createdAt: now,
      updatedAt: now,
    });
    const generatedSystems: string[] = [];
    const outputs: string[] = [];
    const generateText: NonNullable<ToolExecutionContext["generateText"]> = async (request) => {
      const system = request.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n");
      generatedSystems.push(system);
      return { text: scenarioGenerator(system) ?? "" };
    };
    const trustedContext: ToolExecutionContext = {
      ...context(trusted.projectRoot, { bookId: "trusted", root: trusted.bookRoot }),
      model: { provider: "test-provider", id: "test-current-model" },
      generateText,
      emitOutput: (output) => outputs.push(output),
    };

    try {
      expect(await tool("chapter.audit").handler({ chapterNumber: 1 }, trustedContext)).toMatchObject({ ok: true });

      // 旧书导入：切章写入正文与索引，卷标题落成卷纲。
      const importedText = `第1章 旧城\n${"旧城风雨。".repeat(120)}\n第2章 山门\n${"山门钟鸣。".repeat(120)}`;
      expect(await tool("book.import").handler(
        { action: "import_chapters", content: importedText, sourceName: "显式文本" },
        trustedContext,
      )).toMatchObject({ ok: true, data: { bookId: "trusted", importedChapters: 2, firstChapter: 2 } });
      await expect(readFile(join(trusted.bookRoot, "chapters", "卷01", "0002_旧城.md"), "utf8"))
        .resolves.toContain("旧城风雨");
      expect(JSON.parse(await readFile(join(trusted.bookRoot, "chapters", "index.json"), "utf8")))
        .toEqual(expect.arrayContaining([
          expect.objectContaining({ number: 2, fileName: "卷01/0002_旧城.md" }),
          expect.objectContaining({ number: 3, fileName: "卷01/0003_山门.md" }),
        ]));

      // 角色一致性核查：按角色名在章号范围内的出场语境。
      expect(await tool("character.inspect").handler(
        { action: "consistency", characterName: "林舟", chapterRange: { from: 1, to: 3 } },
        trustedContext,
      )).toMatchObject({ ok: true, data: { characters: [{ name: "林舟" }] } });

      // 伏笔：plant 后 list 能读到，且标记为未兑现。
      expect(await tool("hooks.manage").handler(
        { action: "plant", chapterNumber: 1, description: "青铜铃真正的主人" },
        trustedContext,
      )).toMatchObject({ ok: true, data: { action: "plant" } });
      expect(await tool("hooks.manage").handler({ action: "list" }, trustedContext)).toMatchObject({
        ok: true,
        data: { hooks: [{ done: false, text: expect.stringContaining("青铜铃真正的主人") }] },
      });

      // 写前预检：近章记忆为空时停写，补齐后才放行并给出召回包与目标路径。
      const blockedPreflight = await tool("chapter.preflight").handler(
        { chapterNumber: 4, userDirectives: "让林舟进入山门试炼，先过守门人这一关。" },
        trustedContext,
      );
      expect(blockedPreflight.ok).toBe(false);
      expect(blockedPreflight.error).toBe("context-not-ready");

      const settled = await tool("memory.settle").handler({ fromChapter: 1, toChapter: 3 }, trustedContext);
      expect(settled.ok).toBe(true);
      expect((settled.data as { chaptersSettled?: number } | undefined)?.chaptersSettled).toBeGreaterThan(0);

      const eventCount = storage.sqlite.prepare(
        "SELECT COUNT(*) AS c FROM narrative_event WHERE book_id = ? AND status = 'applied'",
      ).get("trusted") as { c: number };
      if (eventCount.c === 0) {
        storage.sqlite.prepare(`
          INSERT INTO narrative_event (
            id, book_id, chapter_number, event_type, subject, predicate, object,
            evidence_text, confidence, source, status, risk_level, created_at, applied_at
          ) VALUES (
            'seed-event-1', 'trusted', 3, 'timeline_advanced', '林舟', '抵达', '山门',
            '林舟抵达山门。', 0.9, 'settle', 'applied', 'low',
            '2026-07-24T00:00:00.000Z', '2026-07-24T00:00:00.000Z'
          )
        `).run();
      }

      const readyPreflight = await tool("chapter.preflight").handler(
        { chapterNumber: 4, userDirectives: "让林舟进入山门试炼，先过守门人这一关。" },
        trustedContext,
      );
      expect(readyPreflight).toMatchObject({ ok: true });
      const preflightData = readyPreflight.data as {
        recall?: { text?: string; recallToken?: unknown };
        targetChapterPath?: string;
      } | undefined;
      // 召回凭证是服务端自记自验的，不出现在工具结果里。
      expect(preflightData?.recall).not.toHaveProperty("recallToken");
      expect(preflightData?.recall?.text).toContain("第 4 章写前召回包");
      expect(preflightData?.targetChapterPath).toContain("0004");

      const submittedSpec = { ...chapterSceneSpec, chapter: 4, title: "铃声之后" };
      expect(await tool("chapter.blueprint").handler(
        {
          chapterNumber: 4,
          userDirectives: "让林舟进入山门试炼，先过守门人这一关。",
          sceneSpec: submittedSpec,
        },
        trustedContext,
      )).toMatchObject({ ok: true, data: { sceneSpec: { title: "铃声之后" } } });

      const chapterText = "林舟沿石阶向上，青铜铃在风里发出清响。".repeat(150);
      const committed = await tool("chapter.commit").handler(
        { chapterNumber: 4, sceneSpec: submittedSpec, content: chapterText },
        trustedContext,
      );
      expect(committed.data).toMatchObject({ chapterNumber: 4 });
      expect((committed.data as { wordCount?: number } | undefined)?.wordCount).toBeGreaterThanOrEqual(2182);
      // 正文确实落到了预检给出的目标路径。
      expect(await readFile(join(trusted.bookRoot, "chapters", "卷01", "0004_铃声之后.md"), "utf8")).toContain("青铜铃在风里发出清响");

      // 单一 Agent 契约：工具内部不得再起 Writer/Auditor/Reviser 这类创作 Agent 链。
      // 章后结算的叙事记忆抽取/内核重算/摘要这类确定性辅助调用使用当前会话模型（context.generateText），
      // 产出的只是辅助数据，创作决策不经它手。
      expect(generatedSystems.filter((system) =>
        !DETERMINISTIC_ASSISTANT_MARKERS.some((marker) => system.includes(marker)),
      )).toHaveLength(0);
      expect(generatedSystems.some((system) =>
        CREATIVE_AGENT_MARKERS.some((marker) => system.includes(marker)),
      )).toBe(false);
      expect(outputs).not.toEqual(expect.arrayContaining([
        expect.stringContaining("内部模型调用"),
      ]));
      expect(JSON.stringify({ generatedSystems, outputs })).not.toContain("apiKey");
    } finally {
      closeStorageDatabase();
    }
  });

  it("rejects forged host-controlled fields including skipContextGate and writePreflight", async () => {
    const trusted = await createBook("trusted", "trusted content");
    const trustedContext = context(trusted.projectRoot, { bookId: "trusted", root: trusted.bookRoot });

    expect(await tool("chapter.commit").handler(
      { chapterNumber: 2, sceneSpec: { ...chapterSceneSpec, chapter: 2 }, skipContextGate: true },
      trustedContext,
    )).toMatchObject({ ok: false, error: "forged-host-field" });

    expect(await tool("chapter.blueprint").handler(
      { chapterNumber: 1, userDirectives: "测试指示", sceneSpec: chapterSceneSpec, writePreflight: { ok: true } },
      trustedContext,
    )).toMatchObject({ ok: false, error: "forged-host-field" });
  });

  it("rejects a forged model bookId instead of crossing books", async () => {
    const trusted = await createBook("trusted", "trusted content");
    const result = await tool("chapter.list").handler(
      { bookId: "other" },
      context(trusted.projectRoot, { bookId: "trusted", root: trusted.bookRoot }),
    );

    expect(result).toMatchObject({ ok: false, error: "forged-host-field" });
    expect(JSON.stringify(result)).not.toContain("trusted content");
  });

  it("fails closed without a trusted binding", async () => {
    const trusted = await createBook("trusted", "trusted content");
    const result = await tool("chapter.list").handler({}, context(trusted.projectRoot));

    expect(result).toMatchObject({ ok: false, error: "missing-resource-binding" });
  });

  it("writes a new chapter and reads it back through chapter.list and chapter.audit", async () => {
    const trusted = await createBook("trusted", "旧正文。".repeat(1500));
    const storage = initializeStorageDatabase({ databasePath: join(trusted.projectRoot, "novelfork.db") });
    runStorageMigrations(storage);
    ensureNarrativeMemorySchema(storage);
    seedAppliedEvent(storage, 1);
    const content = "新章节正文。".repeat(500);
    const trustedContext: ToolExecutionContext = {
      ...context(trusted.projectRoot, { bookId: "trusted", root: trusted.bookRoot }),
      // 章后结算需要 Runtime 会话提供事件抽取器；这里模拟已配置模型，
      // 让本测试关注章节写入/读回而不是缺失模型分支。
      generateText: async (request) => {
        const system = request.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n");
        return { text: scenarioGenerator(system) ?? "" };
      },
    };
    try {
      recordWriteRecall({ sessionId: "session-1", bookId: "trusted", chapterNumber: 2, packageFingerprint: "test" });
      const written = await tool("chapter.commit").handler({
        chapterNumber: 2,
        sceneSpec: { ...chapterSceneSpec, chapter: 2 },
        content,
      }, trustedContext);
      expect(written.data).toMatchObject({ chapterNumber: 2 });

      const listed = await tool("chapter.list").handler({}, trustedContext);
      expect(listed).toMatchObject({ ok: true });
      expect((listed.data as { chapters?: Array<{ number?: number; wordCount?: number }> }).chapters)
        .toEqual(expect.arrayContaining([expect.objectContaining({ number: 2, wordCount: content.length })]));

      // 读回正文只走原生 Read：工具只负责审计与索引，不再提供 chapter.read。
      expect(await readFile(join(trusted.bookRoot, "chapters", "卷01", "0002_守卫测试.md"), "utf8")).toBe(content);
      const audit = await tool("chapter.audit").handler({ chapterNumber: 2 }, trustedContext);
      expect(audit).toMatchObject({ ok: true, data: { passed: true, wordCount: content.length } });
    } finally {
      closeStorageDatabase();
    }
  });

  it("does not follow a legacy external root redirect for a trusted binding", async () => {
    const trusted = await createBook("trusted", "trusted content");
    const storage = initializeStorageDatabase({ databasePath: join(trusted.projectRoot, "novelfork.db") });
    runStorageMigrations(storage);
    ensureNarrativeMemorySchema(storage);
    const escapedRoot = join(trusted.projectRoot, "escaped-book");
    await mkdir(join(escapedRoot, "chapters"), { recursive: true });
    await writeFile(join(escapedRoot, "chapters", "0001-escaped.md"), "escaped content", "utf8");
    await writeFile(
      join(trusted.bookRoot, ".novelfork-project-init.json"),
      JSON.stringify({ repositoryPath: escapedRoot }),
      "utf8",
    );

    try {
      const result = await tool("memory.search").handler(
        { mode: "text", query: "trusted" },
        context(trusted.projectRoot, { bookId: "trusted", root: trusted.bookRoot }),
      );

      expect(result.ok).toBe(true);
      expect(JSON.stringify(result)).not.toContain("escaped content");
      expect((result.data as { hits?: Array<{ chapterNumber?: number }> } | undefined)?.hits)
        .toEqual(expect.arrayContaining([expect.objectContaining({ chapterNumber: 1 })]));
    } finally {
      closeStorageDatabase();
    }
  });
});

describe("工具启用交给 NarraFork 套路体系", () => {
  // Runtime 从不消费 agentPresets；书籍叙述者的默认工具由「可选工具」套路决定（见 NOVEL_TOOL_ROUTINES）。
  // 这里守住不再长出第二套「预设工具集」。
  it("Runtime 贡献与插件清单都不再声明 agentPresets", () => {
    expect(NOVEL_RUNTIME_CONTRIBUTION.agentPresets).toBeUndefined();
    expect(NOVEL_PLUGIN_MANIFEST.agentPresets).toBeUndefined();
  });
});
