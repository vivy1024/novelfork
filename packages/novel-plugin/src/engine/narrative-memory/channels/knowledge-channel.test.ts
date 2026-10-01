/**
 * 知情边界通道：出场角色的「现状 + 写作禁忌」注入写作上下文。
 *
 * 本组测试盯住：
 * 1. 内容：现状取状态流水最新值，禁忌取「他不在场」的已确认事实；注入带派生来源标注；
 * 2. 可见章：写第 N 章只能看到第 N-1 章及之前；
 * 3. 归并：别名 → 同一实体；非 character 实体不出卡；归并不到实体不出卡；
 * 4. 预算：实体数 / 每实体现状 / 每实体禁忌三档通道内自裁，超通道打包预算时被全局裁剪。
 */

import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { createBookRepository } from "../../jingwei/repositories/book-repo.js";
import { createStoryJingweiEntryRepository } from "../../jingwei/repositories/entry-repo.js";
import { createStoryJingweiSectionRepository } from "../../jingwei/repositories/section-repo.js";
import { rebuildNarrativeEntityIndex } from "../../narrative-entity/entity-index.js";
import { packNarrativeContext } from "../budget.js";
import { ensureNarrativeMemorySchema } from "../storage.js";
import type { NarrativeContextCard } from "../types.js";
import { createKnowledgeChannel } from "./knowledge-channel.js";

let storage: StorageDatabase;
let tempDir: string;
const now = new Date("2026-09-01T00:00:00.000Z");
const iso = now.toISOString();

beforeEach(async () => {
  tempDir = join(tmpdir(), `novelfork-knowledge-channel-${crypto.randomUUID()}`);
  await mkdir(tempDir, { recursive: true });
  storage = createStorageDatabase({ databasePath: join(tempDir, "novelfork.db") });
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
  ensureNarrativeMemorySchema(storage);
  await createBookRepository(storage).create({ id: "book-1", name: "知情通道", jingweiMode: "dynamic", currentChapter: 1, createdAt: now, updatedAt: now });
  await createStoryJingweiSectionRepository(storage).create({
    id: "sec-characters", bookId: "book-1", key: "characters", name: "角色", description: "", icon: null, order: 0, enabled: true,
    showInSidebar: true, participatesInAi: true, defaultVisibility: "tracked", fieldsJson: [], builtinKind: "characters",
    sourceTemplate: null, createdAt: now, updatedAt: now,
  });
  await createStoryJingweiSectionRepository(storage).create({
    id: "sec-locations", bookId: "book-1", key: "locations", name: "地点", description: "", icon: null, order: 1, enabled: true,
    showInSidebar: true, participatesInAi: true, defaultVisibility: "tracked", fieldsJson: [], builtinKind: "locations",
    sourceTemplate: null, createdAt: now, updatedAt: now,
  });
});

afterEach(async () => {
  storage.close();
  await rm(tempDir, { recursive: true, force: true });
});

async function entry(title: string, category: string, aliases: string[] = []): Promise<string> {
  const created = await createStoryJingweiEntryRepository(storage).create({
    id: crypto.randomUUID(), bookId: "book-1", sectionId: `sec-${category}`, title, contentMd: "", category,
    fields: {}, customFields: {}, tags: [], aliases, relatedChapterNumbers: [], relatedEntryIds: [],
    visibilityRule: { type: "tracked" }, participatesInAi: true, tokenBudget: null, layer: "dynamic",
    status: "confirmed", createdAt: now, updatedAt: now,
  });
  return created.id;
}

function event(id: string, chapter: number, subject: string, object: string) {
  storage.sqlite.prepare(`
    INSERT INTO narrative_event (id, book_id, chapter_number, event_type, subject, predicate, object, evidence_text,
      confidence, source, status, risk_level, subject_entry_id, object_entry_id, created_at)
    VALUES (?, 'book-1', ?, 'character_state_changed', ?, '变化', ?, '证据', 0.9, 'settle', 'applied', 'low', NULL, NULL, ?)
  `).run(id, chapter, subject, object, iso);
}

function fact(id: string, subject: string, predicate: string, object: string, category: string, chapter: number, sourceId: string | null = null) {
  storage.sqlite.prepare(`
    INSERT INTO narrative_fact (id, book_id, subject, predicate, object, category, layer, confidence, source_type,
      source_id, source_chapter, evidence_text, valid_from_chapter, valid_until_chapter, created_at, updated_at)
    VALUES (?, 'book-1', ?, ?, ?, ?, 'dynamic', 0.85, ?, ?, ?, ?, ?, NULL, ?, ?)
  `).run(id, subject, predicate, object, category, sourceId ? "event" : "manual", sourceId, chapter, `证据-${id}`, chapter, iso, iso);
}

async function seed(): Promise<void> {
  await entry("薛行之", "characters", ["薛小爷"]);
  await entry("方工", "characters");
  await entry("沈遥", "characters");
  await entry("青云山", "locations");
  event("ev-1", 3, "薛行之", "筑基");
  fact("f-state-1", "薛行之", "境界", "筑基", "character_state", 3, "ev-1");
  fact("f-state-2", "薛行之", "位置", "青云山", "location", 4);
  fact("f-secret-1", "方工", "身份", "内鬼", "world_fact", 5);
  fact("f-rel-1", "沈遥与方工", "决裂", "两人翻脸", "relationship", 6);
  fact("f-later", "沈遥", "境界", "金丹", "character_state", 20);
  rebuildNarrativeEntityIndex(storage, "book-1");
}

async function runChannel(input: Parameters<ReturnType<typeof createKnowledgeChannel>["run"]>[0]) {
  return createKnowledgeChannel().run(input);
}

