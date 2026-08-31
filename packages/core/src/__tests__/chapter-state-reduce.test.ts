import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ChapterStateDelta } from "../models/chapter-state-delta.js";
import { commitChapterStateDelta } from "../state/chapter-state-commit.js";
import {
  loadChapterStateProjection,
  reduceChapterStateDeltas,
} from "../state/chapter-state-reduce.js";
import { createStorageDatabase } from "../storage/db.js";
import { runStorageMigrations } from "../storage/migrations-runner.js";

const tempDirs: string[] = [];

async function createStorage() {
  const dir = join(tmpdir(), `novelfork-chapter-reduce-${crypto.randomUUID()}`);
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
    notes: [],
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("reduceChapterStateDeltas", () => {
  it("reduces later character, relationship, hook and timeline facts over earlier ones", () => {
    const projection = reduceChapterStateDeltas([
      delta({
        chapterNumber: 1,
        characters: [{ characterId: "han-li", name: "韩立", currentState: "入门", knowledge: ["有小瓶"] }],
        relationships: [{
          source: "韩立",
          target: "墨大夫",
          relationType: "师徒",
          sentiment: "friendly",
          status: "active",
          description: "拜师",
        }],
        hooks: [{
          hookId: "small-bottle",
          action: "upsert",
          type: "mystery",
          status: "open",
          expectedPayoff: "揭示小瓶来历",
          notes: "发现小瓶",
        }],
        timeline: { chapter: 1, storyTime: "入门当日", label: "拜师", durationFromPrev: "", ordinal: 1 },
        commitments: [],
        summary: undefined,
        resources: [],
        knowledge: [],
      }),
      delta(),
    ], { stateRevision: 2 });

    expect(projection.stateRevision).toBe(2);
    expect(projection.lastChapter).toBe(12);
    expect(projection.characters).toHaveLength(1);
    expect(projection.characters[0]).toMatchObject({
      characterId: "han-li",
      name: "韩立",
      currentState: "抵达药园",
      firstChapter: 1,
      lastChapter: 12,
    });
    expect(projection.characters[0]?.knowledge).toEqual(expect.arrayContaining(["有小瓶", "小瓶仍在"]));
    expect(projection.characters[0]?.beats).toHaveLength(2);
    expect(projection.relationships[0]).toMatchObject({
      source: "韩立",
      target: "墨大夫",
      sentiment: "complicated",
      status: "evolving",
      firstChapter: 1,
      lastChapter: 12,
    });
    expect(projection.hooks[0]).toMatchObject({
      hookId: "small-bottle",
      status: "progressing",
      startChapter: 1,
      lastAdvancedChapter: 12,
    });
    expect(projection.timeline.map((entry) => entry.chapter)).toEqual([1, 12]);
    expect(projection.commitments[0]?.text).toContain("墨大夫");
    expect(projection.resources[0]).toMatchObject({ resourceId: "spirit-stone", balance: -2 });
  });

  it("resolves a mentioned hook and does not let later mentions reopen it", () => {
    const projection = reduceChapterStateDeltas([
      {
        chapterNumber: 3,
        characters: [],
        relationships: [],
        hooks: [{ hookId: "bell", action: "upsert", type: "foreshadowing", status: "open", notes: "青铜铃" }],
        commitments: [],
        resources: [],
        knowledge: [],
        notes: [],
      },
      {
        chapterNumber: 8,
        characters: [],
        relationships: [],
        hooks: [{ hookId: "bell", action: "resolve", type: "foreshadowing", status: "resolved", notes: "揭开来历" }],
        commitments: [],
        resources: [],
        knowledge: [],
        notes: [],
      },
      {
        chapterNumber: 9,
        characters: [],
        relationships: [],
        hooks: [{ hookId: "bell", action: "mention", type: "foreshadowing", status: "progressing", notes: "回忆铃响" }],
        commitments: [],
        resources: [],
        knowledge: [],
        notes: [],
      },
    ]);

    expect(projection.hooks).toHaveLength(1);
    expect(projection.hooks[0]).toMatchObject({
      hookId: "bell",
      status: "resolved",
      startChapter: 3,
      lastAdvancedChapter: 9,
    });
  });

  it("treats a first mention as an open hook that is already progressing", () => {
    const projection = reduceChapterStateDeltas([
      {
        chapterNumber: 4,
        characters: [],
        relationships: [],
        hooks: [{ hookId: "token", action: "mention", type: "mystery", status: "open", notes: "令牌一闪" }],
        commitments: [],
        resources: [],
        knowledge: [],
        notes: [],
      },
    ]);
    expect(projection.hooks[0]).toMatchObject({
      hookId: "token",
      status: "progressing",
      startChapter: 4,
      lastAdvancedChapter: 4,
    });
  });
});

describe("loadChapterStateProjection", () => {
  it("reads committed deltas in revision order and ignores jingwei-shaped side tables", async () => {
    const storage = await createStorage();
    try {
      commitChapterStateDelta(storage, {
        bookId: "book-1",
        delta: delta({
          chapterNumber: 1,
          characters: [{ characterId: "han-li", name: "韩立", currentState: "入门", knowledge: [] }],
          hooks: [{ hookId: "small-bottle", action: "upsert", type: "mystery", status: "open" }],
          relationships: [],
          commitments: [],
          summary: undefined,
          resources: [],
          knowledge: [],
          timeline: { chapter: 1, storyTime: "入门当日", label: "拜师", durationFromPrev: "" },
        }),
      });
      commitChapterStateDelta(storage, {
        bookId: "book-1",
        delta: delta(),
        expectedStateRevision: 1,
      });

      const projection = loadChapterStateProjection(storage, "book-1");
      expect(projection.stateRevision).toBe(2);
      expect(projection.characters[0]?.currentState).toBe("抵达药园");
      expect(projection.hooks[0]?.status).toBe("progressing");
      expect(projection.timeline).toHaveLength(2);
    } finally {
      storage.close();
    }
  });
});
