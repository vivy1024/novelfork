import type { RuntimeStateSnapshot } from "@vivy1024/novelfork-core";
import { emptyChapterStateProjection, loadChapterStateProjection } from "@vivy1024/novelfork-core";
import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import type { SceneSpec } from "../../handlers/scene-spec-handler.js";
import { packNarrativeContext, type NarrativeBudgetPolicy } from "./budget.js";
import { runChannelWithTimeout, type ChannelResult, type NarrativeRetrievalChannel } from "./channels.js";
import { createFactsChannel } from "./channels/facts-channel.js";
import { createHardChannel } from "./channels/hard-channel.js";
import { createHooksChannel } from "./channels/hooks-channel.js";
import { createRecentSummaryChannel } from "./channels/recent-summary-channel.js";
import { createSceneSpecChannel } from "./channels/scene-spec-channel.js";
import { createSemanticChannel, type NarrativeEmbeddingProvider } from "./channels/semantic-channel.js";
import { createStateChannel } from "./channels/state-channel.js";
import { createStyleChannel, type StyleSnippet } from "./channels/style-channel.js";
import { createTimelineChannel } from "./channels/timeline-channel.js";
import { buildKernelCards, type KernelChannelInput } from "./channels/kernel-channel.js";
import { buildNarrativeRetrievalDiagnostics, formatNarrativeSections, persistNarrativeRetrievalLog } from "./diagnostics.js";
import {
  applyWriteProfileCountCaps,
  buildWriteProfile,
  DEFAULT_WRITE_PROFILE_CAPS,
} from "./write-profile.js";
import { buildStorylineStateCard } from "./storyline-state-card.js";
import { mergeNarrativeContextCards } from "./merge.js";
import {
  BuildNarrativeContextInputSchema,
  NarrativeContextPackageSchema,
  WaveMemoryConfigSchema,
  DEFAULT_KERNEL_FIELDS,
  type BuildNarrativeContextInput,
  type CharacterKernelConfig,
  type NarrativeContextCard,
  type NarrativeContextChannel,
  type NarrativeContextPackage,
  type SemanticChannelConfig,
  type WaveMemoryConfig,
  type WaveMemoryDiagnostics,
} from "./types.js";
import { rerankByGeodesicEnergy } from "./wave/geodesic-rerank.js";
import { buildNarrativeTagGraph } from "./wave/tag-graph.js";
import { routeNarrativeSpikes } from "./wave/spike-routing.js";

export type BuildNarrativeContextRuntimeInput = BuildNarrativeContextInput & Readonly<{
  storage: StorageDatabase;
  runtimeSnapshot?: RuntimeStateSnapshot;
  previousChapterTail?: string;
  pendingHooks?: readonly string[];
  bookRulesText?: string;
  complianceRules?: readonly string[];
  styleGuideText?: string;
  authorHabitsText?: string;
  bookDesignText?: string;
  channelTimeoutMs?: number;
  retrievalLogId?: string;
  budgetPolicy?: NarrativeBudgetPolicy;
  semanticProvider?: NarrativeEmbeddingProvider;
  semanticConfig?: Partial<SemanticChannelConfig>;
  waveConfig?: Partial<WaveMemoryConfig>;
  /** Book-level switches for optional recall channels. `hard` is never switchable. */
  enabledChannels?: Partial<Record<NarrativeContextChannel, boolean>>;
  /** 角色内核配置；enabled=false 或缺省时 character-kernel 通道跳过。 */
  characterKernelConfig?: CharacterKernelConfig;
  /** scene.spec / memory.read 点名实体，write profile 超上限时仍保留。 */
  namedEntities?: readonly string[];
}>;

function disabledChannelResult(channel: NarrativeContextChannel): ChannelResult {
  return {
    channel,
    status: "skipped",
    cards: [],
    latencyMs: 0,
    candidateCount: 0,
    returnedCount: 0,
    estimatedTokens: 0,
    warnings: [`${channel} channel 已在本书叙事记忆配置中关闭。`],
  };
}

