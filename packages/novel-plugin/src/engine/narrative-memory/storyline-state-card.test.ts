import { createStorageDatabase } from "@vivy1024/novelfork-core/storage";
import { describe, expect, it } from "vitest";

import { buildStorylineStateCard } from "./storyline-state-card.js";

function makeStorage() {
  const storage = createStorageDatabase({ databasePath: ":memory:" });
  storage.sqlite.exec(`
    CREATE TABLE narrative_fact (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      subject TEXT NOT NULL,
      predicate TEXT NOT NULL,
      object TEXT NOT NULL,
      category TEXT NOT NULL,
      layer TEXT NOT NULL,
      confidence REAL NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT,
      source_chapter INTEGER,
      evidence_text TEXT,
      valid_from_chapter INTEGER,
      valid_until_chapter INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return storage;
}

function insert(storage: ReturnType<typeof makeStorage>, row: {
  id: string; subject: string; predicate: string; object: string;
  sourceChapter: number | null; validUntilChapter: number | null; updatedAt: string;
}): void {
  storage.sqlite.prepare(`
    INSERT INTO narrative_fact (
      id, book_id, subject, predicate, object, category, layer, confidence,
      source_type, source_chapter, valid_from_chapter, valid_until_chapter,
      created_at, updated_at
    ) VALUES (?, 'book-1', ?, ?, ?, 'state', 'dynamic', 0.9, 'settle', ?, ?, ?, ?, ?)
  `).run(row.id, row.subject, row.predicate, row.object, row.sourceChapter, row.sourceChapter, row.validUntilChapter, row.updatedAt, row.updatedAt);
}

describe("buildStorylineStateCard", () => {
  it("按当前章有效区间聚合各主体最新事实", () => {
    const storage = makeStorage();
    insert(storage, { id: "f1", subject: "林舟", predicate: "持有", object: "青铜铃", sourceChapter: 3, validUntilChapter: null, updatedAt: "2026-08-01T00:00:00.000Z" });
    insert(storage, { id: "f2", subject: "林舟", predicate: "伤势", object: "未愈", sourceChapter: 5, validUntilChapter: null, updatedAt: "2026-08-02T00:00:00.000Z" });
    insert(storage, { id: "f3", subject: "林舟", predicate: "伤势", object: "已痊愈", sourceChapter: 20, validUntilChapter: null, updatedAt: "2026-08-03T00:00:00.000Z" });
    // 已失效的事实不应出现在第 25 章视角
    insert(storage, { id: "f4", subject: "山门", predicate: "封锁", object: "十年", sourceChapter: 1, validUntilChapter: 8, updatedAt: "2026-07-01T00:00:00.000Z" });
    insert(storage, { id: "f5", subject: "山门", predicate: "重开", object: "大典", sourceChapter: 15, validUntilChapter: null, updatedAt: "2026-08-04T00:00:00.000Z" });

    const card = buildStorylineStateCard(storage, { bookId: "book-1", chapterNumber: 25, maxSubjects: 8, maxFactsPerSubject: 2 });

    expect(card).toContain("剧情线当前状态 · 第25章视角");
    expect(card).toContain("林舟");
    expect(card).toContain("伤势已痊愈");
    expect(card).toContain("山门");
    expect(card).toContain("重开大典");
    // 第 8 章已失效的封锁事实不得出现
    expect(card).not.toContain("封锁十年");
    // 每主体最多 maxFactsPerSubject 条
    const linfanLine = card.split("\n").find((line) => line.includes("林舟")) ?? "";
    expect(linfanLine.split("；").length).toBeLessThanOrEqual(2);
    storage.close();
  });

  it("没有有效事实时返回空串", () => {
    const storage = makeStorage();
    expect(buildStorylineStateCard(storage, { bookId: "book-1", chapterNumber: 3 })).toBe("");
    storage.close();
  });
});
