import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import type { ChannelRunResult, NarrativeRetrievalChannel } from "../channels.js";
import { queryNarrativeContextVectors } from "../storage.js";
import { SemanticChannelConfigSchema, type NarrativeContextCard, type SemanticChannelConfig } from "../types.js";

export interface NarrativeEmbeddingProvider {
  readonly modelId: string;
  readonly dim: number;
  embed(text: string): Promise<readonly number[]> | readonly number[];
}

export type SemanticChannelInput = Readonly<{
  storage: StorageDatabase;
  bookId: string;
  currentChapter?: number;
  queryText?: string;
  entities?: readonly string[];
  categories?: readonly string[];
  provider?: NarrativeEmbeddingProvider;
  config?: Partial<SemanticChannelConfig>;
}>;

export type SemanticChannelDiagnostics = Readonly<{
  embeddingLatencyMs: number;
  candidateCount: number;
  hitCount: number;
  dimensionMismatchCount: number;
  skippedReason?: string;
}>;

function elapsedSince(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function normalizeVector(vector: readonly number[]): number[] {
  return vector.map((value) => Number(value)).filter((value) => Number.isFinite(value));
}

export function exactCosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return Number.NEGATIVE_INFINITY;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    const av = a[index] ?? 0;
    const bv = b[index] ?? 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA <= 0 || normB <= 0) return Number.NEGATIVE_INFINITY;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function withSemanticScore(card: NarrativeContextCard, similarity: number): NarrativeContextCard {
  return {
    ...card,
    channel: "semantic",
    priority: Math.max(card.priority, 45 + similarity * 40),
    reason: `${card.reason}；semantic cosine=${similarity.toFixed(3)}`,
    scoreBreakdown: {
      ...(card.scoreBreakdown ?? {}),
      semanticSimilarity: similarity,
    },
  };
}

export function createSemanticChannel(): NarrativeRetrievalChannel<SemanticChannelInput> {
  return {
    name: "semantic",
    async run(input): Promise<ChannelRunResult & { readonly diagnostics: SemanticChannelDiagnostics }> {
      const config = SemanticChannelConfigSchema.parse({
        enabled: false,
        maxCandidates: 80,
        topK: 8,
        minSimilarity: 0.72,
        ...(input.config ?? {}),
      });
      if (!config.enabled) {
        return {
          status: "skipped",
          cards: [],
          warnings: ["semantic channel disabled"],
          diagnostics: { embeddingLatencyMs: 0, candidateCount: 0, hitCount: 0, dimensionMismatchCount: 0, skippedReason: "disabled" },
        };
      }
      if (!input.provider) {
        return {
          status: "skipped",
          cards: [],
          warnings: ["semantic provider unavailable"],
          diagnostics: { embeddingLatencyMs: 0, candidateCount: 0, hitCount: 0, dimensionMismatchCount: 0, skippedReason: "provider unavailable" },
        };
      }
      const queryText = input.queryText?.trim() || [...(input.entities ?? []), ...(input.categories ?? [])].join(" ").trim();
      if (!queryText) {
        return {
          status: "skipped",
          cards: [],
          warnings: ["semantic query text empty"],
          diagnostics: { embeddingLatencyMs: 0, candidateCount: 0, hitCount: 0, dimensionMismatchCount: 0, skippedReason: "empty query" },
        };
      }

      const embedStartedAt = performance.now();
      const queryVector = normalizeVector(await input.provider.embed(queryText));
      const embeddingLatencyMs = elapsedSince(embedStartedAt);
      if (queryVector.length !== input.provider.dim) {
        return {
          status: "skipped",
          cards: [],
          warnings: [`semantic query vector dimension mismatch: expected ${input.provider.dim}, got ${queryVector.length}`],
          diagnostics: { embeddingLatencyMs, candidateCount: 0, hitCount: 0, dimensionMismatchCount: 0, skippedReason: "query dimension mismatch" },
        };
      }

      const candidates = queryNarrativeContextVectors(input.storage, {
        bookId: input.bookId,
        embeddingModelId: input.provider.modelId,
        embeddingDim: input.provider.dim,
        currentChapter: input.currentChapter,
        entities: input.entities,
        categories: input.categories,
        limit: config.maxCandidates,
      });
      const hits = candidates.vectors
        .map((item) => ({ item, similarity: exactCosineSimilarity(queryVector, item.vector) }))
        .filter((item) => item.similarity >= config.minSimilarity)
        .sort((a, b) => b.similarity - a.similarity || a.item.cardId.localeCompare(b.item.cardId))
        .slice(0, config.topK);
      const cards = hits.map((hit) => withSemanticScore(hit.item.sourceCard, hit.similarity));

      return {
        status: cards.length > 0 ? "ok" : "skipped",
        cards,
        warnings: cards.length > 0 ? [] : ["semantic channel found no hits"],
        diagnostics: {
          embeddingLatencyMs,
          candidateCount: candidates.vectors.length,
          hitCount: cards.length,
          dimensionMismatchCount: candidates.dimensionMismatchCardIds.length,
        },
      };
    },
  };
}
