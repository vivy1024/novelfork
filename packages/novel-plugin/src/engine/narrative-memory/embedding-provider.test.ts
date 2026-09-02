import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import { bellGain, NOVEL_ENTITY_SEMANTIC_GAIN } from "./wave/directed-cooccurrence.js";
import { ensureEntityEmbeddings, similarityFromVectors } from "./embedding-provider.js";
import { ensureNarrativeMemorySchema, queryNarrativeContextVectors } from "./storage.js";
import type { EntityDictionary } from "./entity-dictionary.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-entity-embed-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  return createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("novel entity semantic gain calibration", () => {
  it("span between median and close pair exceeds 0.3", () => {
    const close = bellGain(0.615, NOVEL_ENTITY_SEMANTIC_GAIN);
    const median = bellGain(0.256, NOVEL_ENTITY_SEMANTIC_GAIN);
    const far = bellGain(0.200, NOVEL_ENTITY_SEMANTIC_GAIN);
    expect(median - far).toBeGreaterThan(0);
    expect(Math.abs(median - close)).toBeGreaterThan(0.3);
  });
});

describe("similarityFromVectors", () => {
  it("returns undefined when a vector is missing", () => {
    const sim = similarityFromVectors(new Map([["薛行之", [1, 0]]]));
    expect(sim("薛行之", "方工")).toBeUndefined();
  });
});

describe("ensureEntityEmbeddings", () => {
  it("embeds missing entities in batches and reuses existing vectors", async () => {
    const storage = await createStorage();
    try {
      ensureNarrativeMemorySchema(storage);
      const dictionary: EntityDictionary = {
        bookId: "book-1",
        entries: [
          { entryId: "e1", category: "characters", canonicalName: "薛行之", title: "薛行之", lookupKeys: ["薛行之"] },
          { entryId: "e2", category: "characters", canonicalName: "方工", title: "方工", lookupKeys: ["方工"] },
          { entryId: "e3", category: "foreshadowing", canonicalName: "小瓶", title: "小瓶", lookupKeys: ["小瓶"] },
        ],
        index: new Map(),
      };
      const first = await ensureEntityEmbeddings({
        storage,
        bookId: "book-1",
        dictionary,
        provider: { modelId: "test-emb", dim: 2, embed: async () => [1, 0] },
        batchSize: 1,
        now: () => "2026-06-22T00:00:00.000Z",
        embedMany: async (texts) => texts.map((_, index) => [index === 0 ? 1 : 0, index === 0 ? 0 : 1]),
      });
      expect(first).toEqual({ embedded: 2, reused: 0 });
      const stored = queryNarrativeContextVectors(storage, {
        bookId: "book-1",
        embeddingModelId: "test-emb",
        embeddingDim: 2,
        limit: 0,
      });
      expect(stored.vectors.map((item) => item.sourceCard.title).sort()).toEqual(["方工", "薛行之"]);

      const second = await ensureEntityEmbeddings({
        storage,
        bookId: "book-1",
        dictionary,
        provider: { modelId: "test-emb", dim: 2, embed: async () => [1, 0] },
        embedMany: async () => {
          throw new Error("should not embed again");
        },
      });
      expect(second).toEqual({ embedded: 0, reused: 2 });
    } finally {
      storage.close();
    }
  });
});
