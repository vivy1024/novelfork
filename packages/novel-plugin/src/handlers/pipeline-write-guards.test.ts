/**
 * pipeline.write 的三道长篇守卫（行为测试，真实隔离存储 + 真实章节文件）：
 * 1. 生成期间作者改写同号章 → chapter-conflict，作者版本保留；
 * 2. 写前召回凭证：无凭证 / 章号不符拒写，有凭证放行，超预算在 preflight 阶段就拦下；
 * 3. 写后 canon 一致性（H2）：相关条目进审计且只出 warning，不相关条目不进审计。
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeStorageDatabase, initializeStorageDatabase, runStorageMigrations } from "@vivy1024/novelfork-core";
import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({
  /** 审计阶段的钩子：模拟 pipeline.write 跑到审计时作者另一路改稿。 */
  onAudit: null as null | (() => Promise<void>),
  /** 让召回包带上硬通道溢出告警。 */
  forceOverflow: false,
}));

vi.mock("./chapter-audit-v2.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./chapter-audit-v2.js")>();
  return {
    ...actual,
    // handleChapterAuditV2 是同步函数，钩子放在它之前的 canon 取数里（同一阶段、可 await）。
    loadChapterCanonEntries: async (...args: Parameters<typeof actual.loadChapterCanonEntries>) => {
      if (hooks.onAudit) await hooks.onAudit();
      return actual.loadChapterCanonEntries(...args);
    },
  };
});

vi.mock("../engine/narrative-memory/build-narrative-context.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../engine/narrative-memory/build-narrative-context.js")>();
  return {
    ...actual,
    buildNarrativeContext: async (...args: Parameters<typeof actual.buildNarrativeContext>) => {
      const pack = await actual.buildNarrativeContext(...args);
      if (!hooks.forceOverflow) return pack;
      return {
        ...pack,
        diagnostics: {
          ...pack.diagnostics,
          warnings: [...pack.diagnostics.warnings, "hard channel exceeds budget after degradation: 30000"],
        },
      };
    },
  };
});

import { createBookRepository } from "../engine/jingwei/repositories/book-repo.js";
import { createStoryJingweiEntryRepository } from "../engine/jingwei/repositories/entry-repo.js";
import { createStoryJingweiSectionRepository } from "../engine/jingwei/repositories/section-repo.js";
import type { CreateStoryJingweiEntryInput, CreateStoryJingweiSectionInput } from "../engine/jingwei/types.js";
import { ensureNarrativeMemorySchema } from "../engine/narrative-memory/storage.js";
import { createWritingResourceService } from "../engine/writing-resource/service.js";
import { handleChapterAuditV2, selectChapterCanonEntries } from "./chapter-audit-v2.js";
import { handleChapterRead } from "./chapter-read.js";
import { executePipelineWrite, type PipelineToolCallDispatcher } from "./pipeline-write-service.js";
import { recordWriteRecall, resetWriteRecallsForTest, verifyWriteRecall } from "./recall-token.js";
import { handleWritePreflight } from "./write-preflight.js";

const BOOK = "trusted";
const DIRECTIVE = "让林舟进入山门试炼，先过守门人这一关。";
const CHAPTER_TEXT = `${"林舟沿石阶向上，青铜铃在风里发出清响。".repeat(150)}`;
const AUTHOR_TEXT = `作者在生成期间亲手改过的第一章。${"山风很冷。".repeat(600)}`;
const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };
const settled: PipelineToolCallDispatcher = async () => ({
  ok: true,
  summary: "章后结算完成。",
  data: { settlement: { status: "completed", chapterNumber: 1 } },
});

let projectRoot: string;
let bookRoot: string;
let storage: StorageDatabase;

function sceneSpec(chapter: number) {
  return {
    chapter,
    title: "铃声之后",
    wordTarget: 3000,
    scenes: [{
      characters: ["林舟"],
      location: "山门石阶",
      conflict: "守门人阻止林舟入山",
      mood: "紧张",
      outcome: "林舟取得试炼资格",
      hooks_used: [],
      hooks_planted: [],
    }],
    constraints: [],
  };
}

