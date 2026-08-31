import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { computeDeltaFingerprint, type ChapterStateDelta } from "../models/chapter-state-delta.js";
import {
  RevisionConflictError,
  commitChapterStateDelta,
  getBookStateRevision,
} from "../state/chapter-state-commit.js";
import { createStorageDatabase } from "../storage/db.js";
import { runStorageMigrations } from "../storage/migrations-runner.js";

const tempDirs: string[] = [];

async function createStorage() {
  const dir = join(tmpdir(), `novelfork-chapter-state-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  runStorageMigrations(storage);
  const now = Date.now();
  storage.sqlite.prepare(`
    INSERT INTO book (id, name, jingwei_mode, current_chapter, created_at, updated_at)
    VALUES ('book-1', '测试书', 'dynamic', 0, ?, ?)
  `).run(now, now);
  return storage;
}

function delta(overrides: Partial<ChapterStateDelta> = {}): ChapterStateDelta {
  return {
    chapterNumber: 12,
    title: "药园试探",
    characters: [{
      characterId: "han-li",
      name: "韩立",
      currentState: "抵达药园",
      knowledge: ["小瓶仍在"],
    }],
    relationships: [{
      source: "韩立",
      target: "墨大夫",
      relationType: "师徒",
      sentiment: "complicated",
      status: "evolving",
      description: "药园试探加深猜忌",
    }],
    hooks: [{
      hookId: "small-bottle",
      action: "mention",
      type: "mystery",
      status: "progressing",
      expectedPayoff: "揭示小瓶来历",
      notes: "药园里再次确认小瓶仍在",
    }],
    timeline: {
      chapter: 12,
      storyTime: "入门第三日黄昏",
      label: "药园试探",
      durationFromPrev: "半日",
      ordinal: 12,
    },
    commitments: [{
      text: "下章确认墨大夫是否察觉",
      targetChapter: 13,
      scope: "chapter",
      fulfilled: false,
    }],
    summary: {
      chapter: 12,
      title: "药园试探",
      characters: "韩立",
      events: "韩立抵达药园确认小瓶仍在。",
      stateChanges: "对墨大夫的猜忌加深。",
      hookActivity: "small-bottle advanced",
      mood: "tight",
      chapterType: "investigation",
    },
    resources: [{ resourceId: "spirit-stone", delta: -2, reason: "药园门禁" }],
    knowledge: [{
      characterId: "han-li",
      fact: "小瓶仍在药园",
      learnedAtChapter: 12,
      source: "正文",
    }],
    notes: ["CAS 提交测试"],
    ...overrides,
  };
}

function replayDelta(): ChapterStateDelta {
  return {
    notes: ["CAS 提交测试"],
    knowledge: [{
      source: "正文",
      learnedAtChapter: 12,
      fact: "小瓶仍在药园",
      characterId: "han-li",
    }],
    resources: [{ reason: "药园门禁", delta: -2, resourceId: "spirit-stone" }],
    summary: {
      chapterType: "investigation",
      mood: "tight",
      hookActivity: "small-bottle advanced",
      stateChanges: "对墨大夫的猜忌加深。",
      events: "韩立抵达药园确认小瓶仍在。",
      characters: "韩立",
      title: "药园试探",
      chapter: 12,
    },
    commitments: [{
      fulfilled: false,
      scope: "chapter",
      targetChapter: 13,
      text: "下章确认墨大夫是否察觉",
    }],
    timeline: {
      ordinal: 12,
      durationFromPrev: "半日",
      label: "药园试探",
      storyTime: "入门第三日黄昏",
      chapter: 12,
    },
    hooks: [{
      notes: "药园里再次确认小瓶仍在",
      expectedPayoff: "揭示小瓶来历",
      status: "progressing",
      type: "mystery",
      action: "mention",
      hookId: "small-bottle",
    }],
    relationships: [{
      description: "药园试探加深猜忌",
      status: "evolving",
      sentiment: "complicated",
      relationType: "师徒",
      target: "墨大夫",
      source: "韩立",
    }],
    characters: [{
      knowledge: ["小瓶仍在"],
      currentState: "抵达药园",
      name: "韩立",
      characterId: "han-li",
    }],
    title: "药园试探",
    chapterNumber: 12,
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("ChapterStateDelta fingerprint", () => {
  it("ignores object key order when hashing the same payload", () => {
    const left = computeDeltaFingerprint(delta());
    const right = computeDeltaFingerprint(replayDelta());
    expect(left).toBe(right);
  });
});

describe("commitChapterStateDelta", () => {
  it("commits a delta, increments book state_revision, and stores the canonical payload", async () => {
    const storage = await createStorage();
    try {
      const result = await Promise.resolve(commitChapterStateDelta(storage, {
        bookId: "book-1",
        delta: delta(),
        expectedStateRevision: 0,
        now: () => 1_700_000_000_000,
      }));

      expect(result).toMatchObject({
        ok: true,
        bookId: "book-1",
        chapterNumber: 12,
        baseRevision: 0,
        resultingRevision: 1,
        idempotent: false,
      });
      expect(getBookStateRevision(storage, "book-1")).toBe(1);
      const row = storage.sqlite.prepare<{
        fingerprint: string;
        resulting_revision: number;
        chapter_number: number;
      }>(`
        SELECT fingerprint, resulting_revision, chapter_number
        FROM chapter_state_delta
        WHERE book_id = ?
      `).get("book-1");
      expect(row).toMatchObject({
        fingerprint: result.fingerprint,
        resulting_revision: 1,
        chapter_number: 12,
      });
    } finally {
      storage.close();
    }
  });

  it("returns the existing revision when the same content fingerprint is replayed", async () => {
    const storage = await createStorage();
    try {
      const first = commitChapterStateDelta(storage, { bookId: "book-1", delta: delta() });
      const second = commitChapterStateDelta(storage, {
        bookId: "book-1",
        delta: delta(),
        expectedStateRevision: 0,
      });

      expect(second.idempotent).toBe(true);
      expect(second.deltaId).toBe(first.deltaId);
      expect(second.resultingRevision).toBe(first.resultingRevision);
      expect(getBookStateRevision(storage, "book-1")).toBe(1);
      expect(storage.sqlite.prepare<{ count: number }>("SELECT COUNT(*) AS count FROM chapter_state_delta").get()?.count).toBe(1);
    } finally {
      storage.close();
    }
  });

  it("rejects a stale expectedStateRevision without writing a second delta", async () => {
    const storage = await createStorage();
    try {
      commitChapterStateDelta(storage, { bookId: "book-1", delta: delta() });
      expect(() => commitChapterStateDelta(storage, {
        bookId: "book-1",
        delta: delta({ notes: ["第二次提交"] }),
        expectedStateRevision: 0,
      })).toThrow(RevisionConflictError);
      expect(getBookStateRevision(storage, "book-1")).toBe(1);
      expect(storage.sqlite.prepare<{ count: number }>("SELECT COUNT(*) AS count FROM chapter_state_delta").get()?.count).toBe(1);
    } finally {
      storage.close();
    }
  });

  it("rolls back the revision bump when the projection callback throws", async () => {
    const storage = await createStorage();
    try {
      expect(() => commitChapterStateDelta(storage, {
        bookId: "book-1",
        delta: delta(),
        project: () => {
          throw new Error("projection-failed");
        },
      })).toThrow(/projection-failed/);
      expect(getBookStateRevision(storage, "book-1")).toBe(0);
      expect(storage.sqlite.prepare<{ count: number }>("SELECT COUNT(*) AS count FROM chapter_state_delta").get()?.count).toBe(0);
    } finally {
      storage.close();
    }
  });

  it("creates a placeholder book when committing against an unknown bookId", async () => {
    const storage = await createStorage();
    try {
      storage.sqlite.prepare(`DELETE FROM book WHERE id = ?`).run("book-1");
      const result = commitChapterStateDelta(storage, {
        bookId: "book-missing",
        delta: delta({ notes: ["缺书占位"] }),
      });
      expect(result.resultingRevision).toBe(1);
      expect(storage.sqlite.prepare<{ id: string }>("SELECT id FROM book WHERE id = ?").get("book-missing")?.id).toBe("book-missing");
    } finally {
      storage.close();
    }
  });

  it("keeps events, facts, and the revision bump in one transaction", async () => {
    const storage = await createStorage();
    try {
      storage.sqlite.exec(`
        CREATE TABLE narrative_event (id TEXT PRIMARY KEY, subject TEXT);
        CREATE TABLE narrative_fact (id TEXT PRIMARY KEY, object TEXT);
      `);
      const result = commitChapterStateDelta(storage, {
        bookId: "book-1",
        delta: delta(),
        expectedStateRevision: 0,
        project: ({ storage: db, deltaId }) => {
          db.sqlite.prepare(`INSERT INTO narrative_event (id, subject) VALUES (?, ?)`).run(deltaId, "韩立");
          db.sqlite.prepare(`INSERT INTO narrative_fact (id, object) VALUES (?, ?)`).run(deltaId, "药园");
          return { events: 1, facts: 1 };
        },
      });
      expect(result.projection).toEqual({ events: 1, facts: 1 });
      expect(getBookStateRevision(storage, "book-1")).toBe(1);
      expect(storage.sqlite.prepare<{ count: number }>("SELECT COUNT(*) AS count FROM narrative_event").get()?.count).toBe(1);
      expect(storage.sqlite.prepare<{ count: number }>("SELECT COUNT(*) AS count FROM narrative_fact").get()?.count).toBe(1);
    } finally {
      storage.close();
    }
  });
});
