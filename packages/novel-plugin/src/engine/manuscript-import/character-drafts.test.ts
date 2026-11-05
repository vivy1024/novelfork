// @vitest-environment node
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import { createBookRepository } from "../jingwei/repositories/book-repo.js";
import { buildEntityDictionary } from "../narrative-memory/entity-dictionary.js";
import { ensureNarrativeMemorySchema, insertNarrativeEvent, replaceChapterMentions } from "../narrative-memory/storage.js";
import type { NarrativeEvent } from "../narrative-memory/types.js";
import { rebuildNarrativeEntityIndex } from "../narrative-entity/entity-index.js";
import { createJingweiRouter } from "../../routes/jingwei.js";
import { softDeleteLedgerEntry, upsertLedgerEntry } from "../../handlers/jingwei-ledger-store.js";
import {
  collectCharacterCandidates,
  listPendingManuscriptCharacterDrafts,
  MIN_CHARACTER_DRAFT_OCCURRENCES,
  stageManuscriptCharacterDrafts,
} from "./character-drafts.js";

const tempDirs: string[] = [];
const opened: StorageDatabase[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-character-drafts-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
  await createBookRepository(storage).create({
    id: "book-1",
    name: "旧稿",
    jingweiMode: "dynamic",
    currentChapter: 4,
    createdAt: new Date("2026-10-20T00:00:00.000Z"),
    updatedAt: new Date("2026-10-20T00:00:00.000Z"),
  });
  ensureNarrativeMemorySchema(storage);
  opened.push(storage);
  return storage;
}