async function seedBook(): Promise<void> {
  projectRoot = await mkdtemp(join(tmpdir(), "novelfork-pipeline-guards-"));
  bookRoot = join(projectRoot, "books", BOOK);
  const volume = join(bookRoot, "chapters", "卷01");
  await mkdir(volume, { recursive: true });
  await writeFile(join(bookRoot, "book.json"), JSON.stringify({
    id: BOOK,
    title: "Book trusted",
    platform: "other",
    genre: "fantasy",
    status: "active",
    targetChapters: 100,
    chapterWordCount: 3000,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }), "utf8");
  await writeFile(join(volume, "0001-test.md"), "旧正文。".repeat(800), "utf8");
  await writeFile(join(bookRoot, "chapters", "index.json"), JSON.stringify([{
    number: 1, title: "第一章", fileName: "卷01/0001-test.md", wordCount: 3200, status: "accepted",
  }]), "utf8");
  storage = initializeStorageDatabase({ databasePath: join(projectRoot, "novelfork.db") });
  runStorageMigrations(storage);
  ensureNarrativeMemorySchema(storage);
  // 近章记忆种子：否则写前预检以 empty-recent-progress 挡在落盘之前。
  storage.sqlite.prepare(`
    INSERT INTO narrative_event (
      id, book_id, chapter_number, event_type, subject, predicate, object,
      evidence_text, confidence, source, status, risk_level, created_at, applied_at
    ) VALUES (
      'guard-seed', ?, 1, 'timeline_advanced', '林舟', '抵达', '山门',
      '林舟抵达山门。', 0.9, 'settle', 'applied', 'low',
      '2026-08-07T00:00:00.000Z', '2026-08-07T00:00:00.000Z'
    )
  `).run(BOOK);
}

function resourceService() {
  return createWritingResourceService({ storage, resolveBookDir: () => bookRoot });
}

/** 叙述者会话：preflight 与 pipeline.write 用同一个会话，召回记录按「会话 + 书 + 章」记在服务端。 */
const SESSION = "narrator-guards";

async function preflight(chapterNumber: number, sessionId: string = SESSION) {
  return handleWritePreflight({ bookId: BOOK, bookRoot, chapterNumber, userDirectives: DIRECTIVE, storage, buildRecall: true, sessionId });
}

function writeOptions(sessionId: string = SESSION) {
  return { root: projectRoot, bookRoot, sessionId, logger: silentLogger, dispatchToolCall: settled };
}

beforeEach(async () => {
  hooks.onAudit = null;
  hooks.forceOverflow = false;
  resetWriteRecallsForTest();
  await seedBook();
});

afterEach(async () => {
  closeStorageDatabase();
  await rm(projectRoot, { recursive: true, force: true });
});

