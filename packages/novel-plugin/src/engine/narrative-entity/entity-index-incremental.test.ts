/**
 * 增量推导与整本推导的逐行等价性（每章结算默认按本章增量推导）。
 *
 * 判定口径：每章结算后，原库六张索引表的全部行（去掉写入时刻列、排序后）与「同一时刻的库副本上整本重建」
 * 完全相同；统计（称呼计数、未归并样例、撞名条目）与整本推导相同；并核对这一章确实走了预期的路径——
 * 否则「每次都回退整本」也能通过比对。
 */
import { copyFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let activeStorage: StorageDatabase | undefined;

// memory.update / memory.delete / 事件审批走 getStorageDatabase()；其余导出保持真实实现
vi.mock("@vivy1024/novelfork-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vivy1024/novelfork-core")>();
  return {
    ...actual,
    getStorageDatabase: () => {
      if (!activeStorage) throw new Error("test storage not initialized");
      return activeStorage;
    },
  };
});

const { settleConfirmedChapter } = await import("../../handlers/chapter-settlement-service.js");
const { handleMemoryDelete, handleMemoryUpdate } = await import("../../handlers/memory-admin-handlers.js");
const { handleMemoryEvents } = await import("../../handlers/lore-memory-boundary-handlers.js");
const { createBookRepository } = await import("../jingwei/repositories/book-repo.js");
const { createStoryJingweiEntryRepository } = await import("../jingwei/repositories/entry-repo.js");
const { createStoryJingweiSectionRepository } = await import("../jingwei/repositories/section-repo.js");
const { ensureNarrativeMemorySchema, restoreTrashedNarrativeEvents, trashPendingNarrativeEvents } = await import("../narrative-memory/storage.js");
const { lastEntityIndexRefresh, planNarrativeEntityIndex, rebuildNarrativeEntityIndex, refreshNarrativeEntityIndex } = await import("./entity-index.js");

const BOOK = "book-1";
const INDEX_TABLES = [
  "narrative_entity",
  "narrative_entity_alias",
  "narrative_event_participant",
  "narrative_relation",
  "narrative_state_change",
  "narrative_knowledge",
] as const;
const WRITE_TIME_COLUMNS = new Set(["created_at", "updated_at", "recorded_at"]);

let storage: StorageDatabase;
let tempDir: string;
let databasePath: string;
const now = new Date("2026-10-01T00:00:00.000Z");

async function setupBook(db: StorageDatabase, bookId = BOOK) {
  await createBookRepository(db).create({ id: bookId, name: "增量等价", jingweiMode: "dynamic", currentChapter: 1, createdAt: now, updatedAt: now });
  let order = 0;
  for (const key of ["characters", "locations", "props", "foreshadowing"]) {
    await createStoryJingweiSectionRepository(db).create({
      id: `${bookId}-sec-${key}`, bookId, key, name: key, description: "", icon: null, order: order++, enabled: true,
      showInSidebar: true, participatesInAi: true, defaultVisibility: "tracked", fieldsJson: [], builtinKind: key,
      sourceTemplate: null, createdAt: now, updatedAt: now,
    });
  }
}

async function entry(title: string, category: string, aliases: string[] = []) {
  return createStoryJingweiEntryRepository(storage).create({
    id: crypto.randomUUID(), bookId: BOOK, sectionId: `${BOOK}-sec-${category}`, title, contentMd: "", category,
    fields: {}, customFields: {}, tags: [], aliases, relatedChapterNumbers: [], relatedEntryIds: [],
    visibilityRule: { type: "tracked" }, participatesInAi: true, tokenBudget: null, layer: "dynamic",
    status: "confirmed", createdAt: now, updatedAt: now,
  });
}

function indexRows(db: StorageDatabase): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const table of INDEX_TABLES) {
    out[table] = db.sqlite.prepare<Record<string, unknown>>(`SELECT * FROM ${table} WHERE book_id = ?`).all(BOOK)
      .map((row) => JSON.stringify(Object.fromEntries(Object.entries(row).filter(([column]) => !WRITE_TIME_COLUMNS.has(column)).sort(([a], [b]) => a.localeCompare(b)))))
      .sort();
  }
  return out;
}

