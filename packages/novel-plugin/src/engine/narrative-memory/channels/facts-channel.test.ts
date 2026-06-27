import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import type { SceneSpec } from "../../../handlers/scene-spec-handler.js";
import { upsertNarrativeFact } from "../facts.js";
import { ensureNarrativeMemorySchema } from "../storage.js";
import type { NarrativeFact } from "../types.js";
import { createFactsChannel } from "./facts-channel.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-facts-channel-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  ensureNarrativeMemorySchema(storage);
  return storage;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function fact(input: Partial<NarrativeFact> & Pick<NarrativeFact, "id" | "subject" | "predicate" | "object">): NarrativeFact {
  return {
    id: input.id,
    bookId: input.bookId ?? "book-1",
    subject: input.subject,
    predicate: input.predicate,
    object: input.object,
    category: input.category ?? "state",
    layer: input.layer ?? "dynamic",
    confidence: input.confidence ?? 0.9,
    sourceType: input.sourceType ?? "manual",
    sourceId: input.sourceId,
    sourceChapter: input.sourceChapter,
    evidenceText: input.evidenceText,
    validFromChapter: input.validFromChapter,
    validUntilChapter: input.validUntilChapter,
    createdAt: input.createdAt ?? "2026-06-22T00:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-06-22T00:00:00.000Z",
  };
}

const sceneSpec: SceneSpec = {
  chapter: 12,
  title: "药园试探",
  wordTarget: 3000,
  scenes: [{
    characters: ["韩立", "墨大夫"],
    location: "七玄门药园",
    conflict: "韩立隐藏小瓶",
    mood: "紧张→克制",
    outcome: "守住秘密",
    hooks_used: ["小瓶异动"],
    hooks_planted: [],
  }],
  constraints: [],
};

describe("facts channel", () => {
  it("returns direct and one-hop fact cards from sceneSpec/entities/sceneText", async () => {
    const storage = await createStorage();
    try {
      upsertNarrativeFact(storage, fact({ id: "direct-1", subject: "韩立", predicate: "持有", object: "小瓶", category: "inventory", validFromChapter: 3, evidenceText: "韩立收好小瓶。" }));
      upsertNarrativeFact(storage, fact({ id: "direct-2", subject: "墨大夫", predicate: "怀疑", object: "韩立", category: "relationship", validFromChapter: 10 }));
      upsertNarrativeFact(storage, fact({ id: "hop-1", subject: "小瓶", predicate: "能力", object: "催熟灵草", category: "world", validFromChapter: 3 }));
      upsertNarrativeFact(storage, fact({ id: "future", subject: "韩立", predicate: "获得", object: "筑基丹", validFromChapter: 12 }));

      const result = await createFactsChannel().run({
        storage,
        bookId: "book-1",
        currentChapter: 12,
        sceneSpec,
        sceneText: "韩立在七玄门药园检查小瓶，墨大夫暗中观察。",
        entities: ["小瓶"],
        maxPerEntity: 2,
        limit: 10,
      });

      const ids = result.cards.map((card) => card.sourceId);
      const text = result.cards.map((card) => `${card.title}\n${card.content}\n${card.reason}`).join("\n");
      expect(ids).toEqual(expect.arrayContaining(["direct-1", "direct-2", "hop-1"]));
      expect(text).toContain("韩立 持有 小瓶");
      expect(text).toContain("有效章节");
      expect(text).toContain("confidence");
      expect(text).not.toContain("筑基丹");
      expect(result.warnings).toEqual([]);
    } finally {
      storage.close();
    }
  });

  it("respects total limit and dedupes duplicate fact tuples", async () => {
    const storage = await createStorage();
    try {
      upsertNarrativeFact(storage, fact({ id: "a", subject: "韩立", predicate: "持有", object: "小瓶", validFromChapter: 3, confidence: 0.95 }));
      upsertNarrativeFact(storage, fact({ id: "b", subject: "韩立", predicate: "持有", object: "小瓶", validFromChapter: 3, confidence: 0.8 }));
      upsertNarrativeFact(storage, fact({ id: "c", subject: "小瓶", predicate: "能力", object: "催熟灵草", validFromChapter: 3 }));
      upsertNarrativeFact(storage, fact({ id: "d", subject: "小瓶", predicate: "来源", object: "未知", validFromChapter: 3 }));

      const result = await createFactsChannel().run({
        storage,
        bookId: "book-1",
        currentChapter: 12,
        entities: ["韩立"],
        maxPerEntity: 3,
        limit: 2,
      });

      expect(result.cards).toHaveLength(2);
      expect(result.cards.map((card) => card.sourceId)).toContain("a");
      expect(result.cards.map((card) => card.sourceId)).not.toContain("b");
    } finally {
      storage.close();
    }
  });

  it("returns skipped warning when no query entities or facts are available", async () => {
    const storage = await createStorage();
    try {
      const result = await createFactsChannel().run({ storage, bookId: "book-1", currentChapter: 12 });

      expect(result.status).toBe("skipped");
      expect(result.cards).toEqual([]);
      expect(result.warnings?.[0]).toContain("facts channel 为空");
    } finally {
      storage.close();
    }
  });
});
