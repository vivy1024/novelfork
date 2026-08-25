import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import { ensureNarrativeMemorySchema } from "./storage.js";
import { backfillNarrativeEventEntityIds } from "./entity-id-backfill.js";
import { createBookRepository } from "../jingwei/repositories/book-repo.js";
import { createStoryJingweiSectionRepository } from "../jingwei/repositories/section-repo.js";
import { createStoryJingweiEntryRepository } from "../jingwei/repositories/entry-repo.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-entity-backfill-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  runStorageMigrations(storage);
  return storage;
}

async function seedBookWithEntities(storage: StorageDatabase): Promise<void> {
  await createBookRepository(storage).create({
    id: "book-1",
    name: "测试书",
    jingweiMode: "dynamic",
    currentChapter: 5,
    createdAt: new Date("2026-06-22T00:00:00.000Z"),
    updatedAt: new Date("2026-06-22T00:00:00.000Z"),
  });
  const sectionRepo = createStoryJingweiSectionRepository(storage);
  const entryRepo = createStoryJingweiEntryRepository(storage);
  const section = await sectionRepo.create({
    id: "characters-section",
    bookId: "book-1",
    key: "characters",
    name: "角色",
    description: "",
    icon: null,
    order: 0,
    enabled: true,
    showInSidebar: true,
    participatesInAi: true,
    defaultVisibility: "tracked",
    fieldsJson: [],
    builtinKind: "characters",
    sourceTemplate: "manual",
    createdAt: new Date("2026-06-22T00:00:00.000Z"),
    updatedAt: new Date("2026-06-22T00:00:00.000Z"),
  });
  const base = {
    bookId: "book-1",
    sectionId: section.id,
    contentMd: "",
    category: "characters",
    fields: {},
    customFields: {},
    relatedChapterNumbers: [],
    relatedEntryIds: [],
    visibilityRule: { type: "tracked" as const },
    participatesInAi: true,
    priorityTier: "relevant" as const,
    layer: "canon" as const,
    importance: 70,
    lifecycle: "active" as const,
    status: "confirmed" as const,
    tags: [],
    aliases: [] as string[],
    tokenBudget: null,
    parentId: null,
    createdAt: new Date("2026-06-22T00:00:00.000Z"),
    updatedAt: new Date("2026-06-22T00:00:00.000Z"),
  };
  // 主角：标题带括号装饰 + 显式别名「韩老魔」。
  await entryRepo.create({
    ...base,
    id: "entry-xue",
    title: "薛行之（主角权威统一版）",
    aliases: ["韩老魔"],
    version: 1,
  });
  await entryRepo.create({ ...base, id: "entry-li", title: "厉飞雨", version: 1 });

  ensureNarrativeMemorySchema(storage);
}

function insertEvent(storage: StorageDatabase, input: {
  id: string;
  chapterNumber: number;
  subject: string;
  object?: string;
  subjectEntryId?: string;
}): void {
  storage.sqlite.prepare(`
    INSERT INTO narrative_event
      (id, book_id, chapter_number, event_type, subject, predicate, object, evidence_text,
       confidence, source, status, risk_level, created_at,
       subject_entry_id, object_entry_id)
    VALUES (?, 'book-1', ?, 'location_changed', ?, '抵达', ?, '证据', 0.9, 'settle', 'applied', 'low',
            '2026-06-22T00:00:00.000Z', ?, ?)
  `).run(
    input.id,
    input.chapterNumber,
    input.subject,
    input.object ?? null,
    input.subjectEntryId ?? null,
    null,
  );
}

function readEvent(storage: StorageDatabase, id: string): { subject_entry_id: string | null; object_entry_id: string | null } {
  return storage.sqlite.prepare<{ subject_entry_id: string | null; object_entry_id: string | null }>(
    "SELECT subject_entry_id, object_entry_id FROM narrative_event WHERE id = ?",
  ).get(id)!;
}

describe("backfillNarrativeEventEntityIds（T8 存量身份链回填）", () => {
  it("按权威名 / 别名 / 括号装饰回填缺失的 subject 与 object 身份链", async () => {
    const storage = await createStorage();
    try {
      await seedBookWithEntities(storage);
      insertEvent(storage, { id: "e1", chapterNumber: 1, subject: "薛行之", object: "药园" });
      insertEvent(storage, { id: "e2", chapterNumber: 2, subject: "韩老魔", object: "厉飞雨" });
      insertEvent(storage, { id: "e3", chapterNumber: 3, subject: "薛行之（主角权威统一版）", object: "厉飞雨" });

      const result = backfillNarrativeEventEntityIds(storage, "book-1");

      expect(result.scanned).toBe(3);
      expect(result.subjectBackfilled).toBe(3);
      expect(result.objectBackfilled).toBe(2); // 「药园」不在字典，客体只有两条命中
      expect(readEvent(storage, "e1")).toEqual({ subject_entry_id: "entry-xue", object_entry_id: null });
      expect(readEvent(storage, "e2")).toEqual({ subject_entry_id: "entry-xue", object_entry_id: "entry-li" });
      // 括号装饰被剥壳后仍命中同一权威条目
      expect(readEvent(storage, "e3").subject_entry_id).toBe("entry-xue");
    } finally {
      storage.close();
    }
  });

  it("已挂链的列不重扫；完全未命中的事件保持原样并计入 unresolved", async () => {
    const storage = await createStorage();
    try {
      await seedBookWithEntities(storage);
      insertEvent(storage, { id: "kept", chapterNumber: 1, subject: "薛行之", object: "厉飞雨", subjectEntryId: "entry-xue" });
      // schema 里 object 非空：无客体的事件用空串占位（回填侧按 trim 跳过）。
      insertEvent(storage, { id: "stranger", chapterNumber: 2, subject: "墨居仁", object: "" }); // 不在字典

      const first = backfillNarrativeEventEntityIds(storage, "book-1");
      expect(first.subjectBackfilled).toBe(0); // kept 的主体不重扫
      expect(first.objectBackfilled).toBe(1);  // kept 的对象补上
      expect(first.unresolved).toBe(1);        // stranger 主客都未命中

      expect(readEvent(storage, "kept")).toEqual({ subject_entry_id: "entry-xue", object_entry_id: "entry-li" });
      expect(readEvent(storage, "stranger")).toEqual({ subject_entry_id: null, object_entry_id: null });

      // 幂等：再跑一遍无事可做。
      const second = backfillNarrativeEventEntityIds(storage, "book-1");
      expect(second).toEqual({ scanned: 1, subjectBackfilled: 0, objectBackfilled: 0, unresolved: 1 });
    } finally {
      storage.close();
    }
  });

  it("字典为空（书没有实体条目）时返回零计数且不报错", async () => {
    const storage = await createStorage();
    try {
      await createBookRepository(storage).create({
        id: "empty-book",
        name: "空书",
        jingweiMode: "dynamic",
        currentChapter: 0,
        createdAt: new Date("2026-06-22T00:00:00.000Z"),
        updatedAt: new Date("2026-06-22T00:00:00.000Z"),
      });
      ensureNarrativeMemorySchema(storage);

      const result = backfillNarrativeEventEntityIds(storage, "empty-book");
      expect(result).toEqual({ scanned: 0, subjectBackfilled: 0, objectBackfilled: 0, unresolved: 0 });
    } finally {
      storage.close();
    }
  });
});
