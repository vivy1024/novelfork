import type { RuntimeStateSnapshot } from "@vivy1024/novelfork-core";
import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import type { SceneSpec } from "../../handlers/scene-spec-handler.js";
import { packNarrativeContext, type NarrativeBudgetPolicy } from "./budget.js";
import { runChannelWithTimeout, type ChannelResult, type NarrativeRetrievalChannel } from "./channels.js";
import { createFactsChannel } from "./channels/facts-channel.js";
import { createHardChannel } from "./channels/hard-channel.js";
import { createHooksChannel } from "./channels/hooks-channel.js";
import { createSceneSpecChannel } from "./channels/scene-spec-channel.js";
import { createSemanticChannel, type NarrativeEmbeddingProvider } from "./channels/semantic-channel.js";
import { createStateChannel } from "./channels/state-channel.js";
import { createStyleChannel, type StyleSnippet } from "./channels/style-channel.js";
import { createTimelineChannel } from "./channels/timeline-channel.js";
import { buildNarrativeRetrievalDiagnostics, formatNarrativeSections, persistNarrativeRetrievalLog } from "./diagnostics.js";
import { mergeNarrativeContextCards } from "./merge.js";
import { BuildNarrativeContextInputSchema, NarrativeContextPackageSchema, WaveMemoryConfigSchema, type BuildNarrativeContextInput, type NarrativeContextCard, type NarrativeContextPackage, type SemanticChannelConfig, type WaveMemoryConfig, type WaveMemoryDiagnostics } from "./types.js";
import { analyzeEPA } from "./wave/epa.js";
import { rerankByGeodesicEnergy } from "./wave/geodesic-rerank.js";
import { buildResidualPyramid } from "./wave/residual-pyramid.js";
import { buildNarrativeTagGraph, calculateBellSemanticGain } from "./wave/tag-graph.js";
import { routeNarrativeSpikes } from "./wave/spike-routing.js";

export type BuildNarrativeContextRuntimeInput = BuildNarrativeContextInput & Readonly<{
  storage: StorageDatabase;
  runtimeSnapshot?: RuntimeStateSnapshot;
  previousChapterTail?: string;
  pendingHooks?: readonly string[];
  bookRulesText?: string;
  complianceRules?: readonly string[];
  styleGuideText?: string;
  presets?: readonly StyleSnippet[];
  beats?: readonly StyleSnippet[];
  channelTimeoutMs?: number;
  retrievalLogId?: string;
  budgetPolicy?: NarrativeBudgetPolicy;
  semanticProvider?: NarrativeEmbeddingProvider;
  semanticConfig?: Partial<SemanticChannelConfig>;
  waveConfig?: Partial<WaveMemoryConfig>;
}>;

function asSceneSpec(value: unknown): SceneSpec | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<SceneSpec>;
  if (typeof candidate.chapter !== "number" || typeof candidate.title !== "string" || !Array.isArray(candidate.scenes)) return undefined;
  return candidate as SceneSpec;
}

function collectSceneEntities(sceneSpec?: SceneSpec): string[] {
  return sceneSpec?.scenes.flatMap((scene) => [
    ...scene.characters,
    scene.location,
    ...scene.hooks_used,
    ...scene.hooks_planted,
  ]).filter(Boolean) ?? [];
}

function uniqueStrings(values: readonly (string | undefined | null)[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

async function runChannel<TInput>(
  channel: NarrativeRetrievalChannel<TInput>,
  input: TInput,
  timeoutMs: number,
): Promise<ChannelResult> {
  return runChannelWithTimeout(channel, input, { timeoutMs });
}

function tagSeedIds(cards: readonly NarrativeContextCard[], entities: readonly string[]): string[] {
  const entitySet = new Set(entities.map((item) => item.trim()).filter(Boolean));
  const graph = buildNarrativeTagGraph(cards);
  return graph.tags
    .filter((tag) => entitySet.has(tag.label) || entitySet.has(tag.id) || entitySet.has(tag.type))
    .map((tag) => tag.id);
}

function hashedVector(value: string, dim = 8): number[] {
  const vector = Array.from({ length: dim }, () => 0);
  const chars = [...value];
  for (let index = 0; index < chars.length; index += 1) {
    const code = chars[index]!.codePointAt(0) ?? 0;
    vector[index % dim] += ((code % 31) + 1) / 31;
  }
  const norm = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0)) || 1;
  return vector.map((item) => item / norm);
}

