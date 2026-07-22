import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import type { SceneSpec } from "../../handlers/scene-spec-handler.js";
import { buildNarrativeContext } from "./build-narrative-context.js";
import { upsertNarrativeFact } from "./facts.js";
import { upsertNarrativeContextVector } from "./storage.js";
import type { NarrativeEmbeddingProvider } from "./channels/semantic-channel.js";
import type { NarrativeContextCard, NarrativeContextVector, NarrativeFact } from "./types.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-build-narrative-context-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  return createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
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
    category: input.category ?? "character_state",
    layer: input.layer ?? "dynamic",
    confidence: input.confidence ?? 0.9,
    sourceType: input.sourceType ?? "event",
    sourceId: input.sourceId,
    sourceChapter: input.sourceChapter,
    evidenceText: input.evidenceText,
    validFromChapter: input.validFromChapter,
    validUntilChapter: input.validUntilChapter,
    createdAt: input.createdAt ?? "2026-06-22T00:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-06-22T00:00:00.000Z",
  };
}

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

function vector(input: Partial<NarrativeContextVector> & Pick<NarrativeContextVector, "cardId" | "vector" | "sourceCard">): NarrativeContextVector {
  return {
    cardId: input.cardId,
    bookId: input.bookId ?? input.sourceCard.bookId,
    embeddingModelId: input.embeddingModelId ?? "fake-embedding-v1",
    embeddingDim: input.embeddingDim ?? input.vector.length,
    vector: input.vector,
    vectorUpdatedAt: input.vectorUpdatedAt ?? "2026-06-22T00:00:00.000Z",
    sourceCard: input.sourceCard,
  };
}

const sceneSpec: SceneSpec = {
  chapter: 12,
  title: "药园试探",
  wordTarget: 3200,
  scenes: [{
    characters: ["韩立"],
    location: "药园",
    conflict: "韩立试探小瓶秘密",
    mood: "谨慎",
    outcome: "发现小瓶催熟药草",
    hooks_used: ["小瓶"],
    hooks_planted: ["墨大夫怀疑"],
  }],
  constraints: ["不得让墨大夫直接知道小瓶秘密"],
};

