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
});