afterEach(async () => {
  for (const storage of opened.splice(0)) storage.close();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

let seq = 0;
function event(chapterNumber: number, eventType: NarrativeEvent["eventType"], subject: string, object: string, evidenceText: string): NarrativeEvent {
  seq += 1;
  return {
    id: `evt-${chapterNumber}-${seq}`,
    bookId: "book-1",
    chapterNumber,
    eventType,
    subject,
    predicate: eventType === "location_changed" ? "所在" : eventType === "relationship_changed" ? "结识" : "状态",
    object,
    evidenceText,
    confidence: 0.9,
    source: "settle",
    status: "applied",
    riskLevel: "low",
    createdAt: new Date(Date.UTC(2026, 9, 20, 0, 0, seq)).toISOString(),
    appliedAt: new Date(Date.UTC(2026, 9, 20, 0, 0, seq)).toISOString(),
  };
}

/**
 * 4 章旧稿结算后的样子（与真模型复验的形状一致：事件 / 出场都有，但没有任何人物条目，entry_id 全空）：
 * - 林照：4 章都出场，3 条事件 → 7 次；
 * - 沈默：第 2、4 章出场，1 条关系事件（作为另一方）+ 1 条所在 → 4 次；
 * - 路人甲：第 3 章出场，1 条事件 → 2 次（阈值以下）；
 * - 渡口：只作为地点（location_changed 的对象）出现 → 不算人物。
 */
function seedFourChapters(storage: StorageDatabase): void {
  const events = [
    event(1, "location_changed", "林照", "渡口", "林照推开门，屋里只有一盏灯。"),
    event(2, "relationship_changed", "林照", "沈默", "林照第一次见到沈默，两人在雨里对峙。"),
    event(2, "location_changed", "沈默", "渡口", "沈默撑着伞走向渡口。"),
    event(3, "character_state_changed", "路人甲", "受伤", "路人甲被马车撞倒。"),
    event(4, "character_state_changed", "林照", "离场", "林照独自离开了渡口。"),
  ];
  for (const item of events) insertNarrativeEvent(storage, item);
  const mentions: Record<number, string[]> = { 1: ["林照", "渡口"], 2: ["林照", "沈默", "渡口"], 3: ["林照", "路人甲"], 4: ["林照", "沈默", "渡口"] };
  for (const [chapter, names] of Object.entries(mentions)) {
    replaceChapterMentions(storage, "book-1", Number(chapter), names.map((name, position) => ({ name, position, source: "llm" as const })));
  }
}

interface CharacterRow { id: string; title: string; status: string; layer: string; fieldsJson: string; sourceRefsJson: string; participatesInAi: number; deletedAt: number | null }

function characterRows(storage: StorageDatabase): CharacterRow[] {
  return storage.sqlite.prepare<CharacterRow>(`
    SELECT id, title, status, layer, fields_json AS fieldsJson, source_refs_json AS sourceRefsJson,
           participates_in_ai AS participatesInAi, deleted_at AS deletedAt
    FROM story_jingwei_entry WHERE book_id = 'book-1' AND category = 'characters'
    ORDER BY title
  `).all();
}

const count = (storage: StorageDatabase, sql: string) => (storage.sqlite.prepare<{ count: number }>(sql).get() as { count: number }).count;

describe("旧稿导入人物草稿", () => {
  it("4 章夹具综合后起草人物草稿：dynamic + needs-review，带首次出现章、出现次数与原文证据；阈值以下与地点不起草", async () => {
    const storage = await createStorage();
    seedFourChapters(storage);

    const candidates = collectCharacterCandidates(storage, "book-1");
    expect(candidates.map((candidate) => [candidate.name, candidate.occurrences])).toEqual([["林照", 7], ["沈默", 4], ["路人甲", 2]]);

    const staged = stageManuscriptCharacterDrafts(storage, "book-1", { range: { from: 1, to: 4 }, jobId: "job-1" });
    expect(staged.map((draft) => draft.title)).toEqual(["林照", "沈默"]);
    expect(MIN_CHARACTER_DRAFT_OCCURRENCES).toBe(3);

    const rows = characterRows(storage);
    expect(rows.map((row) => row.title)).toEqual(["林照", "沈默"]);
    for (const row of rows) {
      expect(row).toMatchObject({ status: "needs-review", layer: "dynamic", participatesInAi: 0, deletedAt: null });
    }
    const lin = rows.find((row) => row.title === "林照")!;
    expect(JSON.parse(lin.fieldsJson)).toMatchObject({ draftSource: "manuscript-import", draftJobId: "job-1", firstChapter: 1, occurrences: 7 });
    expect(JSON.parse(lin.fieldsJson).evidence[0]).toEqual({ chapterNumber: 1, text: "林照推开门，屋里只有一盏灯。" });
    expect(JSON.parse(lin.sourceRefsJson)[0]).toMatchObject({ chapterNumber: 1, excerpt: "林照推开门，屋里只有一盏灯。" });

    expect(listPendingManuscriptCharacterDrafts(storage, "book-1").map((draft) => draft.title)).toEqual(["林照", "沈默"]);

    // 幂等：重跑综合不重复起草
    expect(stageManuscriptCharacterDrafts(storage, "book-1")).toEqual([]);
    expect(characterRows(storage)).toHaveLength(2);
  });

  it("已有条目或别名不重复起草", async () => {
    const storage = await createStorage();
    seedFourChapters(storage);
    upsertLedgerEntry(storage, { bookId: "book-1", category: "characters", title: "林照（主角）", contentMd: "", fields: {} });
    upsertLedgerEntry(storage, { bookId: "book-1", category: "characters", title: "沈先生", contentMd: "", fields: {}, aliases: ["沈默"] });

    expect(stageManuscriptCharacterDrafts(storage, "book-1")).toEqual([]);
    expect(characterRows(storage).map((row) => row.title)).toEqual(["林照（主角）", "沈先生"]);
  });

  it("作者删过的不再起草", async () => {
    const storage = await createStorage();
    seedFourChapters(storage);
    const first = stageManuscriptCharacterDrafts(storage, "book-1");
    const shen = first.find((draft) => draft.title === "沈默")!;
    softDeleteLedgerEntry(storage, "book-1", shen.entryId);

    expect(stageManuscriptCharacterDrafts(storage, "book-1")).toEqual([]);
    expect(characterRows(storage).filter((row) => row.deletedAt === null).map((row) => row.title)).toEqual(["林照"]);
    expect(listPendingManuscriptCharacterDrafts(storage, "book-1").map((draft) => draft.title)).toEqual(["林照"]);
  });

  it("待确认人物不进实体字典与实体索引；经纬接口确认后进字典，并回填出场与事件参与者", async () => {
    const storage = await createStorage();
    seedFourChapters(storage);
    const staged = stageManuscriptCharacterDrafts(storage, "book-1");
    const lin = staged.find((draft) => draft.title === "林照")!;

    // 确认前：字典与索引都没有它
    expect(buildEntityDictionary(storage, "book-1").entries.map((entry) => entry.canonicalName)).not.toContain("林照");
    const before = rebuildNarrativeEntityIndex(storage, "book-1");
    expect(before.ok && before.entities).toBe(0);
    expect(count(storage, "SELECT COUNT(*) AS count FROM narrative_chapter_mention WHERE book_id = 'book-1' AND entry_id IS NOT NULL")).toBe(0);
    expect(count(storage, "SELECT COUNT(*) AS count FROM narrative_event_participant WHERE book_id = 'book-1'")).toBe(0);

    // 作者在条目页把状态改为已确认（与 JingweiCanonPanel 保存同一接口）
    const router = createJingweiRouter({ storage });
    const response = await router.request(`/api/books/book-1/jingwei/entries/${lin.entryId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "confirmed" }),
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { entityLink?: { ok: boolean; mentionsLinked: number; entities: number; participants: number } };
    expect(body.entityLink).toMatchObject({ ok: true, mentionsLinked: 4, entities: 1 });

    expect(buildEntityDictionary(storage, "book-1").entries.map((entry) => entry.canonicalName)).toContain("林照");
    expect(count(storage, `SELECT COUNT(*) AS count FROM narrative_chapter_mention WHERE book_id = 'book-1' AND entry_id = '${lin.entryId}'`)).toBe(4);
    expect(count(storage, "SELECT COUNT(*) AS count FROM narrative_entity WHERE book_id = 'book-1'")).toBe(1);
    // 林照当主体的 3 条事件：所在、关系、离场
    expect(count(storage, "SELECT COUNT(*) AS count FROM narrative_event_participant WHERE book_id = 'book-1'")).toBe(3);
    expect(count(storage, `SELECT COUNT(*) AS count FROM narrative_event WHERE book_id = 'book-1' AND subject_entry_id = '${lin.entryId}'`)).toBe(3);
    // 沈默仍待确认：不进索引
    expect(listPendingManuscriptCharacterDrafts(storage, "book-1").map((draft) => draft.title)).toEqual(["沈默"]);

    // 批量确认沈默：同样接上图谱（关系事件的另一方也挂上）
    const shen = staged.find((draft) => draft.title === "沈默")!;
    const bulk = await router.request("/api/books/book-1/jingwei/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "set-status", entryIds: [shen.entryId], target: "confirmed" }),
    });
    const bulkBody = await bulk.json() as { affected: number; entityLink?: { entities: number; relations: number } };
    expect(bulkBody).toMatchObject({ affected: 1, entityLink: { entities: 2 } });
    expect(count(storage, "SELECT COUNT(*) AS count FROM narrative_event_participant WHERE book_id = 'book-1'")).toBe(5);
  });

  it("改其他字段不触发重建；伏笔草稿不受人物过滤影响", async () => {
    const storage = await createStorage();
    seedFourChapters(storage);
    const foreshadow = upsertLedgerEntry(storage, { bookId: "book-1", category: "foreshadowing", title: "渡口的旧信", contentMd: "", fields: {}, status: "needs-review" });
    const [lin] = stageManuscriptCharacterDrafts(storage, "book-1");
    expect(buildEntityDictionary(storage, "book-1").entries.map((entry) => entry.entryId)).toEqual([foreshadow.id]);

    const router = createJingweiRouter({ storage });
    const response = await router.request(`/api/books/book-1/jingwei/entries/${lin!.entryId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contentMd: "改了一句描述" }),
    });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { entityLink?: unknown }).entityLink).toBeUndefined();
  });
});
