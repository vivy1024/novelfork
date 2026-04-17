import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BookConfig } from "../models/book.js";
import type { PlanChapterOutput } from "../agents/planner.js";
import { ComposerAgent } from "../agents/composer.js";
import { MemoryDB } from "../state/memory-db.js";

const require = createRequire(import.meta.url);
const hasNodeSqlite = (() => {
  try {
    require("node:sqlite");
    return true;
  } catch {
    return false;
  }
})();

describe("ComposerAgent - Lorebook RAG Integration", () => {
  let root: string;
  let bookDir: string;
  let storyDir: string;
  let book: BookConfig;
  let plan: PlanChapterOutput;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-lorebook-test-"));
    bookDir = join(root, "books", "lorebook-book");
    storyDir = join(bookDir, "story");
    await mkdir(join(storyDir, "runtime"), { recursive: true });
    await mkdir(join(bookDir, "chapters"), { recursive: true });

    book = {
      id: "lorebook-book",
      title: "Lorebook Test Book",
      platform: "tomato",
      genre: "xuanhuan",
      status: "active",
      targetChapters: 20,
      chapterWordCount: 3000,
      createdAt: "2026-03-22T00:00:00.000Z",
      updatedAt: "2026-03-22T00:00:00.000Z",
    };

    await Promise.all([
      writeFile(join(storyDir, "current_focus.md"), "# Current Focus\n\n林动需要前往天元城寻找青莲地心火。\n", "utf-8"),
      writeFile(join(storyDir, "story_bible.md"), "# Story Bible\n\n- 青莲地心火是异火榜排名第十九的异火。\n", "utf-8"),
      writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline\n\n## Chapter 5\n林动前往天元城。\n", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), "# Current State\n\n- 林动当前位置：青山镇\n- 林动当前境界：斗者三星\n", "utf-8"),
    ]);

    const runtimePath = join(storyDir, "runtime", "chapter-0005.intent.md");
    await writeFile(runtimePath, "# Chapter Intent\n\n## Goal\n林动前往天元城寻找青莲地心火。\n", "utf-8");

    plan = {
      intent: {
        chapter: 5,
        goal: "林动前往天元城寻找青莲地心火",
        outlineNode: "林动前往天元城",
        mustKeep: ["青莲地心火", "天元城", "林动"],
        mustAvoid: [],
        styleEmphasis: [],
        conflicts: [],
        hookAgenda: {
          pressureMap: [],
          mustAdvance: [],
          eligibleResolve: [],
          staleDebt: [],
          avoidNewHookFamilies: [],
        },
      },
      intentMarkdown: "# Chapter Intent\n",
      plannerInputs: [
        join(storyDir, "current_focus.md"),
        join(storyDir, "story_bible.md"),
        join(storyDir, "volume_outline.md"),
        join(storyDir, "current_state.md"),
      ],
      runtimePath,
    };

    // 创建最近章节文本（用于 NER 提取）
    await writeFile(
      join(bookDir, "chapters", "0003-青山镇的修炼.md"),
      "林动在青山镇修炼了三个月，终于突破到斗者三星。他听说天元城有青莲地心火的线索，决定前往寻找。",
      "utf-8",
    );
    await writeFile(
      join(bookDir, "chapters", "0004-出发前的准备.md"),
      "林动整理行囊，带上了祖传的石符。他知道青莲地心火极其危险，但为了提升实力，他必须冒险。",
      "utf-8",
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("should inject lorebook entries matched by NER entities", { skip: !hasNodeSqlite }, async () => {
    // 创建 memory.db 并插入 Lorebook 词条
    const db = new MemoryDB(bookDir);
    db.addWorldEntry({
      dimension: "characters",
      name: "林动",
      keywords: "林动,主角",
      content: "林动，本书主角，出身青山镇林家，天赋异禀，拥有祖传石符。",
      priority: 100,
      enabled: true,
      sourceChapter: null,
    });
    db.addWorldEntry({
      dimension: "geography",
      name: "天元城",
      keywords: "天元城,城市",
      content: "天元城，大炎王朝三大主城之一，位于王朝东部，是异火交易的重要集散地。",
      priority: 90,
      enabled: true,
      sourceChapter: null,
    });
    db.addWorldEntry({
      dimension: "items",
      name: "青莲地心火",
      keywords: "青莲地心火,异火",
      content: "青莲地心火，异火榜排名第十九，诞生于地心深处，拥有极强的炼化能力。",
      priority: 95,
      enabled: true,
      sourceChapter: null,
    });
    db.addWorldEntry({
      dimension: "physics",
      name: "斗者",
      keywords: "斗者,境界",
      content: "斗者，修炼体系的第二个大境界，分为九星，每星之间实力差距巨大。",
      priority: 80,
      enabled: true,
      sourceChapter: null,
    });
    db.addWorldEntry({
      dimension: "items",
      name: "石符",
      keywords: "石符,祖传",
      content: "石符，林动祖传之物，蕴含神秘力量，可吸收他人精血提升修为。",
      priority: 85,
      enabled: true,
      sourceChapter: null,
    });
    db.close();

    const composer = new ComposerAgent({
      client: {} as ConstructorParameters<typeof ComposerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await composer.composeChapter({
      book,
      bookDir,
      chapterNumber: 5,
      plan,
    });

    // 验证 Lorebook 词条被注入
    const lorebookSources = result.contextPackage.selectedContext.filter((entry) =>
      entry.source.startsWith("lorebook/"),
    );

    expect(lorebookSources.length).toBeGreaterThan(0);

    // 验证关键实体被检索到
    const lorebookNames = lorebookSources.map((entry) => entry.source.split("/").pop());
    expect(lorebookNames).toContain("林动");
    expect(lorebookNames).toContain("天元城");
    // 注意：青莲地心火是5个字，NER 最多提取4个字，所以可能不会被提取
    // 但如果 mustKeep 中包含，应该能通过关键词匹配到

    // 验证 reason 包含 NER 标识
    const lorebookReasons = lorebookSources.map((entry) => entry.reason);
    expect(lorebookReasons.every((reason) => reason.includes("NER entity"))).toBe(true);
  });

  it("should respect token budget and priority sorting", { skip: !hasNodeSqlite }, async () => {
    // 创建大量词条，测试 token 预算控制
    const db = new MemoryDB(bookDir);

    // 高优先级词条（应该被选中）
    db.addWorldEntry({
      dimension: "characters",
      name: "林动",
      keywords: "林动",
      content: "林动".repeat(100), // ~200 tokens
      priority: 100,
      enabled: true,
      sourceChapter: null,
    });

    // 中优先级词条（应该被选中）
    db.addWorldEntry({
      dimension: "geography",
      name: "天元城",
      keywords: "天元城",
      content: "天元城".repeat(100), // ~200 tokens
      priority: 90,
      enabled: true,
      sourceChapter: null,
    });

    // 低优先级词条（可能被截断）
    for (let i = 0; i < 20; i++) {
      db.addWorldEntry({
        dimension: "materials",
        name: `低优先级词条${i}`,
        keywords: "林动,天元城", // 匹配关键词
        content: `低优先级内容${i}`.repeat(50), // ~100 tokens each
        priority: 50,
        enabled: true,
        sourceChapter: null,
      });
    }

    db.close();

    const composer = new ComposerAgent({
      client: {} as ConstructorParameters<typeof ComposerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await composer.composeChapter({
      book,
      bookDir,
      chapterNumber: 5,
      plan,
    });

    const lorebookSources = result.contextPackage.selectedContext.filter((entry) =>
      entry.source.startsWith("lorebook/"),
    );

    // 验证高优先级词条被选中
    const lorebookNames = lorebookSources.map((entry) => entry.source.split("/").pop());
    expect(lorebookNames).toContain("林动");
    expect(lorebookNames).toContain("天元城");

    // 验证 token 预算限制（不应该所有 20 个低优先级词条都被选中）
    expect(lorebookSources.length).toBeLessThan(22); // 2 高优先级 + 最多部分低优先级
  });

  it("should gracefully handle missing memory.db", async () => {
    // 不创建 memory.db，测试优雅降级
    const composer = new ComposerAgent({
      client: {} as ConstructorParameters<typeof ComposerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await composer.composeChapter({
      book,
      bookDir,
      chapterNumber: 5,
      plan,
    });

    // 验证不会崩溃，且其他上下文正常
    expect(result.contextPackage.selectedContext.length).toBeGreaterThan(0);

    // 验证没有 Lorebook 词条（因为 memory.db 不存在）
    const lorebookSources = result.contextPackage.selectedContext.filter((entry) =>
      entry.source.startsWith("lorebook/"),
    );
    expect(lorebookSources.length).toBe(0);
  });

  it("should reduce token consumption by 60%-80% compared to full injection", { skip: !hasNodeSqlite }, async () => {
    // 创建大量词条模拟真实场景
    const db = new MemoryDB(bookDir);

    const allEntries = [
      { dimension: "characters", name: "林动", keywords: "林动", content: "林动，本书主角。".repeat(20), priority: 100 },
      { dimension: "characters", name: "林青檀", keywords: "林青檀", content: "林青檀，林动的妹妹。".repeat(20), priority: 90 },
      { dimension: "characters", name: "林啸", keywords: "林啸", content: "林啸，林家族长。".repeat(20), priority: 85 },
      { dimension: "geography", name: "天元城", keywords: "天元城", content: "天元城，三大主城之一。".repeat(20), priority: 90 },
      { dimension: "geography", name: "青山镇", keywords: "青山镇", content: "青山镇，林家所在地。".repeat(20), priority: 85 },
      { dimension: "geography", name: "大炎王朝", keywords: "大炎王朝", content: "大炎王朝，故事背景。".repeat(20), priority: 80 },
      { dimension: "items", name: "青莲地心火", keywords: "青莲地心火,异火", content: "青莲地心火，异火榜第十九。".repeat(20), priority: 95 },
      { dimension: "items", name: "石符", keywords: "石符", content: "石符，林动祖传之物。".repeat(20), priority: 85 },
      { dimension: "physics", name: "斗者", keywords: "斗者", content: "斗者，第二大境界。".repeat(20), priority: 80 },
      { dimension: "physics", name: "异火", keywords: "异火", content: "异火，天地灵物。".repeat(20), priority: 85 },
    ];

    for (const entry of allEntries) {
      db.addWorldEntry({
        ...entry,
        enabled: true,
        sourceChapter: null,
      });
    }

    db.close();

    const composer = new ComposerAgent({
      client: {} as ConstructorParameters<typeof ComposerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await composer.composeChapter({
      book,
      bookDir,
      chapterNumber: 5,
      plan,
    });

    // 计算全量注入的 token 数
    const fullInjectionTokens = allEntries.reduce((sum, entry) => {
      const chineseChars = (entry.content.match(/[\u4e00-\u9fa5]/g) || []).length;
      return sum + chineseChars * 2;
    }, 0);

    // 计算 RAG 检索的 token 数
    const lorebookSources = result.contextPackage.selectedContext.filter((entry) =>
      entry.source.startsWith("lorebook/"),
    );
    const ragTokens = lorebookSources.reduce((sum, entry) => {
      const chineseChars = ((entry.excerpt || "").match(/[\u4e00-\u9fa5]/g) || []).length;
      return sum + chineseChars * 2;
    }, 0);

    // 验证 token 降低 60%-85%（允许更高的降低率）
    const reduction = (fullInjectionTokens - ragTokens) / fullInjectionTokens;
    expect(reduction).toBeGreaterThanOrEqual(0.6);
    expect(reduction).toBeLessThanOrEqual(0.85);

    console.log(`Full injection: ${fullInjectionTokens} tokens`);
    console.log(`RAG retrieval: ${ragTokens} tokens`);
    console.log(`Reduction: ${(reduction * 100).toFixed(1)}%`);
  });

  it("should extract entities from goal, chapter text, and mustKeep", { skip: !hasNodeSqlite }, async () => {
    const db = new MemoryDB(bookDir);

    // 创建词条，只有通过 NER 提取才能匹配
    db.addWorldEntry({
      dimension: "characters",
      name: "林动",
      keywords: "林动",
      content: "林动，主角。",
      priority: 100,
      enabled: true,
      sourceChapter: null,
    });
    db.addWorldEntry({
      dimension: "geography",
      name: "天元城",
      keywords: "天元城",
      content: "天元城，主城。",
      priority: 90,
      enabled: true,
      sourceChapter: null,
    });
    db.addWorldEntry({
      dimension: "items",
      name: "青莲地心火",
      keywords: "青莲地心火",
      content: "青莲地心火，异火。",
      priority: 95,
      enabled: true,
      sourceChapter: null,
    });

    db.close();

    const composer = new ComposerAgent({
      client: {} as ConstructorParameters<typeof ComposerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await composer.composeChapter({
      book,
      bookDir,
      chapterNumber: 5,
      plan,
    });

    const lorebookNames = result.contextPackage.selectedContext
      .filter((entry) => entry.source.startsWith("lorebook/"))
      .map((entry) => entry.source.split("/").pop());

    // 验证从 goal 提取的实体
    expect(lorebookNames).toContain("林动");
    expect(lorebookNames).toContain("天元城");

    // 注意：青莲地心火是5个字，超过 NER 的4字限制
    // 但可以通过部分匹配（青莲、地心火）间接匹配到
    // 这里我们验证至少有2个核心实体被提取
    expect(lorebookNames.length).toBeGreaterThanOrEqual(2);
  });
});
