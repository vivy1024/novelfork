import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import { createBookRepository } from "../engine/jingwei/repositories/book-repo.js";
import { loadForeshadowStates } from "../engine/narrative-taxonomy/foreshadow-states.js";
import { settleConfirmedChapter } from "./chapter-settlement-service.js";
import { softDeleteLedgerEntry, upsertLedgerEntry } from "./jingwei-ledger-store.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-foreshadow-draft-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
  await createBookRepository(storage).create({
    id: "book-1",
    name: "测试书",
    jingweiMode: "dynamic",
    currentChapter: 20,
    createdAt: new Date("2026-06-22T00:00:00.000Z"),
    updatedAt: new Date("2026-06-22T00:00:00.000Z"),
  });
  return storage;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const plantedContent = "他发现瓶中绿液能催熟药草。";

function settlePlanted(storage: StorageDatabase, subject = "小瓶", content = plantedContent) {
  return settleConfirmedChapter({ bookId: "book-1", chapterNumber: 3, content }, {
    storage,
    llmExtractor: async () => [{
      eventType: "hook_planted",
      subject,
      predicate: "埋设",
      object: "瓶中绿液能催熟药草",
      evidenceText: content,
      confidence: 0.9,
      source: "settle",
    }],
  });
}

interface DraftRow {
  id: string;
  title: string;
  status: string;
  layer: string;
  fieldsJson: string;
  sourceRefsJson: string;
  participatesInAi: number;
  deletedAt: number | null;
}

function foreshadowRows(storage: StorageDatabase): DraftRow[] {
  return storage.sqlite.prepare<DraftRow>(`
    SELECT id, title, status, layer, fields_json AS fieldsJson, source_refs_json AS sourceRefsJson,
           participates_in_ai AS participatesInAi, deleted_at AS deletedAt
    FROM story_jingwei_entry WHERE book_id = 'book-1' AND category = 'foreshadowing'
  `).all();
}

describe("章后结算的新伏笔草稿", () => {
  it("经纬里没有对应条目时写一条待审草稿，带来源章节与正文证据", async () => {
    const storage = await createStorage();
    try {
      const result = await settlePlanted(storage);
      expect(result.status).toBe("completed");

      const rows = foreshadowRows(storage);
      expect(rows).toHaveLength(1);
      const draft = rows[0]!;
      expect(draft).toMatchObject({ title: "小瓶", status: "needs-review", layer: "dynamic", participatesInAi: 0 });
      expect(JSON.parse(draft.fieldsJson)).toMatchObject({ status: "已埋设", plantedChapter: 3 });
      expect(JSON.parse(draft.sourceRefsJson)).toEqual([{ chapterNumber: 3, excerpt: plantedContent }]);
      expect(result.warnings.join("\n")).toContain("待审的经纬伏笔草稿");

      // 事件挂上草稿条目；作者确认前草稿不进伏笔阶段派生
      const event = storage.sqlite.prepare<{ subjectEntryId: string | null }>(
        "SELECT subject_entry_id AS subjectEntryId FROM narrative_event WHERE event_type = 'hook_planted' LIMIT 1",
      ).get();
      expect(event?.subjectEntryId).toBe(draft.id);
      expect(loadForeshadowStates(storage, "book-1")).toEqual([]);
    } finally {
      storage.close();
    }
  });

  it("同一伏笔重复结算不重复建条目", async () => {
    const storage = await createStorage();
    try {
      await settlePlanted(storage);
      // 同章换了正文重结算、以及后续章节再次埋同名伏笔
      await settlePlanted(storage, "小瓶", "他再次端详瓶中绿液。");
      await settleConfirmedChapter({ bookId: "book-1", chapterNumber: 5, content: "小瓶又亮了。" }, {
        storage,
        llmExtractor: async () => [{ eventType: "hook_planted", subject: "小瓶", predicate: "埋设", object: "小瓶发光", evidenceText: "小瓶又亮了。", confidence: 0.9, source: "settle" }],
      });
      expect(foreshadowRows(storage)).toHaveLength(1);
    } finally {
      storage.close();
    }
  });

  it("已有经纬伏笔条目时不建草稿；作者删掉的草稿重结算也不再冒出来", async () => {
    const storage = await createStorage();
    try {
      upsertLedgerEntry(storage, {
        bookId: "book-1",
        category: "foreshadowing",
        title: "小瓶（掌天瓶）",
        contentMd: "瓶中绿液",
        fields: { status: "已埋设" },
      });
      await settlePlanted(storage);
      expect(foreshadowRows(storage)).toHaveLength(1);

      await settlePlanted(storage, "墨大夫的药方", "墨大夫留下一张药方。");
      const draft = foreshadowRows(storage).find((row) => row.title === "墨大夫的药方");
      expect(draft?.status).toBe("needs-review");
      softDeleteLedgerEntry(storage, "book-1", draft!.id);
      await settlePlanted(storage, "墨大夫的药方", "墨大夫又翻出那张药方。");
      expect(foreshadowRows(storage).filter((row) => row.title === "墨大夫的药方")).toHaveLength(1);
    } finally {
      storage.close();
    }
  });

  it("作者确认草稿后才进入伏笔阶段派生", async () => {
    const storage = await createStorage();
    try {
      await settlePlanted(storage);
      storage.sqlite.prepare("UPDATE story_jingwei_entry SET status = 'confirmed' WHERE book_id = 'book-1' AND category = 'foreshadowing'").run();
      expect(loadForeshadowStates(storage, "book-1")).toEqual([
        expect.objectContaining({ label: "小瓶", phase: "planted", setupChapter: 3 }),
      ]);
    } finally {
      storage.close();
    }
  });
});
