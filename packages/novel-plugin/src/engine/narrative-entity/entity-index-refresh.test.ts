/**
 * 差量刷新与整本重建的等价性（每章结算走 refreshNarrativeEntityIndex）。
 *
 * 判定口径：六张索引表本书的全部行逐项相同，只忽略「行最后一次写入时刻」三列
 * （created_at / updated_at / recorded_at）——整本重写时全书同一时刻，差量写回时只有变化的行刷新。
 * 对照组：把当前数据库整份复制一份，在副本上跑整本重建，再与原库的差量结果逐行比对。
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
const { rebuildNarrativeEntityIndex, refreshNarrativeEntityIndex } = await import("./entity-index.js");

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
  await createBookRepository(db).create({ id: bookId, name: "等价性", jingweiMode: "dynamic", currentChapter: 1, createdAt: now, updatedAt: now });
  let order = 0;
  for (const key of ["characters", "locations", "props", "foreshadowing"]) {
    await createStoryJingweiSectionRepository(db).create({
      id: `${bookId}-sec-${key}`, bookId, key, name: key, description: "", icon: null, order: order++, enabled: true,
      showInSidebar: true, participatesInAi: true, defaultVisibility: "tracked", fieldsJson: [], builtinKind: key,
      sourceTemplate: null, createdAt: now, updatedAt: now,
    });
  }
}

async function entry(title: string, category: string, aliases: string[] = [], bookId = BOOK) {
  return createStoryJingweiEntryRepository(storage).create({
    id: crypto.randomUUID(), bookId, sectionId: `${bookId}-sec-${category}`, title, contentMd: "", category,
    fields: {}, customFields: {}, tags: [], aliases, relatedChapterNumbers: [], relatedEntryIds: [],
    visibilityRule: { type: "tracked" }, participatesInAi: true, tokenBudget: null, layer: "dynamic",
    status: "confirmed", createdAt: now, updatedAt: now,
  });
}

/** 六张表本书的全部行，去掉写入时刻列后按全列排序，作为可比较的快照。 */
function indexRows(db: StorageDatabase, bookId = BOOK): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const table of INDEX_TABLES) {
    const rows = db.sqlite.prepare<Record<string, unknown>>(`SELECT * FROM ${table} WHERE book_id = ?`).all(bookId);
    out[table] = rows
      .map((row) => JSON.stringify(Object.fromEntries(Object.entries(row).filter(([column]) => !WRITE_TIME_COLUMNS.has(column)).sort(([a], [b]) => a.localeCompare(b)))))
      .sort();
  }
  return out;
}

/** 在当前数据库的一份完整副本上跑整本重建，返回其索引快照。 */
async function rebuiltReference(bookId = BOOK): Promise<Record<string, unknown[]>> {
  storage.checkpoint();
  const copyPath = join(tempDir, `reference-${crypto.randomUUID()}.db`);
  await copyFile(databasePath, copyPath);
  const copy = createStorageDatabase({ databasePath: copyPath });
  try {
    const result = rebuildNarrativeEntityIndex(copy, bookId, { now: 1 });
    expect(result.ok).toBe(true);
    return indexRows(copy, bookId);
  } finally {
    copy.close();
  }
}