describe("问题 1：pipeline.write 不覆盖作者在生成期间的修改", () => {
  it("审计阶段作者通过 resourceService 改写同号章 → chapter-conflict，作者版本保留", async () => {
    const recall = await preflight(1);
    expect(recall.ok).toBe(true);
    let authorSaved!: Promise<unknown>;
    hooks.onAudit = async () => {
      // 另一路（写作台保存）直接改同号正式章；不经过书级锁。
      authorSaved = resourceService().update(BOOK, "chapter:1", { content: AUTHOR_TEXT });
      await authorSaved;
    };

    const result = await executePipelineWrite(
      { bookId: BOOK, sceneSpec: sceneSpec(1), content: CHAPTER_TEXT },
      writeOptions(),
    );
    await authorSaved;

    expect(result).toMatchObject({ ok: false, code: "chapter-conflict" });
    expect(result.ok === false && result.explanation).toContain("发生了什么");
    expect(result.ok === false && result.explanation).toContain("建议怎么做");
    const read = await handleChapterRead({ bookId: BOOK, chapterNumber: 1 }, undefined, { bookRoot, storage });
    expect(read.data?.content).toBe(AUTHOR_TEXT);
  });

  it("开头还没有这一章、生成期间被新建同号章 → chapter-conflict，不覆盖新建的那份", async () => {
    const recall = await preflight(2);
    expect(recall.ok).toBe(true);
    hooks.onAudit = async () => {
      await resourceService().create(BOOK, {
        type: "chapter", status: "accepted", title: "作者新建", content: AUTHOR_TEXT, chapterNumber: 2,
      });
    };

    const result = await executePipelineWrite(
      { bookId: BOOK, sceneSpec: sceneSpec(2), content: CHAPTER_TEXT },
      writeOptions(),
    );

    expect(result).toMatchObject({ ok: false, code: "chapter-conflict" });
    const read = await handleChapterRead({ bookId: BOOK, chapterNumber: 2 }, undefined, { bookRoot, storage });
    expect(read.data?.content).toBe(AUTHOR_TEXT);
  });

  it("生成期间无人改动时照常覆盖已有章（没传 expectedHash 也按开头读到的版本放行）", async () => {
    await preflight(1);
    const result = await executePipelineWrite(
      { bookId: BOOK, sceneSpec: sceneSpec(1), content: CHAPTER_TEXT },
      writeOptions(),
    );
    expect(result.ok).toBe(true);
    const read = await handleChapterRead({ bookId: BOOK, chapterNumber: 1 }, undefined, { bookRoot, storage });
    expect(read.data?.content).toContain("青铜铃");
  });
});

