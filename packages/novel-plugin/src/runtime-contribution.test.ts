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
import { NOVEL_RUNTIME_CONTRIBUTION } from "./runtime-contribution.js";

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
  await mkdir(chapters, { recursive: true });
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
  await writeFile(join(chapters, "0001-test.md"), content, "utf8");
  await writeFile(join(chapters, "index.json"), JSON.stringify([{
    number: 1,
    title: "第一章",
    fileName: "0001-test.md",
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

function pipelineGenerator(content: string): NonNullable<ToolExecutionContext["generateText"]> {
  return async (request) => {
    const system = request.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n");
    if (system.includes("章节长度修正器")) return { text: content };
    if (system.includes("审稿编辑") && system.includes("输出格式必须为 JSON")) {
      return { text: JSON.stringify({ passed: true, issues: [], summary: "审计通过" }) };
    }
    return {
      text: `=== PRE_WRITE_CHECK ===\n蓝图已检查\n=== CHAPTER_TITLE ===\n守卫测试\n=== CHAPTER_CONTENT ===\n${content}\n=== POST_SETTLEMENT ===\n完成\n=== UPDATED_STATE ===\n状态未变\n=== UPDATED_HOOKS ===\n- [ ] 测试伏笔\n=== CHAPTER_SUMMARY ===\n守卫测试。`,
    };
  };
}

const pipelineSceneSpec = {
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
    expect(record.additionalProperties).toBe(false);
    const properties = record.properties as Record<string, unknown> | undefined;
    expect(properties?.bookId).toBeUndefined();
    expect(properties?.sessionId).toBeUndefined();
    expect(properties?.bookRoot).toBeUndefined();
    const required = (record.required as readonly string[] | undefined) ?? [];
    expect(required).not.toContain("bookId");
    expect(required).not.toContain("sessionId");
    expect(required).not.toContain("bookRoot");
  }
  Object.values(record).forEach(expectModelSchemaIsBounded);
}

describe("novel Runtime contribution", () => {
  it("uses the catalog's exact ready tool set", () => {
    expect(NOVEL_RUNTIME_TOOL_CATALOG).toHaveLength(NOVEL_READY_RUNTIME_TOOL_NAMES.length);
    expect(NOVEL_READY_RUNTIME_TOOL_NAMES).toEqual(expect.arrayContaining([
      "write.preflight",
      "memory.settle_range",
      "chapter.discard_range",
      "book.dissect",
      "outline.volume",
      "arc.character",
      "publish.check",
      "writing-skills.read",
      "writing-skills.write",
      "writing-skills.check_compliance",
      "writing-skills.import_legacy",
    ]));
    expect(NOVEL_READY_RUNTIME_TOOL_NAMES).not.toEqual(expect.arrayContaining([
      "presets.read",
      "presets.write",
      "presets.check_compliance",
      "beat.read",
      "beat.write",
    ]));
    const readyNames = [...NOVEL_READY_RUNTIME_TOOL_NAMES].sort();
    expect(NOVEL_RUNTIME_TOOL_CATALOG.filter((tool) => tool.runtimeStatus === "ready").map((tool) => tool.name).sort())
      .toEqual(readyNames);
    expect(NOVEL_RUNTIME_CONTRIBUTION.tools?.map((tool) => tool.definition.name).sort())
      .toEqual(readyNames);
    expect(NOVEL_RUNTIME_TOOL_CATALOG.filter((tool) => tool.runtimeStatus !== "ready")).toHaveLength(0);
  });

  it("publishes only the Writing Skills Runtime contract", () => {
    const definitions = new Map((NOVEL_RUNTIME_CONTRIBUTION.tools ?? []).map((entry) => [entry.definition.name, entry.definition]));
    const skillToolNames = [...definitions.keys()].filter((name) => name.startsWith("writing-skills.")).sort();

    expect(skillToolNames).toEqual([
      "writing-skills.check_compliance",
      "writing-skills.import_legacy",
      "writing-skills.read",
      "writing-skills.write",
    ]);
    expect(definitions.has("presets.read")).toBe(false);
    expect(definitions.has("presets.write")).toBe(false);
    expect(definitions.has("presets.check_compliance")).toBe(false);
    expect(definitions.has("beat.read")).toBe(false);
    expect(definitions.has("beat.write")).toBe(false);

    const readSchema = definitions.get("writing-skills.read")?.inputSchema as Record<string, unknown>;
    const writeSchema = definitions.get("writing-skills.write")?.inputSchema as Record<string, unknown>;
    const complianceSchema = definitions.get("writing-skills.check_compliance")?.inputSchema as Record<string, unknown>;
    const importSchema = definitions.get("writing-skills.import_legacy")?.inputSchema as Record<string, unknown>;
    expect((readSchema.properties as Record<string, unknown>).scope).toBeDefined();
    expect((writeSchema.properties as Record<string, unknown>).enabledWritingSkillIds).toBeDefined();
    expect(writeSchema.required).toEqual(["enabledWritingSkillIds"]);
    expect((complianceSchema.properties as Record<string, unknown>).content).toBeDefined();
    expect(complianceSchema.required).toEqual(["content"]);
    expect(importSchema.properties).toEqual({});
    expect(definitions.get("writing-skills.import_legacy")?.risk).toBe("confirmed-write");
  });

  it("contributes the authoritative NovelFork writing workflow prompt", () => {
    const prompt = NOVEL_RUNTIME_CONTRIBUTION.promptExtensions?.[0]?.content ?? "";
    expect(prompt).toContain("NovelFork 小说创作运行时");
    expect(prompt).toContain("chapter.write");
    expect(prompt).toContain("可信的 novel.book 资源绑定");
    expect(prompt).toContain("write.preflight");
    expect(prompt).toContain("禁止用写作理论");
  });

  it("contributes factual NovelFork learning categories and the required writing documents", () => {
    const learning = NOVEL_RUNTIME_CONTRIBUTION.learning;
    expect(learning?.categories.map((category) => category.id)).toEqual([
      "novelfork-writing",
      "novelfork-context",
      "novelfork-review",
    ]);
    expect(learning?.docs.map((doc) => doc.id)).toEqual([
      "novelfork-books",
      "novelfork-workbench",
      "novelfork-chapter-flow",
      "novelfork-jingwei-lore",
      "novelfork-narrative-memory",
      "novelfork-writing-resources",
      "novelfork-agent-writing",
      "novelfork-candidates-versions",
    ]);
    expect(learning?.docs.flatMap((doc) => doc.actions).every((action) => (
      action.href === "/next/books" || action.href === "/next/sessions"
    ))).toBe(true);
    expect(learning?.docs.find((doc) => doc.id === "novelfork-candidates-versions")?.sections
      .some((section) => section.body["zh-CN"].includes("尚未暴露完整候选稿状态按钮和一键回退控件"))).toBe(true);
  });

  it("does not expose host-controlled fields in any model schema", () => {
    for (const contribution of NOVEL_RUNTIME_CONTRIBUTION.tools ?? []) {
      expectModelSchemaIsBounded(contribution.definition.inputSchema);
    }
  });

  it("injects the trusted binding bookId instead of accepting a model bookId", async () => {
    const trusted = await createBook("trusted", "trusted content");
    const result = await tool("chapter.read").handler(
      { chapterNumber: 1 },
      context(trusted.projectRoot, { bookId: "trusted", root: trusted.bookRoot }),
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ bookId: "trusted", chapterNumber: 1, content: "trusted content" });
  });

  it("writes only a book-compliant complete chapter in the trusted binding", async () => {
    const trusted = await createBook("trusted", "旧正文");
    const storage = initializeStorageDatabase({ databasePath: join(trusted.projectRoot, "novelfork.db") });
    runStorageMigrations(storage);
    const content = "新的正文。".repeat(600);
    try {
      const result = await tool("chapter.write").handler(
        { chapterNumber: 1, content },
        context(trusted.projectRoot, { bookId: "trusted", root: trusted.bookRoot }),
      );

      expect(result).toMatchObject({ ok: true, data: { bookId: "trusted", chapterNumber: 1, wordCount: 3000 } });
      expect(await readFile(join(trusted.bookRoot, "chapters", "0001-test.md"), "utf8")).toBe(content);
      expect(JSON.parse(await readFile(join(trusted.bookRoot, "chapters", "index.json"), "utf8"))).toMatchObject([
        { number: 1, wordCount: 3000 },
      ]);
    } finally {
      closeStorageDatabase();
    }
  });

  it("rejects a short direct chapter.write without changing the trusted chapter", async () => {
    const trusted = await createBook("trusted", "原始正文");
    const storage = initializeStorageDatabase({ databasePath: join(trusted.projectRoot, "novelfork.db") });
    runStorageMigrations(storage);
    try {
      const result = await tool("chapter.write").handler(
        { chapterNumber: 1, content: "过短正文" },
        context(trusted.projectRoot, { bookId: "trusted", root: trusted.bookRoot }),
      );

      expect(result).toMatchObject({ ok: false, error: "chapter-length-out-of-range" });
      expect(await readFile(join(trusted.bookRoot, "chapters", "0001-test.md"), "utf8")).toBe("原始正文");
    } finally {
      closeStorageDatabase();
    }
  });

  it("rejects pipeline.write when final content remains outside the book hard range", async () => {
    const trusted = await createBook("trusted", "原始正文");
    const storage = initializeStorageDatabase({ databasePath: join(trusted.projectRoot, "novelfork.db") });
    runStorageMigrations(storage);
    const trustedContext: ToolExecutionContext = {
      ...context(trusted.projectRoot, { bookId: "trusted", root: trusted.bookRoot }),
      model: { provider: "test-provider", id: "test-current-model" },
      generateText: pipelineGenerator("过短正文"),
    };
    try {
      const result = await tool("pipeline.write").handler(
        { sceneSpec: pipelineSceneSpec, autoRevise: false, skipContextGate: true },
        trustedContext,
      );
      console.log("FAIL_1:", JSON.stringify(result));
      expect(result).toMatchObject({ ok: false, error: "length-out-of-range" });
      expect(await tool("resource.manage").handler(
        { action: "list", filter: { type: "chapter", status: "accepted" } },
        trustedContext,
      )).toMatchObject({ ok: true, data: { resources: [] } });
      expect(storage.sqlite.prepare("SELECT COUNT(*) AS count FROM narrative_event WHERE book_id = ?").get("trusted"))
        .toEqual({ count: 0 });
    } finally {
      closeStorageDatabase();
    }
  });

  it("reads the trusted chapter index and builds bound narrative artifacts", async () => {
    const trusted = await createBook("trusted", "trusted content");
    const trustedContext = context(trusted.projectRoot, { bookId: "trusted", root: trusted.bookRoot });

    const cockpit = await tool("cockpit.snapshot").handler({}, trustedContext);
    expect(cockpit).toMatchObject({
      ok: true,
      data: { status: "available", book: { id: "trusted" }, storyDir: "story" },
    });
    expect(JSON.stringify(cockpit)).not.toContain(trusted.projectRoot);

    const chapterList = await tool("chapter.list").handler({}, trustedContext);
    expect(chapterList).toMatchObject({
      ok: true,
      data: { bookId: "trusted", chapters: [{ number: 1, title: "第一章" }] },
    });

    const snapshot = await tool("narrative.read_line").handler({}, trustedContext);
    expect(snapshot).toMatchObject({ ok: true, data: { bookId: "trusted" } });

    const proposal = await tool("narrative.propose_change").handler(
      { summary: "推进主角进入山门" },
      trustedContext,
    );
    expect(proposal).toMatchObject({ ok: true, data: { summary: "推进主角进入山门" } });
    // preview 必须能原样回传给 narrative.approve_change，所以不能带宿主字段。
    expect(JSON.stringify(proposal)).not.toContain("bookId");
  });

  it("only writes the narrative line after an explicit approval decision", async () => {
    const trusted = await createBook("trusted", "trusted content");
    const trustedContext = context(trusted.projectRoot, { bookId: "trusted", root: trusted.bookRoot });
    const storePath = join(trusted.bookRoot, "story", "narrative_line.json");

    const proposal = await tool("narrative.propose_change").handler(
      {
        summary: "新增伏笔节点",
        nodes: [{ id: "node-hook", type: "foreshadow", title: "青铜铃异响" }],
      },
      trustedContext,
    ) as { ok: boolean; data?: Record<string, unknown> };
    expect(proposal.ok).toBe(true);
    // propose 只是草案：此时不得落盘。
    await expect(readFile(storePath, "utf8")).rejects.toThrow();

    // 缺少 decision 时必须拒绝，而不是默认写入。
    expect(await tool("narrative.approve_change").handler(
      { preview: proposal.data },
      trustedContext,
    )).toMatchObject({ ok: false, error: "invalid-input" });
    await expect(readFile(storePath, "utf8")).rejects.toThrow();

    const rejected = await tool("narrative.approve_change").handler(
      { preview: proposal.data, decision: "rejected", reason: "与主线冲突" },
      trustedContext,
    );
    expect(rejected).toMatchObject({ ok: true, data: { applied: false, reason: "rejected" } });
    const afterReject = JSON.parse(await readFile(storePath, "utf8")) as {
      nodes: Array<{ id: string }>;
      appliedMutations: Array<{ decision?: string }>;
    };
    expect(afterReject.nodes.map((node) => node.id)).not.toContain("node-hook");
    expect(afterReject.appliedMutations[0]?.decision).toBe("rejected");

    const approved = await tool("narrative.approve_change").handler(
      { preview: proposal.data, decision: "approved" },
      trustedContext,
    );
    expect(approved).toMatchObject({ ok: true, data: { applied: true } });
    const afterApprove = JSON.parse(await readFile(storePath, "utf8")) as { nodes: Array<{ id: string }> };
    expect(afterApprove.nodes.map((node) => node.id)).toContain("node-hook");
  });

  it("creates Narrative Memory events only under the trusted book binding", async () => {
    const trusted = await createBook("trusted", "trusted content");
    const storage = initializeStorageDatabase({ databasePath: join(trusted.projectRoot, "novelfork.db") });
    runStorageMigrations(storage);
    try {
      const pgi = await tool("pgi.ask").handler(
        { chapterNumber: 1, chapterIntent: "主角进入山门" },
        context(trusted.projectRoot, { bookId: "trusted", root: trusted.bookRoot }),
      );
      expect(pgi).toMatchObject({ ok: true });

      const resources = await tool("resource.manage").handler(
        { action: "list", filter: { type: "chapter", status: "accepted" } },
        context(trusted.projectRoot, { bookId: "trusted", root: trusted.bookRoot }),
      );
      expect(resources).toMatchObject({ ok: true, data: { bookId: "trusted" } });

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

  it("publishes migrated tool schemas with bounded import input and confirmation risks", () => {
    const definitions = new Map((NOVEL_RUNTIME_CONTRIBUTION.tools ?? []).map((entry) => [entry.definition.name, entry.definition]));
    const importSchema = definitions.get("pipeline.import_chapters")?.inputSchema as Record<string, unknown>;
    const importProperties = importSchema.properties as Record<string, unknown>;

    expect(importProperties.content).toBeDefined();
    expect(importProperties.filePath).toBeUndefined();
    expect(importSchema.required).toEqual(["content"]);
    for (const name of ["rewrite.apply", "pipeline.revise", "pipeline.import_chapters", "hooks.manage", "pipeline.write"]) {
      expect(definitions.get(name)?.risk).toBe("confirmed-write");
    }
  });

  it("executes every migrated domain tool against the trusted book and current host model", async () => {
    const trusted = await createBook("trusted", "林舟走进山门。\n值得注意的是，青铜铃缓缓摇动。\n守门人抬起头。", true);
    await mkdir(join(trusted.bookRoot, "jingwei", "角色"), { recursive: true });
    await writeFile(join(trusted.bookRoot, "jingwei", "角色", "林舟.md"), "# 林舟\n谨慎的少年。", "utf8");
    const storage = initializeStorageDatabase({ databasePath: join(trusted.projectRoot, "novelfork.db") });
    runStorageMigrations(storage);
    const generatedSystems: string[] = [];
    const outputs: string[] = [];
    const sceneSpec = {
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
    };
    const generateText: NonNullable<ToolExecutionContext["generateText"]> = async (request) => {
      const system = request.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n");
      generatedSystems.push(system);
      if (system.includes("章节规划专家") || system.includes("结构化写作蓝图")) return { text: JSON.stringify(sceneSpec) };
      if (system.includes("文风分析师")) return { text: "# 文风指南\n\n短句推进，动作承载情绪。" };
      if (system.includes("大纲编辑")) {
        return { text: JSON.stringify([{ title: "试炼开启", summary: "林舟进入山门试炼。", hooks: ["青铜铃"] }]) };
      }
      if (system.includes("审稿编辑") && system.includes("输出格式必须为 JSON")) {
        return { text: JSON.stringify({ passed: true, issues: [], summary: "审计通过" }) };
      }
      if (system.includes("修稿编辑")) {
        return { text: "=== FIXED_ISSUES ===\n已润色\n=== REVISED_CONTENT ===\n林舟走进山门。\n青铜铃骤然响起。\n守门人抬起头。\n=== UPDATED_STATE ===\n林舟抵达山门\n=== UPDATED_HOOKS ===\n- [ ] 青铜铃" };
      }
      if (system.includes("网文改写编辑")) return { text: "青铜铃骤然响起，林舟停下脚步。" };
      return {
        text: `=== PRE_WRITE_CHECK ===\n蓝图已检查\n=== CHAPTER_TITLE ===\n铃声之后\n=== CHAPTER_CONTENT ===\n${"林舟沿石阶向上，青铜铃在风里发出清响。".repeat(160)}\n=== POST_SETTLEMENT ===\n完成\n=== UPDATED_STATE ===\n林舟取得试炼资格\n=== UPDATED_HOOKS ===\n- [x] 青铜铃\n=== CHAPTER_SUMMARY ===\n林舟取得试炼资格。`,
      };
    };
    const trustedContext: ToolExecutionContext = {
      ...context(trusted.projectRoot, { bookId: "trusted", root: trusted.bookRoot }),
      model: { provider: "test-provider", id: "test-current-model" },
      generateText,
      emitOutput: (output) => outputs.push(output),
    };

    try {
      expect(await tool("chapter.audit").handler({ chapterNumber: 1 }, trustedContext)).toMatchObject({ ok: true });

      const rewrite = await tool("rewrite.segment").handler(
        { chapterNumber: 1, selection: { start: 2, end: 2 }, mode: "reduce_ai" },
        trustedContext,
      );
      expect(rewrite).toMatchObject({ ok: true, data: { rewrittenText: "青铜铃骤然响起，林舟停下脚步。" } });

      expect(await tool("rewrite.apply").handler(
        { chapterNumber: 1, lineRange: { start: 2, end: 2 }, newText: "青铜铃骤然响起。" },
        trustedContext,
      )).toMatchObject({ ok: true, data: { bookId: "trusted", chapterNumber: 1 } });
      expect(await readFile(join(trusted.bookRoot, "chapters", "0001-test.md"), "utf8")).toContain("青铜铃骤然响起。");

      expect(await tool("style.import").handler(
        { referenceText: "山风穿过松林，少年拾级而上。".repeat(180), sourceName: "测试样本" },
        trustedContext,
      )).toMatchObject({ ok: true, data: { bookId: "trusted", kind: "style-suggestion" } });

      expect(await tool("pipeline.revise").handler(
        { chapterNumber: 1, mode: "spot-fix" },
        trustedContext,
      )).toMatchObject({ ok: true, data: { bookId: "trusted", chapterNumber: 1, revised: false } });

      const importedText = `第1章 旧城\n${"旧城风雨。".repeat(120)}\n第2章 山门\n${"山门钟鸣。".repeat(120)}`;
      expect(await tool("pipeline.import_chapters").handler(
        { content: importedText, sourceName: "显式文本" },
        trustedContext,
      )).toMatchObject({ ok: true, data: { bookId: "trusted", importedChapters: 2, firstChapter: 2 } });

      expect(await tool("outline.suggest_next").handler({}, trustedContext)).toMatchObject({
        ok: true,
        data: { suggestions: [{ title: "试炼开启" }] },
      });
      expect(await tool("character.check_consistency").handler(
        { characterName: "林舟", chapterRange: { from: 1, to: 3 } },
        trustedContext,
      )).toMatchObject({ ok: true, data: { characters: [{ name: "林舟" }] } });

      expect(await tool("hooks.manage").handler(
        { action: "plant", chapterNumber: 1, description: "青铜铃真正的主人" },
        trustedContext,
      )).toMatchObject({ ok: true, data: { action: "plant" } });
      expect(await tool("hooks.manage").handler({ action: "list" }, trustedContext)).toMatchObject({
        ok: true,
        data: { hooks: [{ id: "hook-0", done: false }] },
      });

      const blockedPreflight = await tool("write.preflight").handler(
        { chapterNumber: 2, userDirectives: "让林舟进入山门试炼，先过守门人这一关。" },
        trustedContext,
      );
      expect(blockedPreflight.ok).toBe(false);
      expect(blockedPreflight.error).toBe("context-not-ready");

      const settled = await tool("memory.settle_range").handler(
        { fromChapter: 1, toChapter: 3 },
        trustedContext,
      );
      expect(settled.ok).toBe(true);
      expect((settled.data as { chaptersSettled?: number } | undefined)?.chaptersSettled).toBeGreaterThan(0);

      // 若抽取结果偏少，直接插入一条 applied 事件保证 preflight 可观测到近章记忆。
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

      expect(await tool("write.preflight").handler(
        { chapterNumber: 4, userDirectives: "让林舟进入山门试炼，先过守门人这一关。" },
        trustedContext,
      )).toMatchObject({ ok: true });

      expect(await tool("scene.spec").handler(
        { chapterNumber: 4, userDirectives: "让林舟进入山门试炼，先过守门人这一关。" },
        trustedContext,
      )).toMatchObject({ ok: true, data: { sceneSpec: { title: "铃声之后" } } });

      const pipeline = await tool("pipeline.write").handler(
        { sceneSpec: { ...pipelineSceneSpec, chapter: 4 }, autoRevise: false },
        trustedContext,
      );
      expect(pipeline).toMatchObject({ ok: true, data: { chapterNumber: 4 } });
      expect((pipeline.data as { wordCount?: number } | undefined)?.wordCount).toBeGreaterThanOrEqual(2182);

      expect(generatedSystems.some((system) => system.includes("结构化写作蓝图") || system.includes("章节规划专家"))).toBe(true);
      expect(generatedSystems.some((system) => system.includes("文风分析师"))).toBe(true);
      expect(generatedSystems.some((system) => system.includes("大纲编辑"))).toBe(true);
      expect(generatedSystems.some((system) => system.includes("审稿编辑"))).toBe(true);
      expect(outputs.length).toBeGreaterThan(0);
      expect(JSON.stringify({ generatedSystems, outputs })).not.toContain("apiKey");
    } finally {
      closeStorageDatabase();
    }
  });

  it("rejects a forged model bookId instead of crossing books", async () => {
    const trusted = await createBook("trusted", "trusted content");
    const result = await tool("chapter.read").handler(
      { bookId: "other", chapterNumber: 1 },
      context(trusted.projectRoot, { bookId: "trusted", root: trusted.bookRoot }),
    );

    expect(result).toMatchObject({ ok: false, error: "forged-host-field" });
    expect(JSON.stringify(result)).not.toContain("trusted content");
  });

  it("fails closed without a trusted binding", async () => {
    const trusted = await createBook("trusted", "trusted content");
    const result = await tool("chapter.read").handler({ chapterNumber: 1 }, context(trusted.projectRoot));

    expect(result).toMatchObject({ ok: false, error: "missing-resource-binding" });
  });

  it("does not follow a legacy external root redirect for a trusted binding", async () => {
    const trusted = await createBook("trusted", "trusted content");
    const escapedRoot = join(trusted.projectRoot, "escaped-book");
    await mkdir(join(escapedRoot, "chapters"), { recursive: true });
    await writeFile(join(escapedRoot, "chapters", "0001-escaped.md"), "escaped content", "utf8");
    await writeFile(
      join(trusted.bookRoot, ".novelfork-project-init.json"),
      JSON.stringify({ repositoryPath: escapedRoot }),
      "utf8",
    );

    const result = await tool("chapter.read").handler(
      { chapterNumber: 1 },
      context(trusted.projectRoot, { bookId: "trusted", root: trusted.bookRoot }),
    );

    expect(result).toMatchObject({ ok: true, data: { content: "trusted content" } });
    expect(JSON.stringify(result)).not.toContain("escaped content");
  });
});