describe("buildNarrativeContext", () => {
  it("runs MVP channels and returns packed sections with diagnostics/log", async () => {
    const storage = await createStorage();
    try {
      upsertNarrativeFact(storage, fact({
        id: "fact-1",
        subject: "韩立",
        predicate: "持有",
        object: "小瓶",
        sourceChapter: 10,
        validFromChapter: 10,
        evidenceText: "韩立藏起小瓶。",
      }));

      const result = await buildNarrativeContext({
        storage,
        bookId: "book-1",
        purpose: "write_chapter",
        chapterNumber: 12,
        sceneSpec,
        sceneText: "韩立在药园观察小瓶。",
        entities: ["韩立", "小瓶"],
        maxTokens: 2000,
        previousChapterTail: "韩立带着药草回到药园。",
        styleGuideText: "文风克制，避免现代词。",
      });

      expect(result.bookId).toBe("book-1");
      expect(result.purpose).toBe("write_chapter");
      expect(result.cards.length).toBeGreaterThan(0);
      expect(result.sections.hard).toContain("<hard_constraints>");
      expect(result.sections.state).toContain("<narrative_state>");
      expect(result.sections.timeline).toContain("<timeline_context>");
      expect(result.sections.facts).toContain("<known_facts>");
      expect(result.sections.style).toContain("<style_rules>");
      expect(result.sections.semantic).toContain("<semantic_memory>");
      expect(result.diagnostics.channelStats.map((item) => item.channel)).toEqual(expect.arrayContaining(["scene-spec", "hard", "state", "timeline", "hooks", "facts", "style"]));
      expect(result.diagnostics.totalEstimatedTokens).toBeGreaterThan(0);
      const logRows = storage.sqlite.prepare<{ count: number }>("SELECT COUNT(*) AS count FROM narrative_retrieval_log").get();
      expect(logRows?.count).toBe(1);
    } finally {
      storage.close();
    }
  });

  it("honors book-level recall channel switches", async () => {
    const storage = await createStorage();
    try {
      upsertNarrativeFact(storage, fact({
        id: "state-fact",
        subject: "韩立",
        predicate: "状态",
        object: "谨慎",
        validFromChapter: 10,
      }));

      const result = await buildNarrativeContext({
        storage,
        bookId: "book-1",
        purpose: "write_chapter",
        chapterNumber: 12,
        sceneSpec,
        entities: ["韩立"],
        enabledChannels: { state: false, facts: false, timeline: false, hooks: false, style: false, semantic: false },
      });

      expect(result.cards.some((item) => item.channel === "state" || item.channel === "facts")).toBe(false);
      expect(result.diagnostics.channelStats).toEqual(expect.arrayContaining([
        expect.objectContaining({ channel: "state", status: "skipped" }),
        expect.objectContaining({ channel: "facts", status: "skipped" }),
      ]));
    } finally {
      storage.close();
    }
  });

  it("includes semantic channel when enabled and records semantic diagnostics", async () => {
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
        cardId: "sem-1",
        vector: [0.99, 0.01, 0],
        sourceCard: card({
          id: "sem-1",
          sourceType: "jingwei",
          sourceId: "sem-entry-1",
          channel: "semantic",
          title: "小瓶催熟",
          content: "小瓶能催熟药草，韩立必须保密。",
          entities: ["韩立", "小瓶"],
          tags: ["item"],
          validFromChapter: 2,
        }),
      }));

      const result = await buildNarrativeContext({
        storage,
        bookId: "book-1",
        purpose: "write_chapter",
        chapterNumber: 12,
        sceneSpec,
        sceneText: "韩立继续试探小瓶。",
        entities: ["韩立", "小瓶"],
        semanticProvider: provider,
        semanticConfig: { enabled: true, topK: 3, minSimilarity: 0.7, maxCandidates: 10 },
      });

      expect(result.sections.semantic).toContain("小瓶催熟");
      const semanticStat = result.diagnostics.channelStats.find((item) => item.channel === "semantic");
      expect(semanticStat?.status).toBe("ok");
      expect(semanticStat?.metadata).toEqual(expect.objectContaining({ hitCount: 1, candidateCount: 1 }));
    } finally {
      storage.close();
    }
  });

  it("keeps MVP behavior when wave is disabled and records wave diagnostics when enabled", async () => {
    const storage = await createStorage();
    try {
      const base = await buildNarrativeContext({
        storage,
        bookId: "book-1",
        purpose: "write_chapter",
        chapterNumber: 12,
        sceneSpec,
        sceneText: "韩立继续试探小瓶。",
        entities: ["韩立", "小瓶"],
        waveConfig: { enabled: false },
      });
      expect(base.diagnostics.wave).toBeUndefined();

      const waved = await buildNarrativeContext({
        storage,
        bookId: "book-1",
        purpose: "write_chapter",
        chapterNumber: 12,
        sceneSpec,
        sceneText: "韩立继续试探小瓶。",
        entities: ["韩立", "小瓶"],
        waveConfig: { enabled: true, rerankAlpha: 0.4 },
      });
      expect(waved.diagnostics.wave).toEqual(expect.objectContaining({
        logicDepth: expect.any(Number),
        entropy: expect.any(Number),
        activatedTags: expect.any(Array),
        residualLevels: expect.any(Number),
        semanticGainPeak: expect.any(Number),
        rerankAlpha: 0.4,
        fallbackLevel: expect.any(String),
      }));
      expect(waved.diagnostics.wave?.residualLevels).toBeGreaterThan(0);
      expect(waved.diagnostics.wave?.fallbackLevel).not.toBe("L2");
    } finally {
      storage.close();
    }
  });
});