describe("问题 2：写前召回（服务端记录，模型不传凭证）", () => {
  it("preflight 通过时返回召回包文本，并在服务端记下本会话本章已召回", async () => {
    const result = await preflight(2);
    expect(result.ok).toBe(true);
    expect(result.recall?.text).toContain("第 2 章写前召回包");
    expect(result.recall?.basis).toBe("directive");
    expect(result.recall).not.toHaveProperty("recallToken");
    expect(verifyWriteRecall({ sessionId: SESSION, bookId: BOOK, chapterNumber: 2 }).ok).toBe(true);
    // 默认不开召回的内部路径不记召回。
    resetWriteRecallsForTest();
    const internal = await handleWritePreflight({ bookId: BOOK, bookRoot, chapterNumber: 2, userDirectives: DIRECTIVE, storage, sessionId: SESSION });
    expect(internal.recall).toBeUndefined();
    expect(verifyWriteRecall({ sessionId: SESSION, bookId: BOOK, chapterNumber: 2 }).ok).toBe(false);
  });

  it("没做写前召回 → recall-required，带三段式说明，正文不落盘", async () => {
    const result = await executePipelineWrite(
      { bookId: BOOK, sceneSpec: sceneSpec(2), content: CHAPTER_TEXT },
      writeOptions(),
    );
    expect(result).toMatchObject({ ok: false, code: "recall-required" });
    expect(result.ok === false && result.explanation).toContain("write.preflight");
    expect(result.ok === false && result.explanation).toContain("为什么要看");
    expect(result.ok === false && result.explanation).toContain("不需要传任何凭证");
    const index = JSON.parse(await readFile(join(bookRoot, "chapters", "index.json"), "utf8")) as { number: number }[];
    expect(index.map((entry) => entry.number)).not.toContain(2);
  });

  it("同一会话先 preflight 再写 → 放行保存（pipeline.write 不带任何凭证参数）", async () => {
    await preflight(2);
    const result = await executePipelineWrite(
      { bookId: BOOK, sceneSpec: sceneSpec(2), content: CHAPTER_TEXT },
      writeOptions(),
    );
    expect(result).toMatchObject({ ok: true, chapterNumber: 2 });
  });

  it("召回的是别的章 → recall-required", async () => {
    await preflight(2);
    const result = await executePipelineWrite(
      { bookId: BOOK, sceneSpec: sceneSpec(3), content: CHAPTER_TEXT },
      writeOptions(),
    );
    expect(result).toMatchObject({ ok: false, code: "recall-required" });
    expect(result.ok === false && result.error).toContain("第3章");
  });

  it("别的会话做的召回不能借用 → recall-required", async () => {
    await preflight(2, "narrator-other");
    const result = await executePipelineWrite(
      { bookId: BOOK, sceneSpec: sceneSpec(2), content: CHAPTER_TEXT },
      writeOptions(SESSION),
    );
    expect(result).toMatchObject({ ok: false, code: "recall-required" });
  });

  it("超预算时 preflight 阶段就以 memory-budget-overflow 拦下，不签凭证", async () => {
    hooks.forceOverflow = true;
    const result = await preflight(2);
    expect(result.ok).toBe(false);
    expect(result.recall).toBeUndefined();
    const blocker = result.blockers.find((item) => item.code === "memory-budget-overflow");
    expect(blocker?.explanation?.whyItMatters).toContain("还没白写");
    expect(blocker?.explanation?.suggestedAction).toContain("召回预算");
  });

  it("召回记录按会话、书、章隔离，过期即失效；同章重新召回会刷新有效期", () => {
    recordWriteRecall({ sessionId: "s1", bookId: BOOK, chapterNumber: 5, packageFingerprint: "x", now: 1_000, ttlMs: 10 });
    expect(verifyWriteRecall({ sessionId: "s1", bookId: BOOK, chapterNumber: 5, now: 1_005 }).ok).toBe(true);
    expect(verifyWriteRecall({ sessionId: "s2", bookId: BOOK, chapterNumber: 5, now: 1_005 })).toMatchObject({ ok: false, reason: "missing" });
    expect(verifyWriteRecall({ sessionId: "s1", bookId: "other", chapterNumber: 5, now: 1_005 })).toMatchObject({ ok: false, reason: "missing" });
    expect(verifyWriteRecall({ sessionId: "s1", bookId: BOOK, chapterNumber: 6, now: 1_005 })).toMatchObject({ ok: false, reason: "missing" });
    recordWriteRecall({ sessionId: "s1", bookId: BOOK, chapterNumber: 5, packageFingerprint: "y", now: 1_008, ttlMs: 10 });
    expect(verifyWriteRecall({ sessionId: "s1", bookId: BOOK, chapterNumber: 5, now: 1_015 }).ok).toBe(true);
    expect(verifyWriteRecall({ sessionId: "s1", bookId: BOOK, chapterNumber: 5, now: 1_019 })).toMatchObject({ ok: false, reason: "expired" });
  });
});

function section(input: Pick<CreateStoryJingweiSectionInput, "id" | "key" | "name">): CreateStoryJingweiSectionInput {
  const now = new Date("2026-05-20T02:00:00.000Z");
  return {
    bookId: BOOK, description: "", icon: null, order: 0, enabled: true, showInSidebar: true, participatesInAi: true,
    defaultVisibility: "tracked", fieldsJson: [], builtinKind: null, sourceTemplate: null, createdAt: now, updatedAt: now,
    ...input,
  };
}

function entry(input: Partial<CreateStoryJingweiEntryInput> & Pick<CreateStoryJingweiEntryInput, "id" | "sectionId" | "title" | "contentMd">): CreateStoryJingweiEntryInput {
  const now = new Date("2026-05-20T03:00:00.000Z");
  return {
    bookId: BOOK, tags: [], aliases: [], customFields: {}, relatedChapterNumbers: [], relatedEntryIds: [],
    visibilityRule: { type: "tracked" }, participatesInAi: true, tokenBudget: null, priorityTier: "auto",
    createdAt: now, updatedAt: now,
    ...input,
  };
}

