/**
 * 生产 embedding provider：走独立 embedding 配置（硅基流动 OpenAI 兼容 /v1/embeddings）。
 *
 * 无配置 / 无 apiKey 时返回 null，调用方保持现有行为（bellGain 不调制）。
 * 密钥落在 NovelFork 产品库 kv_store，不写 .env、不入仓库。
 */

import { createEmbeddings, type EmbeddingConfig } from "@vivy1024/novelfork-core";
import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { loadEmbeddingConfig } from "./embedding-settings.js";

export {
  DEFAULT_EMBEDDING_BASE_URL,
  DEFAULT_EMBEDDING_DIM,
  DEFAULT_EMBEDDING_MODEL,
} from "./embedding-settings.js";

import type { NarrativeEmbeddingProvider } from "./channels/semantic-channel.js";
import { exactCosineSimilarity } from "./channels/semantic-channel.js";
import { upsertNarrativeContextVector, queryNarrativeContextVectors } from "./storage.js";
import type { EntityDictionary } from "./entity-dictionary.js";

/**
 * 小说实体对的 bellGain 标定（bge-m3，真实书实体抽样）：
 *   薛行之↔薛建国 sim=0.615；薛行之↔方工 0.256；薛行之↔B-17异常波形 0.200
 *   中位数约 0.256，默认 center=0.5 会把大部分边压到钟形左侧。
 * 因此小说场景用 center=0.26 / width=0.22。
 */
export const NOVEL_ENTITY_SEMANTIC_GAIN = {
  center: 0.26,
  width: 0.22,
  floor: 0.1,
  ceiling: 1.0,
} as const;

export function createSiliconFlowEmbeddingProvider(
  config: EmbeddingConfig,
): NarrativeEmbeddingProvider {
  return {
    modelId: config.model,
    dim: config.dim,
    async embed(text: string): Promise<readonly number[]> {
      const result = await createEmbeddings(config, [text]);
      return result.vectors[0] ?? [];
    },
  };
}

/**
 * 有 embedding 配置时把缺失的实体向量写入 narrative_context_vector。
 * 无密钥 / 字典为空时跳过，不阻断结算或读图。
 */
export async function refreshBookEntityEmbeddings(input: {
  readonly storage: StorageDatabase;
  readonly bookId: string;
  readonly dictionary: EntityDictionary;
}): Promise<{ readonly embedded: number; readonly reused: number; readonly skipped?: string }> {
  const config = await loadEmbeddingConfig(input.storage);
  if (!config) return { embedded: 0, reused: 0, skipped: "no-embedding-config" };
  if (input.dictionary.entries.length === 0) return { embedded: 0, reused: 0, skipped: "empty-dictionary" };
  const provider = createSiliconFlowEmbeddingProvider(config);
  return ensureEntityEmbeddings({
    storage: input.storage,
    bookId: input.bookId,
    dictionary: input.dictionary,
    provider,
    embedMany: async (texts) => {
      const result = await createEmbeddings(config, texts);
      return result.vectors;
    },
  });
}

function entityCardId(bookId: string, canonicalName: string, modelId: string): string {
  return `entity-emb:${bookId}:${modelId}:${encodeURIComponent(canonicalName)}`;
}