function dot(a: readonly number[], b: readonly number[]): number {
  return a.reduce((sum, value, index) => sum + value * (b[index] ?? 0), 0);
}

function cosine(a: readonly number[], b: readonly number[]): number {
  const normA = Math.sqrt(a.reduce((sum, value) => sum + value * value, 0));
  const normB = Math.sqrt(b.reduce((sum, value) => sum + value * value, 0));
  if (a.length === 0 || a.length !== b.length || normA <= 0 || normB <= 0) return 0;
  return dot(a, b) / (normA * normB);
}

function applyWaveMemory(
  cards: readonly NarrativeContextCard[],
  entities: readonly string[],
  configInput: Partial<WaveMemoryConfig> | undefined,
  currentChapter?: number,
): { readonly cards: readonly NarrativeContextCard[]; readonly diagnostics?: WaveMemoryDiagnostics } {
  const config = WaveMemoryConfigSchema.parse({ enabled: false, ...(configInput ?? {}) });
  if (!config.enabled) return { cards };
  const graph = buildNarrativeTagGraph(cards, { currentChapter });
  const queryVector = hashedVector(entities.join(" ") || cards.map((card) => card.title).join(" "));
  const tagVectors = graph.tags.map((tag) => hashedVector(`${tag.type} ${tag.label}`));
  const epa = config.epaEnabled ? analyzeEPA({ queryVector, tagVectors }) : { entropy: 0.5, logicDepth: 0.5 };
  const residual = config.residualPyramidEnabled
    ? buildResidualPyramid({
      queryVector,
      facets: graph.tags.map((tag, index) => ({ tagId: tag.id, vector: tagVectors[index] ?? queryVector })),
      config: { maxLevels: 3, topK: 1, minEnergyRatio: 0.05 },
    })
    : { levels: [], finalEnergyRatio: 1 };
  const semanticGainPeak = tagVectors.length > 0 ? Math.max(...tagVectors.map((vector) => calculateBellSemanticGain(cosine(queryVector, vector)))) : 0;
  const seedIds = tagSeedIds(cards, entities);
  const spikeSeeds = seedIds.length > 0 ? seedIds : residual.levels.flatMap((level) => level.facets.map((facet) => facet.tagId));
  const spike = config.spikeRoutingEnabled
    ? routeNarrativeSpikes({ seedTagIds: spikeSeeds, edges: graph.edges, logicDepth: epa.logicDepth })
    : { activatedTags: [] };
  const tagById = new Map(graph.tags.map((tag) => [tag.id, tag]));
  const energyByTag: Record<string, number> = {};
  for (const activated of spike.activatedTags) {
    const tag = tagById.get(activated.tagId);
    energyByTag[activated.tagId] = activated.energy;
    if (tag) {
      energyByTag[tag.label] = Math.max(energyByTag[tag.label] ?? 0, activated.energy);
      energyByTag[tag.label.toLowerCase()] = Math.max(energyByTag[tag.label.toLowerCase()] ?? 0, activated.energy);
      energyByTag[tag.type] = Math.max(energyByTag[tag.type] ?? 0, activated.energy);
    }
  }
  const reranked = config.geodesicRerankEnabled
    ? rerankByGeodesicEnergy(cards, energyByTag, { alpha: config.rerankAlpha })
    : { cards: [...cards], fallbackLevel: "L2" as const };
  return {
    cards: reranked.cards,
    diagnostics: {
      logicDepth: epa.logicDepth,
      entropy: epa.entropy,
      activatedTags: spike.activatedTags.map((tag) => tag.tagId),
      residualLevels: residual.levels.length,
      semanticGainPeak,
      rerankAlpha: config.rerankAlpha,
      fallbackLevel: reranked.fallbackLevel,
    },
  };
}