/** 当前库的完整副本上整本重建，返回其索引行。 */
async function rebuiltReference(): Promise<Record<string, string[]>> {
  storage.checkpoint();
  const copyPath = join(tempDir, `reference-${crypto.randomUUID()}.db`);
  await copyFile(databasePath, copyPath);
  const copy = createStorageDatabase({ databasePath: copyPath });
  try {
    expect(rebuildNarrativeEntityIndex(copy, BOOK, { now: 1 }).ok).toBe(true);
    return indexRows(copy);
  } finally {
    copy.close();
    await rm(copyPath, { force: true });
  }
}

type Path = "incremental" | "full";

/** 逐行比对 + 统计比对 + 路径核对。 */
async function expectEquivalent(label: string, expectedPath: Path, expectedReason?: string) {
  const last = lastEntityIndexRefresh(storage, BOOK);
  expect(last, `${label}：有刷新记录`).not.toBeNull();
  expect(last!.derivation.mode, `${label}：推导路径（回退原因 ${last!.derivation.fallbackReason ?? "无"}）`).toBe(expectedPath);
  if (expectedReason) expect(last!.derivation.fallbackReason, `${label}：回退原因`).toBe(expectedReason);
  const reference = await rebuiltReference();
  const actual = indexRows(storage);
  for (const table of INDEX_TABLES) expect(actual[table], `${label}：${table}`).toEqual(reference[table]);
  expect(reference.narrative_entity!.length, `${label}：实体数`).toBeGreaterThan(0);
  expect(last!.stats, `${label}：统计`).toEqual(planNarrativeEntityIndex(storage, BOOK).stats);
}

type Draft = Readonly<{ eventType: string; subject: string; predicate: string; object: string; confidence?: number }>;

async function settle(chapterNumber: number, drafts: readonly Draft[], extra: string[] = []) {
  const content = [`第${chapterNumber}章`, ...drafts.map((draft) => `${draft.subject}${draft.predicate}${draft.object}`), ...extra].join("\n");
  const result = await settleConfirmedChapter({ bookId: BOOK, chapterNumber, title: `第${chapterNumber}章`, content }, {
    storage,
    llmExtractor: async () => drafts.map((draft) => ({
      ...draft,
      evidenceText: `${draft.subject}${draft.predicate}${draft.object}`,
      confidence: draft.confidence ?? 0.9,
      source: "settle",
    })),
  });
  expect(result.status, `第${chapterNumber}章结算`).toBe("completed");
  expect(result.warnings.some((warning) => warning.startsWith("实体索引未更新")), `第${chapterNumber}章实体索引`).toBe(false);
  return result;
}

function pendingEventIds(chapterNumber?: number): string[] {
  return storage.sqlite
    .prepare<{ id: string }>(`SELECT id FROM narrative_event WHERE book_id = ? AND status = 'pending' ${chapterNumber === undefined ? "" : "AND chapter_number = ?"} ORDER BY id`)
    .all(...[BOOK, ...(chapterNumber === undefined ? [] : [chapterNumber])])
    .map((row) => row.id);
}

async function approveAll(chapterNumber?: number) {
  for (const id of pendingEventIds(chapterNumber)) {
    expect((await handleMemoryEvents({ bookId: BOOK, action: "approve", eventId: id, reason: "确认" } as never)).ok).toBe(true);
  }
}

beforeEach(async () => {
  tempDir = join(tmpdir(), `novelfork-entity-incremental-${crypto.randomUUID()}`);
  await mkdir(tempDir, { recursive: true });
  databasePath = join(tempDir, "novelfork.db");
  storage = createStorageDatabase({ databasePath });
  activeStorage = storage;
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
  ensureNarrativeMemorySchema(storage);
  await setupBook(storage);
});

