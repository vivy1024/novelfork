import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { commitChapterStateDelta } from "../../../core/src/state/chapter-state-commit.js";
import { loadChapterStateProjection } from "../../../core/src/state/chapter-state-reduce.js";

import { derivedFactsFromProjection } from "./lore-memory-boundary-handlers.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-memory-graph-derived-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  storage.sqlite.exec(`CREATE TABLE IF NOT EXISTS book (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    jingwei_mode TEXT NOT NULL DEFAULT 'dynamic',
    current_chapter INTEGER NOT NULL DEFAULT 0,
    state_revision INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );`);
  storage.sqlite.prepare(`INSERT INTO book (id, name, created_at, updated_at) VALUES ('book-1', '测试书籍', 0, 0)`).run();
  return storage;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("memory.graph derived views", () => {
  it("projects reduced ChapterStateDelta facts for relationship, timeline, character_arc and foreshadowing", async () => {
    const storage = await createStorage();
    try {
      commitChapterStateDelta(storage, {
        bookId: "book-1",
        delta: {
          chapterNumber: 12,
          characters: [{ characterId: "han-li", name: "韩立", currentState: "抵达药园", knowledge: [] }],
          relationships: [{
            source: "韩立",
            target: "墨大夫",
            relationType: "师徒",
            sentiment: "complicated",
            status: "evolving",
            description: "药园试探加深猜忌",
          }],
          hooks: [{ hookId: "small-bottle", action: "upsert", type: "mystery", status: "open", notes: "小瓶" }],
          timeline: { chapter: 12, storyTime: "入门第三日黄昏", label: "药园试探" },
          commitments: [],
          resources: [],
          knowledge: [],
          notes: [],
        },
      });

      const projection = loadChapterStateProjection(storage, "book-1");
      const facts = derivedFactsFromProjection("book-1", projection);
      expect(projection.stateRevision).toBe(1);
      expect(facts.map((item) => item.id)).toEqual(expect.arrayContaining([
        "derived:character:han-li",
        "derived:relationship:韩立:墨大夫:师徒",
        "derived:hook:small-bottle",
        "derived:timeline:12",
      ]));
      expect(facts.find((item) => item.id === "derived:character:han-li")).toMatchObject({
        category: "character_state",
        subject: "韩立",
        object: "抵达药园",
      });
    } finally {
      storage.close();
    }
  });
});
