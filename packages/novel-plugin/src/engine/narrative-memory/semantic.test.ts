import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import { mergeNarrativeContextCards } from "./merge.js";
import {
  ensureNarrativeMemorySchema,
  queryNarrativeContextVectors,
  upsertNarrativeContextVector,
} from "./storage.js";
import { createSemanticChannel, exactCosineSimilarity, type NarrativeEmbeddingProvider } from "./channels/semantic-channel.js";
import type { NarrativeContextCard, NarrativeContextVector } from "./types.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-narrative-semantic-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  return createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function card(input: Partial<NarrativeContextCard> & Pick<NarrativeContextCard, "id" | "sourceType" | "sourceId" | "channel" | "title" | "content">): NarrativeContextCard {
  return {
    id: input.id,
    bookId: input.bookId ?? "book-1",
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    channel: input.channel,
    title: input.title,
    content: input.content,
    normal: input.normal,
    summary: input.summary,
    brief: input.brief ?? input.summary ?? input.content,
    tags: input.tags ?? [],
    entities: input.entities ?? [],
    priority: input.priority ?? 50,
    importance: input.importance ?? 50,
    accessCount: input.accessCount ?? 0,
    lastAccessedAt: input.lastAccessedAt,
    validFromChapter: input.validFromChapter,
    validUntilChapter: input.validUntilChapter,
    reason: input.reason ?? "test reason",
    estimatedTokens: input.estimatedTokens ?? 20,
    score: input.score,
    scoreBreakdown: input.scoreBreakdown,
  };
}

function vector(input: Partial<NarrativeContextVector> & Pick<NarrativeContextVector, "cardId" | "vector">): NarrativeContextVector {
  const sourceCard = input.sourceCard ?? card({
    id: input.cardId,
    sourceType: "jingwei",
    sourceId: input.cardId,
    channel: "semantic",
    title: input.cardId,
    content: input.cardId,
  });
  return {
    cardId: input.cardId,
    bookId: input.bookId ?? sourceCard.bookId,
    embeddingModelId: input.embeddingModelId ?? "fake-embedding-v1",
    embeddingDim: input.embeddingDim ?? input.vector.length,
    vector: input.vector,
    vectorUpdatedAt: input.vectorUpdatedAt ?? "2026-06-22T00:00:00.000Z",
    sourceCard,
  };
}

