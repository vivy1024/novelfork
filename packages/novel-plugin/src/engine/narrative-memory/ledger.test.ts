import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import { upsertNarrativeFact } from "./facts.js";
import {
  closeSupersededNarrativeFacts,
  narrativeFactSlotKey,
  queryCurrentNarrativeLedger,
} from "./ledger.js";
import { queryNarrativeFactSlotHeads } from "./storage.js";
import type { NarrativeFact } from "./types.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-nm-ledger-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  return createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
}

function fact(partial: Partial<NarrativeFact> & Pick<NarrativeFact, "id" | "subject" | "predicate" | "object">): NarrativeFact {
  const now = "2026-07-22T00:00:00.000Z";
  return {
    id: partial.id,
    bookId: partial.bookId ?? "book-1",
    subject: partial.subject,
    predicate: partial.predicate,
    object: partial.object,
    category: partial.category ?? "character_state",
    layer: partial.layer ?? "dynamic",
    confidence: partial.confidence ?? 0.9,
    sourceType: partial.sourceType ?? "event",
    sourceId: partial.sourceId,
    sourceChapter: partial.sourceChapter,
    evidenceText: partial.evidenceText,
    validFromChapter: partial.validFromChapter,
    validUntilChapter: partial.validUntilChapter,
    createdAt: partial.createdAt ?? now,
    updatedAt: partial.updatedAt ?? now,
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("narrative memory ledger", () => {
  it("uses subject+predicate slot for character_state and includes object for relationship", () => {
    expect(
      narrativeFactSlotKey({
        bookId: "b",
        category: "character_state",
        subject: "韩立",
        predicate: "状态",
        object: "谨慎",
      }),
    ).toBe(
      narrativeFactSlotKey({
        bookId: "b",
        category: "character_state",
        subject: "韩立",
        predicate: "状态",
        object: "更谨慎",
      }),
    );
    expect(
      narrativeFactSlotKey({
        bookId: "b",
        category: "relationship",
        subject: "韩立",
        predicate: "敌对",
        object: "墨大夫",
      }),
    ).not.toBe(
      narrativeFactSlotKey({
        bookId: "b",
        category: "relationship",
        subject: "韩立",
        predicate: "敌对",
        object: "厉飞雨",
      }),
    );
  });

  it("folds all matching history before applying the requested limit", async () => {
    const storage = await createStorage();
    try {
      for (let index = 0; index < 499; index += 1) {
        upsertNarrativeFact(storage, fact({
          id: `f-${index}`,
          subject: `角色-${index}`,
          predicate: "状态",
          object: "存活",
          confidence: 0.95,
          sourceChapter: index + 1,
          validFromChapter: index + 1,
          updatedAt: "2026-07-22T02:00:00.000Z",
        }));
      }
      // The superseded row sorts into the old 500-row pre-fold window while
      // the actual current row is low-confidence and would be outside it.
      upsertNarrativeFact(storage, fact({
        id: "target-old",
        subject: "目标角色",
        predicate: "状态",
        object: "旧状态",
        confidence: 0.95,
        sourceChapter: 1,
        validFromChapter: 1,
        validUntilChapter: 2,
        updatedAt: "2026-07-22T03:00:00.000Z",
      }));
      upsertNarrativeFact(storage, fact({
        id: "target-current",
        subject: "目标角色",
        predicate: "状态",
        object: "新状态",
        confidence: 0.1,
        sourceChapter: 3,
        validFromChapter: 3,
        updatedAt: "2026-07-22T00:00:00.000Z",
      }));

      const current = queryCurrentNarrativeLedger(storage, { bookId: "book-1", limit: 501 });
      expect(current.items).toHaveLength(500);
      expect(current.items.find((item) => item.subject === "目标角色")).toMatchObject({ id: "target-current", object: "新状态" });
    } finally {
      storage.close();
    }
  });

  it("closes superseded open facts and returns only current ledger rows", async () => {
    const storage = await createStorage();
    try {
      upsertNarrativeFact(
        storage,
        fact({
          id: "f-old",
          subject: "韩立",
          predicate: "状态",
          object: "谨慎",
          validFromChapter: 3,
          sourceChapter: 3,
        }),
      );
      const next = fact({
        id: "f-new",
        subject: "韩立",
        predicate: "状态",
        object: "更谨慎",
        validFromChapter: 12,
        sourceChapter: 12,
        confidence: 0.95,
        updatedAt: "2026-07-22T01:00:00.000Z",
      });
      const closed = closeSupersededNarrativeFacts(storage, next, 12);
      expect(closed).toBe(1);
      upsertNarrativeFact(storage, next);

      const current = queryCurrentNarrativeLedger(storage, { bookId: "book-1", limit: 40 });
      expect(current.items).toHaveLength(1);
      expect(current.items[0]?.id).toBe("f-new");
      expect(current.items[0]?.object).toBe("更谨慎");
      expect(current.counts.byCategory.character_state).toBe(1);

      const again = closeSupersededNarrativeFacts(storage, next, 12);
      expect(again).toBe(0);
    } finally {
      storage.close();
    }
  });

  it("SQL slot-head fold picks the same row as the JS fold, including tie-breaks", async () => {
    const storage = await createStorage();
    try {
      upsertNarrativeFact(storage, fact({ id: "a", subject: "韩立", predicate: "状态", object: "甲", validFromChapter: 3, confidence: 0.8, updatedAt: "2026-07-22T01:00:00.000Z" }));
      upsertNarrativeFact(storage, fact({ id: "b", subject: "韩立", predicate: "状态", object: "乙", validFromChapter: 3, confidence: 0.9, updatedAt: "2026-07-22T00:00:00.000Z" }));
      upsertNarrativeFact(storage, fact({ id: "c", subject: "  韩  立  ", predicate: "状态", object: "丙", validFromChapter: 5, confidence: 0.1, updatedAt: "2026-07-22T02:00:00.000Z" }));

      const js = queryCurrentNarrativeLedger(storage, { bookId: "book-1", categories: ["character_state"], limit: 500 }).items.map((item) => item.id).sort();
      const sql = queryNarrativeFactSlotHeads(storage, { bookId: "book-1", categories: ["character_state"] }).map((item) => item.id).sort();
      expect(sql).toEqual(js);

      const jsAsOf = queryCurrentNarrativeLedger(storage, { bookId: "book-1", asOfChapter: 4, categories: ["character_state"], limit: 500 }).items.map((item) => item.id).sort();
      const sqlAsOf = queryNarrativeFactSlotHeads(storage, { bookId: "book-1", categories: ["character_state"], asOfChapter: 4 }).map((item) => item.id).sort();
      expect(sqlAsOf).toEqual(jsAsOf);
    } finally {
      storage.close();
    }
  });

  it("closes only the superseded row in the same slot, leaving other open facts in the category untouched", async () => {
    const storage = await createStorage();
    try {
      upsertNarrativeFact(storage, fact({ id: "same-slot-old", subject: "韩立", predicate: "状态", object: "旧", validFromChapter: 1 }));
      upsertNarrativeFact(storage, fact({ id: "other-slot", subject: "墨大夫", predicate: "状态", object: "怀疑", validFromChapter: 1 }));
      const next = fact({ id: "same-slot-new", subject: "韩立", predicate: "状态", object: "新", validFromChapter: 5, updatedAt: "2026-07-22T01:00:00.000Z" });

      expect(closeSupersededNarrativeFacts(storage, next, 5)).toBe(1);

      const otherOpen = storage.sqlite.prepare<{ valid_until_chapter: number | null }>("SELECT valid_until_chapter FROM narrative_fact WHERE id = ?").get("other-slot");
      expect(otherOpen?.valid_until_chapter).toBeNull();
    } finally {
      storage.close();
    }
  });

  it("SQL slot-head fold breaks a full tie the same way the JS fold does", async () => {
    const storage = await createStorage();
    try {
      upsertNarrativeFact(storage, fact({ id: "z-tie", subject: "韩立", predicate: "状态", object: "甲", validFromChapter: 3, confidence: 0.9, updatedAt: "2026-07-22T01:00:00.000Z" }));
      upsertNarrativeFact(storage, fact({ id: "a-tie", subject: "韩立", predicate: "状态", object: "乙", validFromChapter: 3, confidence: 0.9, updatedAt: "2026-07-22T01:00:00.000Z" }));

      const js = queryCurrentNarrativeLedger(storage, { bookId: "book-1", categories: ["character_state"], limit: 500 }).items.map((item) => item.id);
      const sql = queryNarrativeFactSlotHeads(storage, { bookId: "book-1", categories: ["character_state"] }).map((item) => item.id);
      expect(sql).toEqual(js);
    } finally {
      storage.close();
    }
  });
});