afterEach(async () => {
  activeStorage = undefined;
  storage.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe("实体索引增量推导与整本推导逐行一致", () => {
  it("逐章结算覆盖：新实体出现、别名归并、关系有效期截断、状态流水、复合主体、未归并只报告、同名条目、伏笔草稿", async () => {
    await entry("薛行之（主角）", "characters", ["薛小爷"]);
    await entry("方工", "characters");
    await entry("林舟", "characters");
    await entry("沈青", "characters");
    await entry("顾长风", "characters");
    // 同名条目：剥括号后与「沈青」撞名，不进索引、如实报告
    await entry("沈青（重名）", "characters");
    await entry("青云山", "locations");
    await entry("药园", "locations");
    await entry("铜戒指", "props");
    await entry("小瓶", "foreshadowing");

    // 第 1 章：首次结算（之前没有推导状态 → 整本）；别名归并、状态、位置
    await settle(1, [
      { eventType: "location_changed", subject: "薛行之", predicate: "抵达", object: "青云山" },
      { eventType: "character_state_changed", subject: "薛小爷", predicate: "境界", object: "炼气" },
      { eventType: "relationship_changed", subject: "薛行之与方工", predicate: "结盟", object: "林舟" },
    ]);
    await expectEquivalent("第1章", "full", "no-state");

    // 第 2 章：状态流水（同槽位新值）、位置变化、未归并称呼、复合主体（三人）
    await settle(2, [
      { eventType: "character_state_changed", subject: "薛行之", predicate: "境界", object: "筑基" },
      { eventType: "location_changed", subject: "薛行之", predicate: "抵达", object: "药园" },
      { eventType: "character_state_changed", subject: "路人甲", predicate: "伤势", object: "轻伤" },
      { eventType: "relationship_changed", subject: "沈青、林舟与方工", predicate: "同行", object: "青云山" },
    ]);
    await expectEquivalent("第2章", "incremental");

    // 两章之间批准全部关系事件：事件变 applied、生成关系事实（审批路径，结算之外的写入）
    await approveAll();
    refreshNarrativeEntityIndex(storage, BOOK);
    await expectEquivalent("批准关系事件后", "incremental");

    // 第 3 章：新实体首次出场（顾长风此前从未出现）、未归并称呼再出现、事件短语
    await settle(3, [
      { eventType: "location_changed", subject: "顾长风", predicate: "抵达", object: "青云山" },
      { eventType: "character_state_changed", subject: "路人乙", predicate: "伤势", object: "重伤" },
      { eventType: "character_state_changed", subject: "故事主线时间", predicate: "推进", object: "入夜" },
    ]);
    await expectEquivalent("第3章（新实体首次出场）", "incremental");

    // 第 4 章：关系有效期截断——同一关系槽位在后面的章再次确认，旧关系事实被关掉（valid_until 写入）
    await settle(4, [
      { eventType: "relationship_changed", subject: "薛行之与方工", predicate: "结盟", object: "林舟" },
      { eventType: "relationship_changed", subject: "顾长风", predicate: "敌对", object: "薛行之" },
    ]);
    await expectEquivalent("第4章", "incremental");
    await approveAll(4);
    refreshNarrativeEntityIndex(storage, BOOK);
    await expectEquivalent("第4章关系批准（旧关系截断）", "incremental");
    const closed = storage.sqlite.prepare<{ n: number }>(
      "SELECT COUNT(*) AS n FROM narrative_relation WHERE book_id = ? AND predicate = '结盟' AND valid_to IS NOT NULL",
    ).get(BOOK)!.n;
    expect(closed, "旧「结盟」关系边带上了结束章").toBeGreaterThan(0);

    // 第 5 章：埋下设定里没有的新伏笔 → 写成待审伏笔草稿 → 实体字典变了 → 整本推导
    await settle(5, [
      { eventType: "hook_planted", subject: "古井异响", predicate: "埋设", object: "井底有光" },
      { eventType: "character_state_changed", subject: "方工", predicate: "伤势", object: "重伤" },
    ]);
    const draftCount = storage.sqlite.prepare<{ n: number }>(
      "SELECT COUNT(*) AS n FROM story_jingwei_entry WHERE book_id = ? AND category = 'foreshadowing' AND deleted_at IS NULL",
    ).get(BOOK)!.n;
    expect(draftCount, "新伏笔草稿已写入").toBe(2);
    await expectEquivalent("第5章（新伏笔草稿）", "full", "dictionary-changed");

    // 第 6 章：伏笔称呼计数（不进链接率分母）、字典稳定后回到增量
    await settle(6, [
      { eventType: "hook_progressed", subject: "古井异响", predicate: "推进", object: "有人下井" },
      { eventType: "hook_progressed", subject: "小瓶", predicate: "推进", object: "瓶身发烫" },
      { eventType: "character_state_changed", subject: "林舟", predicate: "境界", object: "炼气" },
    ]);
    await expectEquivalent("第6章", "incremental");

    // 结算之间：改一条事实的主体、删一条事件、待审事件进回收站再恢复
    const someFact = storage.sqlite.prepare<{ id: string }>("SELECT id FROM narrative_fact WHERE book_id = ? AND category = 'character_state' ORDER BY id LIMIT 1").get(BOOK)!;
    expect((await handleMemoryUpdate({ bookId: BOOK, kind: "fact", id: someFact.id, reason: "改主体", patch: { subject: "顾长风" } })).ok).toBe(true);
    const doomed = storage.sqlite.prepare<{ id: string }>("SELECT id FROM narrative_event WHERE book_id = ? AND chapter_number = 1 AND event_type = 'location_changed'").get(BOOK)!.id;
    expect((await handleMemoryDelete({ bookId: BOOK, kind: "event", id: doomed, reason: "误抽" })).ok).toBe(true);
    await settle(7, [{ eventType: "relationship_changed", subject: "方工", predicate: "师徒", object: "沈青", confidence: 0.5 }]);
    await expectEquivalent("第7章（追上改事实 / 删事件）", "incremental");
    const trashable = pendingEventIds(7);
    expect(trashable.length).toBe(1);
    expect(trashPendingNarrativeEvents(storage, { bookId: BOOK, eventIds: trashable, reason: "暂不处理" }).trashed).toEqual(trashable);
    await settle(8, [{ eventType: "location_changed", subject: "林舟", predicate: "抵达", object: "药园" }]);
    await expectEquivalent("第8章（事件进回收站）", "incremental");
    expect(restoreTrashedNarrativeEvents(storage, { bookId: BOOK, eventIds: trashable }).restored).toEqual(trashable);
    await settle(9, [{ eventType: "character_state_changed", subject: "沈青", predicate: "境界", object: "金丹" }]);
    await expectEquivalent("第9章（事件恢复）", "incremental");

    // 改写重结算：调用方要求整本
    await settle(9, [{ eventType: "character_state_changed", subject: "沈青", predicate: "境界", object: "元婴" }], ["改写"]);
    await expectEquivalent("第9章改写重结算", "full", "requested");

    // 经纬改名 + 加别名：字典变了，整本
    const fang = storage.sqlite.prepare<{ id: string }>("SELECT id FROM story_jingwei_entry WHERE book_id = ? AND title = '方工'").get(BOOK)!;
    await createStoryJingweiEntryRepository(storage).update(BOOK, fang.id, { title: "方岩", aliases: ["方工"] });
    await settle(10, [{ eventType: "relationship_changed", subject: "方工", predicate: "和解", object: "顾长风" }]);
    await expectEquivalent("第10章（改名）", "full", "dictionary-changed");
    await settle(11, [{ eventType: "location_changed", subject: "方岩", predicate: "抵达", object: "青云山" }]);
    await expectEquivalent("第11章", "incremental");
  }, 120_000);

  it("确定性随机的 30 章：每章增量都与整本一致，章间穿插批准、驳回、删事件、改事实", async () => {
    const characters = Array.from({ length: 12 }, (_, i) => `角色${i}`);
    const places = ["城东", "城西", "后山", "渡口"];
    for (const [i, name] of characters.entries()) await entry(i % 4 === 0 ? `${name}（要角）` : name, "characters", [`阿${i}`]);
    for (const place of places) await entry(place, "locations");
    await entry("旧案", "foreshadowing");

    let seed = 7;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x1_0000_0000;
    };
    const pick = <T,>(list: readonly T[]) => list[Math.floor(random() * list.length)]!;
    const nameOf = () => {
      const roll = random();
      if (roll < 0.15) return `阿${Math.floor(random() * characters.length)}`;
      if (roll < 0.25) return `${pick(characters)}与${pick(characters)}`;
      if (roll < 0.3) return `过客${Math.floor(random() * 5)}`;
      return pick(characters);
    };

    for (let chapter = 1; chapter <= 30; chapter += 1) {
      const drafts: Draft[] = [];
      for (let k = 0; k < 4; k += 1) {
        const kind = Math.floor(random() * 4);
        if (kind === 0) drafts.push({ eventType: "relationship_changed", subject: nameOf(), predicate: pick(["结盟", "敌对", "师徒"]), object: pick(characters) });
        else if (kind === 1) drafts.push({ eventType: "location_changed", subject: nameOf(), predicate: "抵达", object: pick(places) });
        else if (kind === 2) drafts.push({ eventType: "character_state_changed", subject: nameOf(), predicate: pick(["境界", "伤势"]), object: `第${chapter % 5}层`, confidence: random() < 0.2 ? 0.5 : 0.9 });
        else drafts.push({ eventType: "hook_progressed", subject: "旧案", predicate: "推进", object: `线索${chapter}` });
      }
      await settle(chapter, drafts);
      await expectEquivalent(`随机第${chapter}章`, chapter === 1 ? "full" : "incremental");

      // 章间的结算外写入
      const pending = pendingEventIds();
      if (pending.length > 0 && random() < 0.6) {
        const id = pick(pending);
        const action = random() < 0.75 ? "approve" : "reject";
        expect((await handleMemoryEvents({ bookId: BOOK, action, eventId: id, reason: "裁决" } as never)).ok).toBe(true);
      }
      if (random() < 0.15) {
        const victim = storage.sqlite.prepare<{ id: string }>("SELECT id FROM narrative_event WHERE book_id = ? ORDER BY id LIMIT 1 OFFSET ?").get(BOOK, Math.floor(random() * 10));
        if (victim) expect((await handleMemoryDelete({ bookId: BOOK, kind: "event", id: victim.id, reason: "清理" })).ok).toBe(true);
      }
      if (random() < 0.15) {
        const fact = storage.sqlite.prepare<{ id: string }>("SELECT id FROM narrative_fact WHERE book_id = ? ORDER BY id LIMIT 1 OFFSET ?").get(BOOK, Math.floor(random() * 10));
        if (fact) expect((await handleMemoryUpdate({ bookId: BOOK, kind: "fact", id: fact.id, reason: "改", patch: { subject: pick(characters), sourceChapter: 1 + Math.floor(random() * chapter) } })).ok).toBe(true);
      }
    }
  }, 300_000);

  it("回退条件：别的连接写过库、外层事务回滚、显式要求整本，回退后结果仍一致，之后恢复增量", async () => {
    await entry("甲", "characters");
    await entry("乙", "characters");
    await settle(1, [{ eventType: "location_changed", subject: "甲", predicate: "抵达", object: "某处" }]);
    await settle(2, [{ eventType: "character_state_changed", subject: "乙", predicate: "伤势", object: "轻伤" }]);
    await expectEquivalent("基线", "incremental");

    // 别的连接写了一条事件：本连接的触发器看不到它，data_version 变化 → 整本
    const other = createStorageDatabase({ databasePath });
    other.sqlite.prepare(`
      INSERT INTO narrative_event (id, book_id, chapter_number, event_type, subject, predicate, object, evidence_text,
        confidence, source, status, risk_level, created_at)
      VALUES ('ev-other', ?, 3, 'character_state_changed', '甲', '境界', '筑基', '证据', 0.9, 'manual', 'applied', 'low', ?)
    `).run(BOOK, now.toISOString());
    other.close();
    refreshNarrativeEntityIndex(storage, BOOK);
    await expectEquivalent("别的连接写过之后", "full", "index-changed");
    await settle(3, [{ eventType: "character_state_changed", subject: "甲", predicate: "伤势", object: "痊愈" }]);
    await expectEquivalent("之后恢复增量", "incremental");

    // 刷新发生在外层事务里，外层回滚：同步令牌随之回滚 → 下次整本
    storage.sqlite.prepare(`
      INSERT INTO narrative_event (id, book_id, chapter_number, event_type, subject, predicate, object, evidence_text,
        confidence, source, status, risk_level, created_at)
      VALUES ('ev-rollback-base', ?, 4, 'character_state_changed', '乙', '境界', '炼气', '证据', 0.9, 'manual', 'applied', 'low', ?)
    `).run(BOOK, now.toISOString());
    expect(() => storage.sqlite.transaction(() => {
      refreshNarrativeEntityIndex(storage, BOOK);
      throw new Error("外层回滚");
    })()).toThrow(/外层回滚/u);
    refreshNarrativeEntityIndex(storage, BOOK);
    // 回滚让索引表指纹或同步令牌对不上，哪个先被发现都行，必须整本
    expect(["index-changed", "sync-marker-missing"]).toContain(lastEntityIndexRefresh(storage, BOOK)!.derivation.fallbackReason);
    await expectEquivalent("外层事务回滚后", "full");

    // 同步令牌单独失效（索引表没变）：外层事务里的刷新没有写任何索引行，然后回滚
    expect(() => storage.sqlite.transaction(() => {
      refreshNarrativeEntityIndex(storage, BOOK);
      throw new Error("外层回滚");
    })()).toThrow(/外层回滚/u);
    refreshNarrativeEntityIndex(storage, BOOK);
    await expectEquivalent("令牌回滚后", "full", "sync-marker-missing");
    refreshNarrativeEntityIndex(storage, BOOK, { incremental: false });
    await expectEquivalent("显式整本", "full", "requested");
    await settle(4, [{ eventType: "location_changed", subject: "乙", predicate: "抵达", object: "别处" }]);
    await expectEquivalent("再次恢复增量", "incremental");

    // 整本重建之后同进程继续增量
    rebuildNarrativeEntityIndex(storage, BOOK);
    await settle(5, [{ eventType: "location_changed", subject: "甲与乙", predicate: "抵达", object: "某处" }]);
    await expectEquivalent("重建之后", "incremental");
  }, 60_000);

  it("增量写回中途失败整体回滚：索引原样保留，下次刷新整本追上", async () => {
    await entry("甲", "characters");
    await entry("乙", "characters");
    await settle(1, [{ eventType: "location_changed", subject: "甲", predicate: "抵达", object: "某处" }]);
    const before = indexRows(storage);
    storage.sqlite.prepare(`
      INSERT INTO narrative_event (id, book_id, chapter_number, event_type, subject, predicate, object, evidence_text,
        confidence, source, status, risk_level, created_at)
      VALUES ('ev-x', ?, 2, 'location_changed', '乙', '抵达', '某处', '证据', 0.9, 'manual', 'applied', 'low', ?)
    `).run(BOOK, now.toISOString());
    storage.sqlite.exec(`
      CREATE TEMP TRIGGER fail_participant BEFORE INSERT ON narrative_event_participant
      WHEN NEW.event_id = 'ev-x' BEGIN SELECT RAISE(ABORT, 'boom'); END;
    `);
    expect(() => refreshNarrativeEntityIndex(storage, BOOK)).toThrow(/boom/u);
    expect(indexRows(storage)).toEqual(before);
    storage.sqlite.exec("DROP TRIGGER fail_participant");
    refreshNarrativeEntityIndex(storage, BOOK);
    await expectEquivalent("回滚后重试", "full");
  });
});