describe("knowledge channel 内容", () => {
  it("注入现状与禁忌；标注派生来源；别名归并为同一张卡", async () => {
    await seed();
    const result = await runChannel({ storage, bookId: "book-1", currentChapter: 10, entities: ["薛小爷", "薛行之"] });

    expect(result.status).not.toBe("skipped");
    expect(result.cards).toHaveLength(1);
    const card = result.cards[0]!;
    expect(card.channel).toBe("knowledge");
    expect(card.title).toBe("知情边界：薛行之");
    expect(card.content).toContain("境界：筑基");
    expect(card.content).toContain("位置：青云山");
    expect(card.content).toContain("写作禁忌");
    expect(card.content).toContain("方工 · 身份 → 内鬼");
    expect(card.content).toContain("沈遥与方工 · 决裂");
    expect(card.reason).toContain("narrative_knowledge");
    expect(card.reason).toContain("不是作者手填设定");
    expect(card.tags).toContain("derived");
    // 第 20 章的事实对第 10 章写作不可见
    expect(card.content).not.toContain("金丹");
  });

  it("可见章与 state 通道同规则：写第 N 章只看到第 N-1 章", async () => {
    await seed();
    const at4 = await runChannel({ storage, bookId: "book-1", currentChapter: 4, entities: ["薛行之"] });
    // 能看见第 3 章的境界，看不见第 4 章的位置
    expect(at4.cards[0]!.content).toContain("境界：筑基");
    expect(at4.cards[0]!.content).not.toContain("青云山");

    const latest = await runChannel({ storage, bookId: "book-1", entities: ["薛行之"] });
    expect(latest.cards[0]!.content).toContain("位置：青云山");
  });

  it("非 character 实体与归并不到的名字不出卡", async () => {
    await seed();
    const result = await runChannel({ storage, bookId: "book-1", currentChapter: 10, entities: ["青云山", "不存在的人"] });
    expect(result.status).toBe("skipped");
    expect(result.cards).toHaveLength(0);
  });

  it("没有流水的实体靠「他不在场」反推也有禁忌卡", async () => {
    await seed();
    // 沈遥第 4 章没有自己的状态流水，但第 3 章「薛行之筑基」他不在场——他知道不了这件事
    const result = await runChannel({ storage, bookId: "book-1", currentChapter: 4, entities: ["沈遥"] });
    expect(result.status ?? "ok").toBe("ok");
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]!.title).toBe("知情边界：沈遥");
    expect(result.cards[0]!.content).toContain("薛行之 · 境界 → 筑基");
    expect(result.cards[0]!.content).not.toContain("现状");
  });
});

describe("knowledge channel 预算与裁剪", () => {
  it("实体上限：超出名单按顺序截断并告警", async () => {
    await seed();
    const result = await runChannel({ storage, bookId: "book-1", currentChapter: 21, entities: ["薛行之", "方工", "沈遥"], maxEntities: 2 });
    expect(result.cards.length).toBeLessThanOrEqual(2);
    const names = result.cards.map((card) => card.title.replace("知情边界：", ""));
    expect(names).not.toContain("沈遥");
    expect(result.warnings?.some((warning) => warning.includes("沈遥"))).toBe(true);
    expect(result.diagnostics?.droppedForEntityCap).toEqual(["沈遥"]);
  });

  it("每实体现状与禁忌限条数", async () => {
    await entry("多窍", "characters");
    for (let i = 1; i <= 6; i += 1) {
      fact(`f-duoqia-${i}`, "多窍", `方面${i}`, `值${i}`, "character_state", i);
    }
    for (let i = 1; i <= 5; i += 1) {
      fact(`f-secret-${i}`, "方工", `秘事${i}`, `第${i}桩`, "world_fact", i);
    }
    rebuildNarrativeEntityIndex(storage, "book-1");

    const result = await runChannel({ storage, bookId: "book-1", currentChapter: 21, entities: ["多窍"], statePerEntity: 2, unawarePerEntity: 1 });
    const card = result.cards[0]!;
    const stateLines = card.content.split("\n").filter((line) => /^- 方面/u.test(line));
    expect(stateLines).toHaveLength(2);
    // 状态流水按章取最新：第 6、5 章的在前
    expect(stateLines[0]).toContain("方面6");
    expect(stateLines[1]).toContain("方面5");
    const unawareLines = card.content.split("\n").filter((line) => /秘事/u.test(line));
    expect(unawareLines).toHaveLength(1);
    expect(unawareLines[0]).toContain("秘事5");
    expect(result.diagnostics?.caps).toEqual({ maxEntities: 6, statePerEntity: 2, unawarePerEntity: 1 });
  });

  it("全局打包：knowledge 卡片算入 knowledge 通道预算，超通道预算时被裁剪", async () => {
    const fat = (id: string, tokens: number): NarrativeContextCard => ({
      id,
      bookId: "book-1",
      sourceType: "fact",
      sourceId: id,
      channel: "knowledge",
      title: id,
      content: "密".repeat(tokens * 4),
      brief: id,
      tags: ["knowledge-boundary"],
      entities: [],
      priority: 60,
      importance: 65,
      accessCount: 0,
      reason: "test",
      estimatedTokens: tokens,
    });
    // 通道默认预算 1000：三张 500 token 的卫星卡走「先降级再丢卡」策略，全量被降格后注入仍在预算内
    const budget = packNarrativeContext([fat("k1", 500), fat("k2", 500), fat("k3", 500)]);
    expect(budget.channelBudgets.knowledge).toBe(1000);
    expect(budget.injectedTokensByChannel.knowledge).toBeLessThanOrEqual(1000);
    expect(budget.degradedCards.length + budget.droppedCards.length).toBeGreaterThanOrEqual(1);
  });
});