export async function buildNarrativeContext(input: BuildNarrativeContextRuntimeInput): Promise<NarrativeContextPackage> {
  const parsed = BuildNarrativeContextInputSchema.parse({
    bookId: input.bookId,
    purpose: input.purpose,
    chapterNumber: input.chapterNumber,
    sceneSpec: input.sceneSpec,
    sceneText: input.sceneText,
    entities: input.entities,
    maxTokens: input.maxTokens,
  });
  const sceneSpec = asSceneSpec(parsed.sceneSpec);
  const entities = uniqueStrings([...(parsed.entities ?? []), ...collectSceneEntities(sceneSpec)]);
  const currentChapter = parsed.chapterNumber;
  const startedAt = performance.now();
  const timeoutMs = input.channelTimeoutMs ?? 2500;

  const channelResults = await Promise.all([
    runChannel(createSceneSpecChannel(), { bookId: parsed.bookId, sceneSpec }, timeoutMs),
    runChannel(createHardChannel(), {
      storage: input.storage,
      bookId: parsed.bookId,
      sceneSpec,
      bookRulesText: input.bookRulesText,
      complianceRules: input.complianceRules,
    }, timeoutMs),
    runChannel(createStateChannel(), {
      storage: input.storage,
      bookId: parsed.bookId,
      currentChapter,
      sceneSpec,
      sceneText: parsed.sceneText,
      entities,
      runtimeSnapshot: input.runtimeSnapshot,
    }, timeoutMs),
    runChannel(createHooksChannel(), {
      storage: input.storage,
      bookId: parsed.bookId,
      currentChapter,
      runtimeSnapshot: input.runtimeSnapshot,
      pendingHooks: input.pendingHooks,
      sceneSpec,
      sceneText: parsed.sceneText,
      entities,
    }, timeoutMs),
    runChannel(createTimelineChannel(), {
      storage: input.storage,
      bookId: parsed.bookId,
      currentChapter,
      runtimeSnapshot: input.runtimeSnapshot,
      previousChapterTail: input.previousChapterTail,
      sceneSpec,
      sceneText: parsed.sceneText,
    }, timeoutMs),
    runChannel(createFactsChannel(), {
      storage: input.storage,
      bookId: parsed.bookId,
      currentChapter,
      sceneSpec,
      sceneText: parsed.sceneText,
      entities,
    }, timeoutMs),
    runChannel(createSemanticChannel(), {
      storage: input.storage,
      bookId: parsed.bookId,
      currentChapter,
      queryText: [parsed.sceneText, sceneSpec?.title, ...entities].filter(Boolean).join(" "),
      entities,
      provider: input.semanticProvider,
      config: input.semanticConfig,
    }, timeoutMs),
    runChannel(createStyleChannel(), {
      bookId: parsed.bookId,
      styleGuideText: input.styleGuideText,
      presets: input.presets,
      beats: input.beats,
      complianceRules: input.complianceRules,
    }, timeoutMs),
  ]);

  const merged = mergeNarrativeContextCards(channelResults.flatMap((result) => result.cards), {
    currentChapter,
    queryEntities: entities,
  });
  const wave = applyWaveMemory(merged, entities, input.waveConfig, currentChapter);
  const budget = packNarrativeContext(wave.cards, {
    maxTokens: parsed.maxTokens,
    ...(input.budgetPolicy ?? {}),
  });
  const sections = formatNarrativeSections(budget.cards);
  const diagnostics = buildNarrativeRetrievalDiagnostics({
    startedAt,
    endedAt: performance.now(),
    channelResults,
    budget,
    wave: wave.diagnostics,
  });

  persistNarrativeRetrievalLog(input.storage, {
    id: input.retrievalLogId ?? `narrative-retrieval:${parsed.bookId}:${crypto.randomUUID()}`,
    bookId: parsed.bookId,
    chapterNumber: currentChapter,
    purpose: parsed.purpose,
    diagnostics,
  });

  return NarrativeContextPackageSchema.parse({
    bookId: parsed.bookId,
    chapterNumber: currentChapter,
    purpose: parsed.purpose,
    cards: budget.cards.map((item) => item.card),
    sections,
    diagnostics,
  });
}