async function seedCanon(): Promise<void> {
  await createBookRepository(storage).create({
    id: BOOK, name: "Book trusted", jingweiMode: "dynamic", currentChapter: 1,
    createdAt: new Date("2026-05-20T01:00:00.000Z"), updatedAt: new Date("2026-05-20T01:00:00.000Z"),
  });
  const sections = createStoryJingweiSectionRepository(storage);
  const entries = createStoryJingweiEntryRepository(storage);
  // 分区 key 用系统真实会建的分类名（create-from-guide / 路由按 category 建分区时 key=分类）：
  // 召回与审计按经纬分类表态判定全书硬规则，不再按分区名正则猜。
  await sections.create(section({ id: "sec-rules", key: "rules", name: "世界规则" }));
  await sections.create(section({ id: "sec-people", key: "people", name: "人物" }));
  await entries.create(entry({ id: "rule-sword", sectionId: "sec-rules", title: "山门禁令", contentMd: "禁止御剑飞行，违者逐出山门。" }));
  // 与本章无关的 canon 人物：既不在正文也不在 sceneSpec 角色里。
  await entries.create(entry({ id: "canon-other", sectionId: "sec-people", title: "南宫婉", contentMd: "禁止离开掩月宗。", layer: "canon" }));
}

describe("问题 3：写后 canon 一致性检查", () => {
  it("canon「禁止御剑飞行」× 正文「他御剑飞行」被标出（soft，送人工复核）", () => {
    const result = handleChapterAuditV2({
      bookId: BOOK,
      chapterNumber: 2,
      content: "林舟深吸一口气，他御剑飞行，掠过山门。",
      canonEntries: [{ title: "山门禁令", contentMd: "禁止御剑飞行，违者逐出山门。" }],
    });
    const hit = result.softViolations.find((violation) => violation.ruleId === "H2");
    expect(hit?.description).toContain("御剑飞行");
    expect(result.hardViolations.some((violation) => violation.ruleId === "H2")).toBe(false);
  });

  it("只选本章相关条目：全书硬规则入选，无关的 canon 人物不进审计", async () => {
    await seedCanon();
    const [sectionsList, entriesList] = await Promise.all([
      createStoryJingweiSectionRepository(storage).listEnabledForAi(BOOK),
      createStoryJingweiEntryRepository(storage).listByBook(BOOK),
    ]);
    const selected = selectChapterCanonEntries({
      sections: sectionsList,
      entries: entriesList,
      content: "林舟深吸一口气，他御剑飞行，掠过山门。",
      sceneCharacters: ["林舟"],
    });
    expect(selected.map((item) => item.title)).toEqual(["山门禁令"]);

    const mentioned = selectChapterCanonEntries({
      sections: sectionsList,
      entries: entriesList,
      content: "南宫婉站在掩月宗山门外。",
      sceneCharacters: ["林舟"],
    });
    expect(mentioned.map((item) => item.title).sort()).toEqual(["南宫婉", "山门禁令"].sort());
  });

  it("pipeline.write 把相关 canon 传进审计：H2 命中记为 warning、needsHumanReview，章节照常保存", async () => {
    await seedCanon();
    const recall = await preflight(2);
    const content = `${CHAPTER_TEXT}林舟他御剑飞行，越过石阶。`;
    const result = await executePipelineWrite(
      { bookId: BOOK, sceneSpec: sceneSpec(2), content },
      writeOptions(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const h2 = result.auditResult.issues.filter((issue) => issue.category === "H2");
    expect(h2).toHaveLength(1);
    expect(h2[0]?.severity).toBe("warning");
    expect(h2[0]?.description).toContain("御剑飞行");
    // 无关条目「南宫婉 · 禁止离开掩月宗」没进审计。
    expect(result.auditResult.issues.some((issue) => issue.description.includes("掩月宗"))).toBe(false);
    expect(result.needsHumanReview).toBe(true);
    expect(result.publishHint?.warnings.join("\n")).toContain("经纬设定冲突");
  });
});