describe("Semantic vector storage and channel", () => {
  it("stores vector metadata and reports dimension mismatch candidates", async () => {
    const storage = await createStorage();
    try {
      ensureNarrativeMemorySchema(storage);
      upsertNarrativeContextVector(storage, vector({ cardId: "match", vector: [1, 0, 0] }));
      upsertNarrativeContextVector(storage, vector({ cardId: "mismatch", vector: [1, 0], embeddingDim: 2 }));

      const result = queryNarrativeContextVectors(storage, {
        bookId: "book-1",
        embeddingModelId: "fake-embedding-v1",
        embeddingDim: 3,
      });

      expect(result.vectors.map((item) => item.cardId)).toEqual(["match"]);
      expect(result.dimensionMismatchCardIds).toEqual(["mismatch"]);
      expect(result.vectors[0]?.vector).toEqual([1, 0, 0]);
    } finally {
      storage.close();
    }
  });

  it("skips semantic retrieval when disabled or provider unavailable", async () => {
    const storage = await createStorage();
    try {
      const disabled = await createSemanticChannel().run({
        storage,
        bookId: "book-1",
        currentChapter: 12,
        queryText: "韩立 小瓶",
        config: { enabled: false },
      });
      expect(disabled.status).toBe("skipped");
      expect(disabled.warnings?.[0]).toContain("disabled");

      const unavailable = await createSemanticChannel().run({
        storage,
        bookId: "book-1",
        currentChapter: 12,
        queryText: "韩立 小瓶",
        config: { enabled: true },
      });
      expect(unavailable.status).toBe("skipped");
      expect(unavailable.warnings?.[0]).toContain("provider unavailable");
    } finally {
      storage.close();
    }
  });

  it("applies entity prefilter before maxCandidates so relevant vectors are not cut off", async () => {
    const storage = await createStorage();
    try {
      const provider: NarrativeEmbeddingProvider = {
        modelId: "fake-embedding-v1",
        dim: 3,
        async embed() {
          return [1, 0, 0];
        },
      };
      upsertNarrativeContextVector(storage, vector({
        cardId: "irrelevant-newer",
        vector: [1, 0, 0],
        vectorUpdatedAt: "2026-06-22T02:00:00.000Z",
        sourceCard: card({ id: "irrelevant-newer", sourceType: "jingwei", sourceId: "irrelevant", channel: "semantic", title: "路人", content: "路人消息", entities: ["路人"] }),
      }));
      upsertNarrativeContextVector(storage, vector({
        cardId: "relevant-older",
        vector: [1, 0, 0],
        vectorUpdatedAt: "2026-06-22T01:00:00.000Z",
        sourceCard: card({ id: "relevant-older", sourceType: "jingwei", sourceId: "relevant", channel: "semantic", title: "韩立小瓶", content: "韩立的小瓶秘密。", entities: ["韩立"] }),
      }));

      const result = await createSemanticChannel().run({
        storage,
        bookId: "book-1",
        currentChapter: 12,
        queryText: "韩立 小瓶",
        entities: ["韩立"],
        provider,
        config: { enabled: true, topK: 1, minSimilarity: 0.7, maxCandidates: 1 },
      });

      expect(result.cards.map((item) => item.id)).toEqual(["relevant-older"]);
      expect(result.diagnostics?.candidateCount).toBe(1);
    } finally {
      storage.close();
    }
  });

  it("ranks semantic hits with exact cosine after visibility/entity filtering", async () => {
    const storage = await createStorage();
    try {
      const provider: NarrativeEmbeddingProvider = {
        modelId: "fake-embedding-v1",
        dim: 3,
        async embed(text) {
          if (text.includes("小瓶")) return [1, 0, 0];
          return [0, 1, 0];
        },
      };
      upsertNarrativeContextVector(storage, vector({
        cardId: "small-bottle",
        vector: [0.98, 0.02, 0],
        sourceCard: card({ id: "small-bottle", sourceType: "jingwei", sourceId: "entry-1", channel: "semantic", title: "小瓶", content: "小瓶可以催熟药草。", entities: ["韩立", "小瓶"], tags: ["item"], validFromChapter: 2 }),
      }));
      upsertNarrativeContextVector(storage, vector({
        cardId: "future-secret",
        vector: [1, 0, 0],
        sourceCard: card({ id: "future-secret", sourceType: "jingwei", sourceId: "entry-2", channel: "semantic", title: "未来秘密", content: "未来才知道的秘密。", entities: ["韩立"], validFromChapter: 20 }),
      }));
      upsertNarrativeContextVector(storage, vector({
        cardId: "unrelated",
        vector: [0, 1, 0],
        sourceCard: card({ id: "unrelated", sourceType: "jingwei", sourceId: "entry-3", channel: "semantic", title: "南宫婉", content: "南宫婉闭关。", entities: ["南宫婉"] }),
      }));

      const result = await createSemanticChannel().run({
        storage,
        bookId: "book-1",
        currentChapter: 12,
        queryText: "韩立在药园试探小瓶",
        entities: ["韩立"],
        provider,
        config: { enabled: true, topK: 2, minSimilarity: 0.7, maxCandidates: 10 },
      });

      expect(result.status).toBe("ok");
      expect(result.cards.map((item) => item.id)).toEqual(["small-bottle"]);
      expect(result.cards[0]?.channel).toBe("semantic");
      expect(result.cards[0]?.reason).toContain("semantic cosine");
      expect(result.diagnostics?.candidateCount).toBe(1);
      expect(result.diagnostics?.hitCount).toBe(1);
      expect(result.diagnostics?.dimensionMismatchCount).toBe(0);
    } finally {
      storage.close();
    }
  });

  it("preserves hard priority when semantic duplicates hard context", () => {
    const merged = mergeNarrativeContextCards([
      card({ id: "semantic-rule", sourceType: "jingwei", sourceId: "rule-1", channel: "semantic", title: "禁忌", content: "语义召回", priority: 100 }),
      card({ id: "hard-rule", sourceType: "jingwei", sourceId: "rule-1", channel: "hard", title: "禁忌", content: "硬规则", priority: 10 }),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe("hard-rule");
    expect(exactCosineSimilarity([1, 0], [0.5, 0.5])).toBeCloseTo(0.7071, 3);
  });
});