export async function ensureEntityEmbeddings(input: {
  readonly storage: StorageDatabase;
  readonly bookId: string;
  readonly dictionary: EntityDictionary;
  readonly provider: NarrativeEmbeddingProvider;
  readonly embedMany: (texts: readonly string[]) => Promise<readonly (readonly number[])[]>;
  readonly now?: () => string;
  readonly batchSize?: number;
}): Promise<{ readonly embedded: number; readonly reused: number }> {
  const existing = queryNarrativeContextVectors(input.storage, {
    bookId: input.bookId,
    embeddingModelId: input.provider.modelId,
    embeddingDim: input.provider.dim,
    limit: 0,
  });
  const have = new Set(existing.vectors.map((item) => item.sourceCard.title));
  const missing = input.dictionary.entries
    .filter((entry) => entry.category !== "foreshadowing" && !have.has(entry.canonicalName));
  if (missing.length === 0) return { embedded: 0, reused: have.size };

  const batchSize = Math.max(1, input.batchSize ?? 64);
  const vectors: (readonly number[])[] = [];
  for (let offset = 0; offset < missing.length; offset += batchSize) {
    const batch = missing.slice(offset, offset + batchSize);
    const batchVectors = await input.embedMany(batch.map((entry) => entry.canonicalName));
    vectors.push(...batchVectors);
  }
  const now = input.now?.() ?? new Date().toISOString();
  let embedded = 0;
  for (const [index, entry] of missing.entries()) {
    const vector = vectors[index];
    if (!vector || vector.length !== input.provider.dim) continue;
    upsertNarrativeContextVector(input.storage, {
      cardId: entityCardId(input.bookId, entry.canonicalName, input.provider.modelId),
      bookId: input.bookId,
      embeddingModelId: input.provider.modelId,
      embeddingDim: input.provider.dim,
      vector: [...vector],
      vectorUpdatedAt: now,
      sourceCard: {
        id: entry.entryId,
        bookId: input.bookId,
        sourceType: "jingwei",
        sourceId: entry.entryId,
        channel: "semantic",
        title: entry.canonicalName,
        content: entry.title,
        brief: entry.canonicalName,
        tags: [entry.category],
        entities: [entry.canonicalName],
        priority: 50,
        importance: 50,
        accessCount: 0,
        reason: "entity embedding",
        estimatedTokens: Math.max(1, Math.ceil(entry.canonicalName.length / 2)),
      },
    });
    embedded += 1;
  }
  return { embedded, reused: have.size };
}

export function similarityFromVectors(
  vectors: ReadonlyMap<string, readonly number[]>,
): (sourceId: string, targetId: string) => number | undefined {
  return (sourceId, targetId) => {
    const left = vectors.get(sourceId);
    const right = vectors.get(targetId);
    if (!left || !right) return undefined;
    const sim = exactCosineSimilarity(left, right);
    return Number.isFinite(sim) ? sim : undefined;
  };
}

export function loadEntityVectorsFromStore(
  storage: StorageDatabase,
  bookId: string,
  modelId: string,
  dim: number,
): Map<string, readonly number[]> {
  const result = queryNarrativeContextVectors(storage, {
    bookId,
    embeddingModelId: modelId,
    embeddingDim: dim,
    limit: 0,
  });
  const map = new Map<string, readonly number[]>();
  for (const item of result.vectors) {
    if (item.vector.length === dim) map.set(item.sourceCard.title, item.vector);
  }
  return map;
}

/**
 * 残差近似：1 − 与邻居向量均值的余弦。需要 embedding；没有时不要调用。
 * 这不是 SVD 精确残差。
 */
export function approximateResidualFromNeighbors(
  nodeId: string,
  neighborIds: readonly string[],
  vectors: ReadonlyMap<string, readonly number[]>,
): number {
  const self = vectors.get(nodeId);
  if (!self || neighborIds.length === 0) return 0.5;
  const dim = self.length;
  const mean = new Array<number>(dim).fill(0);
  let count = 0;
  for (const neighborId of neighborIds) {
    const vector = vectors.get(neighborId);
    if (!vector || vector.length !== dim) continue;
    for (let index = 0; index < dim; index += 1) mean[index] = (mean[index] ?? 0) + (vector[index] ?? 0);
    count += 1;
  }
  if (count === 0) return 0.5;
  for (let index = 0; index < dim; index += 1) mean[index] = (mean[index] ?? 0) / count;
  const sim = exactCosineSimilarity(self, mean);
  if (!Number.isFinite(sim)) return 0.5;
  return Math.min(0.95, Math.max(0.15, 1 - sim));
}