function isOptionalChannelEnabled(
  input: Pick<BuildNarrativeContextRuntimeInput, "enabledChannels">,
  channel: Exclude<NarrativeContextChannel, "hard" | "relationship">,
): boolean {
  return input.enabledChannels?.[channel] !== false;
}

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

function applyWaveMemory(
  cards: readonly NarrativeContextCard[],
  entities: readonly string[],
  configInput: Partial<WaveMemoryConfig> | undefined,
  currentChapter?: number,
): { readonly cards: readonly NarrativeContextCard[]; readonly diagnostics?: WaveMemoryDiagnostics } {
  const config = WaveMemoryConfigSchema.parse({ enabled: false, ...(configInput ?? {}) });
  if (!config.enabled) return { cards };
  const graph = buildNarrativeTagGraph(cards, { currentChapter });
  // 脉冲传播的聚焦度（logicDepth）原来自 EPA 的输出。小说召回输入是结构化实体，
  // 无「模糊 vs 明确」之分（EPA 的价值被场景消解），固定中性值即可：
  // logicDepth < 0.7 → momentum 0.75，保留适度多跳联想。
  const logicDepth = 0.5;
  const seedIds = tagSeedIds(cards, entities);
  const spike = config.spikeRoutingEnabled
    ? routeNarrativeSpikes({ seedTagIds: seedIds, edges: graph.edges, logicDepth })
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
      activatedTags: spike.activatedTags.map((tag) => tag.tagId),
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
  const entities = uniqueStrings([
    ...(parsed.entities ?? []),
    ...(input.namedEntities ?? []),
    ...collectSceneEntities(sceneSpec),
  ]);
  const namedEntities = uniqueStrings([...(input.namedEntities ?? []), ...(parsed.entities ?? []), ...collectSceneEntities(sceneSpec)]);
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
    isOptionalChannelEnabled(input, "state")
      ? runChannel(createStateChannel(), {
        storage: input.storage,
        bookId: parsed.bookId,
        currentChapter,
        sceneSpec,
        sceneText: parsed.sceneText,
        entities,
        runtimeSnapshot: input.runtimeSnapshot,
        limit: Math.max(DEFAULT_WRITE_PROFILE_CAPS.coreCharacters * 4, 24),
      }, timeoutMs)
      : disabledChannelResult("state"),
    isOptionalChannelEnabled(input, "hooks")
      ? runChannel(createHooksChannel(), {
        storage: input.storage,
        bookId: parsed.bookId,
        currentChapter,
        runtimeSnapshot: input.runtimeSnapshot,
        pendingHooks: input.pendingHooks,
        sceneSpec,
        sceneText: parsed.sceneText,
        entities,
        limit: Math.max(DEFAULT_WRITE_PROFILE_CAPS.activeHooks * 4, 24),
      }, timeoutMs)
      : disabledChannelResult("hooks"),
    isOptionalChannelEnabled(input, "timeline")
      ? runChannel(createTimelineChannel(), {
        storage: input.storage,
        bookId: parsed.bookId,
        currentChapter,
        runtimeSnapshot: input.runtimeSnapshot,
        previousChapterTail: input.previousChapterTail,
        sceneSpec,
        sceneText: parsed.sceneText,
      }, timeoutMs)
      : disabledChannelResult("timeline"),
    isOptionalChannelEnabled(input, "facts")
      ? runChannel(createFactsChannel(), {
        storage: input.storage,
        bookId: parsed.bookId,
        currentChapter,
        sceneSpec,
        sceneText: parsed.sceneText,
        entities,
      }, timeoutMs)
      : disabledChannelResult("facts"),
    isOptionalChannelEnabled(input, "semantic")
      ? runChannel(createSemanticChannel(), {
        storage: input.storage,
        bookId: parsed.bookId,
        currentChapter,
        queryText: [parsed.sceneText, sceneSpec?.title, ...entities].filter(Boolean).join(" "),
        entities,
        provider: input.semanticProvider,
        config: input.semanticConfig,
      }, timeoutMs)
      : disabledChannelResult("semantic"),
    isOptionalChannelEnabled(input, "style")
      ? runChannel(createStyleChannel(), {
        bookId: parsed.bookId,
        styleGuideText: input.styleGuideText,
        complianceRules: input.complianceRules,
        authorHabitsText: input.authorHabitsText,
        bookDesignText: input.bookDesignText,
      }, timeoutMs)
      : disabledChannelResult("style"),
    // 角色内核通道：config.characterKernel.enabled 且本书 channels["character-kernel"] 未关闭时注入。
    // 字段集合由 config.characterKernel.fields 决定（空 = 内置默认），预算按 injectBudgetRatio 参与统一分配。
    input.characterKernelConfig?.enabled && isOptionalChannelEnabled(input, "character-kernel")
      ? runChannel({
        name: "character-kernel",
        run: (kernelInput: KernelChannelInput) => ({
          cards: buildKernelCards(kernelInput),
        }),
      }, {
        storage: input.storage,
        bookId: parsed.bookId,
        characterIds: entities,
        fields: input.characterKernelConfig.fields.length > 0 ? input.characterKernelConfig.fields : DEFAULT_KERNEL_FIELDS,
        stateSummaryMaxChars: input.characterKernelConfig.stateSummaryMaxChars,
      }, timeoutMs)
      : disabledChannelResult("character-kernel"),
    // 近章手动剧情摘要通道：读经纬 chapter-summaries 类目，按章节号倒序注入最近几章，
    // 保证作者手动维护的前情摘要进入写作上下文。
    isOptionalChannelEnabled(input, "recent-summary")
      ? runChannel(createRecentSummaryChannel(), {
        storage: input.storage,
        bookId: parsed.bookId,
        currentChapter,
        limit: DEFAULT_WRITE_PROFILE_CAPS.recentSummaries,
      }, timeoutMs)
      : disabledChannelResult("recent-summary"),
  ]);

  const merged = mergeNarrativeContextCards(channelResults.flatMap((result) => result.cards), {
    currentChapter,
    queryEntities: entities,
  });
  const wave = applyWaveMemory(merged, entities, input.waveConfig, currentChapter);
  let projection = emptyChapterStateProjection();
  try {
    projection = loadChapterStateProjection(input.storage, parsed.bookId);
  } catch {
    projection = emptyChapterStateProjection();
  }
  const writeProfile = buildWriteProfile({
    projection,
    cards: wave.cards,
    namedEntities,
    currentChapter,
    caps: DEFAULT_WRITE_PROFILE_CAPS,
  });
  const capped = applyWriteProfileCountCaps(wave.cards, writeProfile);
  const budget = packNarrativeContext(capped.cards, {
    maxTokens: parsed.maxTokens,
    ...(input.budgetPolicy ?? {}),
  });
  const sections = { ...formatNarrativeSections(budget.cards) };
  // 剧情线状态卡（宏观层轻量版）：从当前章有效事实按主体聚合现状，
  // prepend 到 state section，让 Agent 写前看到每条剧情线停在哪。
  try {
    const storylineCard = buildStorylineStateCard(input.storage, {
      bookId: parsed.bookId,
      chapterNumber: currentChapter,
    });
    if (storylineCard) {
      sections.state = sections.state.trim()
        ? `${storylineCard}\n\n${sections.state}`
        : storylineCard;
    }
  } catch {
    // 状态卡是增强项，失败只跳过不阻断召回。
  }
  const trimReasons = [
    ...writeProfile.trimReasons,
    ...capped.trimReasons,
    ...budget.droppedCards.map((card) => ({
      id: card.id,
      reason: "token 预算不足，卡片被丢弃。",
      channel: card.channel,
      kind: "token-budget" as const,
    })),
    ...budget.degradedCards.map((item) => ({
      id: item.id,
      reason: `token 预算不足，从 ${item.from} 降到 ${item.to}。`,
      kind: "degraded" as const,
    })),
  ];
  const diagnostics = buildNarrativeRetrievalDiagnostics({
    startedAt,
    endedAt: performance.now(),
    channelResults,
    budget,
    wave: wave.diagnostics,
    trimReasons,
    writeProfile,
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
    writeProfile,
  });
}
