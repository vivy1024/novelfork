import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import {
  expandFactsOneHop,
  factToContextCard,
  searchFactsByEntities,
  upsertNarrativeFact,
} from "./facts.js";
import { ensureNarrativeMemorySchema } from "./storage.js";
import type { NarrativeFact } from "./types.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-narrative-facts-${crypto.randomUUID()}`);
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

describe("Narrative facts", () => {
  it("upserts and searches direct facts by entity/category/predicate", async () => {
    const storage = await createStorage();
    try {
      upsertNarrativeFact(storage, fact({ id: "f-1", subject: "韩立", predicate: "持有", object: "小瓶", category: "inventory", validFromChapter: 3 }));
      upsertNarrativeFact(storage, fact({ id: "f-1", subject: "韩立", predicate: "持有", object: "神秘小瓶", category: "inventory", validFromChapter: 3, confidence: 0.95 }));
      upsertNarrativeFact(storage, fact({ id: "f-2", subject: "墨大夫", predicate: "怀疑", object: "韩立", category: "relationship", validFromChapter: 10 }));

      const direct = searchFactsByEntities(storage, {
        bookId: "book-1",
        entities: ["韩立"],
        predicates: ["持有"],
        categories: ["inventory"],
        currentChapter: 12,
      });

      expect(direct.map((item) => item.id)).toEqual(["f-1"]);
      expect(direct[0]?.object).toBe("神秘小瓶");
      expect(direct[0]?.confidence).toBe(0.95);
    } finally {
      storage.close();
    }
  });

  it("blocks future facts when searching current chapter", async () => {
    const storage = await createStorage();
    try {
      upsertNarrativeFact(storage, fact({ id: "past", subject: "韩立", predicate: "持有", object: "小瓶", validFromChapter: 11 }));
      upsertNarrativeFact(storage, fact({ id: "current", subject: "韩立", predicate: "获得", object: "筑基丹", validFromChapter: 12 }));
      upsertNarrativeFact(storage, fact({ id: "future", subject: "韩立", predicate: "进入", object: "筑基期", sourceChapter: 13, validFromChapter: 13 }));

      const result = searchFactsByEntities(storage, { bookId: "book-1", entities: ["韩立"], currentChapter: 12 });

      expect(result.map((item) => item.id)).toEqual(["past"]);
    } finally {
      storage.close();
    }
  });

  it("expands one-hop related facts with per-entity and total limits", async () => {
    const storage = await createStorage();
    try {
      upsertNarrativeFact(storage, fact({ id: "direct-1", subject: "韩立", predicate: "持有", object: "小瓶", validFromChapter: 3 }));
      upsertNarrativeFact(storage, fact({ id: "direct-2", subject: "韩立", predicate: "被怀疑", object: "墨大夫", validFromChapter: 10 }));
      upsertNarrativeFact(storage, fact({ id: "hop-1", subject: "小瓶", predicate: "能力", object: "催熟灵草", validFromChapter: 3 }));
      upsertNarrativeFact(storage, fact({ id: "hop-2", subject: "墨大夫", predicate: "目标", object: "夺舍", validFromChapter: 8 }));
      upsertNarrativeFact(storage, fact({ id: "hop-3", subject: "墨大夫", predicate: "地点", object: "七玄门", validFromChapter: 1 }));
      upsertNarrativeFact(storage, fact({ id: "hop-4", subject: "墨大夫", predicate: "状态", object: "试探中", validFromChapter: 11 }));

      const expanded = expandFactsOneHop(storage, {
        bookId: "book-1",
        entities: ["韩立"],
        currentChapter: 12,
        maxPerEntity: 2,
        limit: 5,
      });

      expect(expanded.map((item) => item.id)).toEqual(["direct-1", "direct-2", "hop-1", "hop-2", "hop-3"]);
    } finally {
      storage.close();
    }
  });

  it("dedupes duplicate facts and converts fact to ContextCard", async () => {
    const storage = await createStorage();
    try {
      upsertNarrativeFact(storage, fact({ id: "a", subject: "韩立", predicate: "持有", object: "小瓶", validFromChapter: 3, evidenceText: "韩立收好小瓶。" }));
      upsertNarrativeFact(storage, fact({ id: "b", subject: "韩立", predicate: "持有", object: "小瓶", validFromChapter: 3, confidence: 0.8 }));

      const result = searchFactsByEntities(storage, { bookId: "book-1", entities: ["韩立"], currentChapter: 12 });
      const card = factToContextCard(result[0]!, "直接命中实体：韩立");

      expect(result.map((item) => item.id)).toEqual(["a"]);
      expect(card.sourceType).toBe("fact");
      expect(card.channel).toBe("facts");
      expect(card.reason).toContain("韩立");
      expect(card.brief).toContain("韩立 持有 小瓶");
      expect(card.validFromChapter).toBe(3);
    } finally {
      storage.close();
    }
  });
});
