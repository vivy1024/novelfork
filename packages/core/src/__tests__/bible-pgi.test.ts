import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  createBibleConflictRepository,
  createBibleEventRepository,
  createBookRepository,
  createStorageDatabase,
  generatePGIQuestions,
  runStorageMigrations,
  type StorageDatabase,
} from "../index.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-pgi-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  runStorageMigrations(storage);
  await createBookRepository(storage).create({
    id: "book-1",
    name: "凡人修仙录",
    bibleMode: "dynamic",
    currentChapter: 10,
    createdAt: new Date("2026-04-25T01:00:00.000Z"),
    updatedAt: new Date("2026-04-25T01:00:00.000Z"),
  });
  return storage;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("PGI engine", () => {
  it("generates questions for escalating conflicts and due foreshadows", async () => {
    const storage = await createStorage();
    try {
      await createBibleConflictRepository(storage).create({
        id: "conflict-1",
        bookId: "book-1",
        name: "灵田争夺",
        type: "system-scarcity",
        scope: "main",
        priority: 1,
        protagonistSideJson: "[]",
        antagonistSideJson: "[]",
        stakes: "主角会失去修炼资源。",
        rootCauseJson: "{}",
        evolutionPathJson: JSON.stringify([{ chapter: 5, state: "escalating", summary: "冲突升级" }]),
        resolutionState: "escalating",
        resolutionChapter: 20,
        relatedConflictIdsJson: "[]",
        visibilityRuleJson: JSON.stringify({ type: "global" }),
        createdAt: new Date("2026-04-25T01:00:00.000Z"),
        updatedAt: new Date("2026-04-25T01:00:00.000Z"),
      });
      await createBibleEventRepository(storage).create({
        id: "event-1",
        bookId: "book-1",
        name: "师父玉符",
        eventType: "foreshadow",
        chapterStart: 3,
        chapterEnd: 11,
        summary: "玉符将在中段回收。",
        relatedCharacterIdsJson: "[]",
        visibilityRuleJson: JSON.stringify({ type: "tracked" }),
        foreshadowState: "buried",
        createdAt: new Date("2026-04-25T01:00:00.000Z"),
        updatedAt: new Date("2026-04-25T01:00:00.000Z"),
      });

      const result = await generatePGIQuestions(storage, { bookId: "book-1", chapter: 10 });

      expect(result.questions).toHaveLength(2);
      expect(result.questions.map((question) => question.id)).toEqual(["conflict-escalate:conflict-1", "foreshadow-payoff:event-1"]);
      expect(result.heuristicsTriggered).toEqual(["conflict-escalating", "foreshadow-due"]);
    } finally {
      storage.close();
    }
  });

  it("returns no questions when no heuristic fires and truncates to five", async () => {
    const storage = await createStorage();
    try {
      expect(await generatePGIQuestions(storage, { bookId: "book-1", chapter: 1 })).toEqual({ questions: [], heuristicsTriggered: [] });
      const conflicts = createBibleConflictRepository(storage);
      for (let index = 1; index <= 8; index += 1) {
        await conflicts.create({
          id: `conflict-${index}`,
          bookId: "book-1",
          name: `矛盾${index}`,
          type: "external-character",
          scope: "arc",
          priority: index,
          protagonistSideJson: "[]",
          antagonistSideJson: "[]",
          stakes: "赌注",
          rootCauseJson: "{}",
          evolutionPathJson: JSON.stringify([{ chapter: 1, state: "escalating", summary: "升级" }]),
          resolutionState: "escalating",
          resolutionChapter: null,
          relatedConflictIdsJson: "[]",
          visibilityRuleJson: JSON.stringify({ type: "tracked" }),
          createdAt: new Date("2026-04-25T01:00:00.000Z"),
          updatedAt: new Date("2026-04-25T01:00:00.000Z"),
        });
      }
      expect((await generatePGIQuestions(storage, { bookId: "book-1", chapter: 2 })).questions).toHaveLength(5);
    } finally {
      storage.close();
    }
  });
});