async function expectEquivalentToRebuild(label: string, bookId = BOOK) {
  const reference = await rebuiltReference(bookId);
  const actual = indexRows(storage, bookId);
  for (const table of INDEX_TABLES) {
    expect(actual[table], `${label}：${table}`).toEqual(reference[table]);
  }
  // 索引不能是空的：否则「两边都空」也会通过
  expect(reference.narrative_entity!.length, `${label}：实体数`).toBeGreaterThan(0);
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

function eventIdsOf(chapterNumber: number, status?: string): string[] {
  return storage.sqlite
    .prepare<{ id: string }>(`SELECT id FROM narrative_event WHERE book_id = ? AND chapter_number = ? ${status ? "AND status = ?" : ""} ORDER BY id`)
    .all(...[BOOK, chapterNumber, ...(status ? [status] : [])])
    .map((row) => row.id);
}

beforeEach(async () => {
  tempDir = join(tmpdir(), `novelfork-entity-refresh-${crypto.randomUUID()}`);
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

describe("refreshNarrativeEntityIndex 与整本重建等价", () => {
  it("连续结算多章，每一步都与整本重建逐项一致；结算之间穿插审批、改删、回收站与经纬改名", async () => {
    await entry("薛行之（主角）", "characters", ["薛小爷"]);
    await entry("方工", "characters");
    await entry("林舟", "characters");
    await entry("沈青", "characters");
    await entry("青云山", "locations");
    await entry("药园", "locations");
    await entry("铜戒指", "props");
    await entry("小瓶", "foreshadowing");

    // 第 1 章：位置、关系（复合主体）、状态
    await settle(1, [
      { eventType: "location_changed", subject: "薛行之", predicate: "抵达", object: "青云山" },
      { eventType: "relationship_changed", subject: "薛行之与方工", predicate: "结盟", object: "林舟" },
      { eventType: "character_state_changed", subject: "薛小爷", predicate: "境界", object: "炼气" },
    ]);
    await expectEquivalentToRebuild("第1章后");

    // 第 2 章：同槽位新值把旧值关掉（valid_until 变化）；一条低置信度事件进待审；一条未归并称呼
    await settle(2, [
      { eventType: "location_changed", subject: "薛行之", predicate: "抵达", object: "药园" },
      { eventType: "relationship_changed", subject: "林舟", predicate: "敌对", object: "沈青", confidence: 0.5 },
      { eventType: "character_state_changed", subject: "路人甲", predicate: "境界", object: "筑基" },
    ]);
    await expectEquivalentToRebuild("第2章后");

    // 两次结算之间：作者批准第 2 章的待审事件（审批路径，结算之外的写入）
    const pending = eventIdsOf(2, "pending");
    expect(pending.length).toBeGreaterThan(0);
    const approved = await handleMemoryEvents({ bookId: BOOK, action: "approve", eventId: pending[0]!, reason: "确认" } as never);
    expect(approved.ok).toBe(true);
    // memory.update 改一条事实的主体，memory.delete 删一条事件
    const someFact = storage.sqlite.prepare<{ id: string }>("SELECT id FROM narrative_fact WHERE book_id = ? AND category = 'character_state' ORDER BY id LIMIT 1").get(BOOK)!;
    expect((await handleMemoryUpdate({ bookId: BOOK, kind: "fact", id: someFact.id, reason: "改主体", patch: { subject: "沈青" } })).ok).toBe(true);
    const doomed = eventIdsOf(1).find((id) => id.includes("location_changed"))!;
    expect((await handleMemoryDelete({ bookId: BOOK, kind: "event", id: doomed, reason: "误抽" })).ok).toBe(true);

    // 第 3 章：结算一次即追上上面三处结算外写入
    await settle(3, [
      { eventType: "relationship_changed", subject: "沈青、林舟与方工", predicate: "同行", object: "青云山" },
      { eventType: "hook_planted", subject: "小瓶", predicate: "埋设", object: "瓶中绿液" },
    ]);
    await expectEquivalentToRebuild("第3章后（追上审批 / 改 / 删）");

    // 回收站：丢弃一条待审事件再恢复（两次结算之间各一次）
    await settle(4, [{ eventType: "relationship_changed", subject: "方工", predicate: "师徒", object: "沈青", confidence: 0.5 }]);
    await expectEquivalentToRebuild("第4章后");
    const trashable = eventIdsOf(4, "pending");
    expect(trashable.length).toBe(1);
    expect(trashPendingNarrativeEvents(storage, { bookId: BOOK, eventIds: trashable, reason: "暂不处理" }).trashed).toEqual(trashable);
    await settle(5, [{ eventType: "location_changed", subject: "林舟", predicate: "抵达", object: "药园" }]);
    await expectEquivalentToRebuild("第5章后（事件进回收站）");
    expect(restoreTrashedNarrativeEvents(storage, { bookId: BOOK, eventIds: trashable }).restored).toEqual(trashable);
    await settle(6, [{ eventType: "character_state_changed", subject: "方工", predicate: "伤势", object: "重伤" }]);
    await expectEquivalentToRebuild("第6章后（事件恢复）");

    // 经纬改名 + 加别名、新增条目：实体行就地更新，别名改指向
    const fang = storage.sqlite.prepare<{ id: string }>("SELECT id FROM story_jingwei_entry WHERE book_id = ? AND title = '方工'").get(BOOK)!;
    await createStoryJingweiEntryRepository(storage).update(BOOK, fang.id, { title: "方岩", aliases: ["方工"] });
    await entry("路人甲", "characters");
    await settle(7, [{ eventType: "relationship_changed", subject: "方工", predicate: "和解", object: "路人甲" }]);
    await expectEquivalentToRebuild("第7章后（改名 / 新条目）");

    // 改写重结算（同章新正文）：旧事件派生的事实被作废、前驱重新打开
    await settle(7, [{ eventType: "relationship_changed", subject: "方岩", predicate: "决裂", object: "路人甲" }], ["改写"]);
    await expectEquivalentToRebuild("第7章改写重结算后");

    // 删掉一个经纬条目：它的实体与依附行全部退出索引
    const lin = storage.sqlite.prepare<{ id: string }>("SELECT id FROM story_jingwei_entry WHERE book_id = ? AND title = '林舟'").get(BOOK)!;
    await createStoryJingweiEntryRepository(storage).softDelete(BOOK, lin.id, now);
    await settle(8, [{ eventType: "location_changed", subject: "沈青", predicate: "抵达", object: "青云山" }]);
    await expectEquivalentToRebuild("第8章后（删条目）");
  }, 60_000);

  it("两个实体互换规范名时差量写回不撞唯一索引", async () => {
    const a = await entry("甲", "characters");
    const b = await entry("乙", "characters");
    await settle(1, [{ eventType: "relationship_changed", subject: "甲", predicate: "结识", object: "乙" }]);
    const repo = createStoryJingweiEntryRepository(storage);
    await repo.update(BOOK, a.id, { title: "临时" });
    await repo.update(BOOK, b.id, { title: "甲" });
    await repo.update(BOOK, a.id, { title: "乙" });
    const result = refreshNarrativeEntityIndex(storage, BOOK, { now: 2 });
    expect(result.ok).toBe(true);
    await expectEquivalentToRebuild("互换规范名后");
  });

  it("只写变化的行：内容没变时不写任何行；结算一章只动这一章牵连的行", async () => {
    await entry("薛行之", "characters");
    await entry("方工", "characters");
    await entry("青云山", "locations");
    for (let chapter = 1; chapter <= 6; chapter += 1) {
      await settle(chapter, [{ eventType: "relationship_changed", subject: "薛行之", predicate: `第${chapter}次相遇`, object: "方工" }]);
    }
    const idle = refreshNarrativeEntityIndex(storage, BOOK);
    if (!idle.ok) throw new Error("refresh failed");
    expect(idle.write).toEqual({ mode: "diff", baseline: "snapshot", inserted: 0, updated: 0, deleted: 0 });

    const total = Object.values(indexRows(storage)).reduce((sum, rows) => sum + rows.length, 0);
    await settle(7, [{ eventType: "relationship_changed", subject: "薛行之", predicate: "第7次相遇", object: "方工" }]);
    const after = refreshNarrativeEntityIndex(storage, BOOK);
    if (!after.ok) throw new Error("refresh failed");
    expect(after.write?.inserted).toBe(0);
    // 结算本身那次刷新写入的行数远小于索引总行数（一条事件：参与者 2、关系 1、知情 2，以及两个实体的末章）
    const rowsTouchedBySettle = storage.sqlite.prepare<{ n: number }>(
      "SELECT COUNT(*) AS n FROM narrative_relation WHERE book_id = ? AND predicate = '第7次相遇'",
    ).get(BOOK)!.n;
    expect(rowsTouchedBySettle).toBe(1);
    expect(total).toBeGreaterThan(20);
    await expectEquivalentToRebuild("第7章后");
  });

  it("快照不可信时从库里读回：别的连接改过索引、删书后同 id 重建", async () => {
    await entry("薛行之", "characters");
    await entry("方工", "characters");
    await settle(1, [{ eventType: "relationship_changed", subject: "薛行之", predicate: "结盟", object: "方工" }]);

    // 另一个连接手工删掉一条参与者（库里与快照不一致）
    const other = createStorageDatabase({ databasePath });
    other.sqlite.prepare("DELETE FROM narrative_event_participant WHERE book_id = ? AND role = 'patient'").run(BOOK);
    other.close();
    const healed = refreshNarrativeEntityIndex(storage, BOOK);
    if (!healed.ok) throw new Error("refresh failed");
    expect(healed.write?.baseline).toBe("database");
    expect(healed.write?.inserted).toBeGreaterThan(0);
    await expectEquivalentToRebuild("别的连接改过之后");

    // 删书（按 book_id 清空全部表，与 purgeBookScopedStorage 同样做法）后再建同 id 的书
    storage.sqlite.transaction(() => {
      const tables = storage.sqlite.prepare<{ name: string }>(`
        SELECT DISTINCT m.name AS name FROM sqlite_master m JOIN pragma_table_info(m.name) p
        WHERE m.type = 'table' AND p.name = 'book_id'
      `).all();
      for (const { name } of tables) storage.sqlite.prepare(`DELETE FROM "${name}" WHERE book_id = ?`).run(BOOK);
      storage.sqlite.prepare("DELETE FROM book WHERE id = ?").run(BOOK);
    })();
    await setupBook(storage);
    await entry("林舟", "characters");
    await entry("沈青", "characters");
    await settle(1, [{ eventType: "relationship_changed", subject: "林舟", predicate: "相识", object: "沈青" }]);
    const names = storage.sqlite.prepare<{ canonical_name: string }>("SELECT canonical_name FROM narrative_entity WHERE book_id = ? ORDER BY canonical_name").all(BOOK).map((row) => row.canonical_name);
    expect(names).toEqual(["林舟", "沈青"].sort());
    await expectEquivalentToRebuild("删书后同 id 重建");
  });

  it("写入中途失败整体回滚，旧索引原样保留，下次刷新照常追上", async () => {
    await entry("薛行之", "characters");
    await entry("方工", "characters");
    await settle(1, [{ eventType: "relationship_changed", subject: "薛行之", predicate: "结盟", object: "方工" }]);
    const before = indexRows(storage);

    await entry("林舟", "characters");
    storage.sqlite.prepare(`
      INSERT INTO narrative_event (id, book_id, chapter_number, event_type, subject, predicate, object, evidence_text,
        confidence, source, status, risk_level, created_at)
      VALUES ('ev-x', ?, 2, 'relationship_changed', '林舟', '相遇', '方工', '证据', 0.9, 'manual', 'applied', 'low', ?)
    `).run(BOOK, now.toISOString());
    // 让知情表插入失败：临时触发器只存在于这个用例
    storage.sqlite.exec(`
      CREATE TEMP TRIGGER fail_participant BEFORE INSERT ON narrative_event_participant
      WHEN NEW.event_id = 'ev-x' BEGIN SELECT RAISE(ABORT, 'boom'); END;
    `);
    expect(() => refreshNarrativeEntityIndex(storage, BOOK)).toThrow(/boom/u);
    expect(indexRows(storage)).toEqual(before);
    storage.sqlite.exec("DROP TRIGGER fail_participant");

    const retried = refreshNarrativeEntityIndex(storage, BOOK);
    expect(retried.ok).toBe(true);
    await expectEquivalentToRebuild("回滚后重试");
  });
});
