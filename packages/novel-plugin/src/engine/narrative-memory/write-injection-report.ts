/**
 * 写作注入报告（W6）：把 narrative_retrieval_log 里某次写作的召回诊断整理成
 * 「这一章写作注入了什么」的清单，供「故事推进 › 章后事实」面板按章查看。
 *
 * 纪律：
 * - 只从日志已有字段整理，缺字段就标 recorded=false 并写说明，绝不反推或编造。
 * - fixedCards / voices.characters 明细自 T-W6 起才写进日志；旧日志能给的只有
 *   通道计数与 voiceConstraintsProvided 布尔值，报告如实说明明细从那以后的写作才可见。
 */

import { STYLE_SCENE_TYPE_LABELS, type StyleSceneType } from "./style-samples.js";
import type { NarrativeRetrievalLogRecord } from "./storage.js";
import type { NarrativeRetrievalPurpose } from "./types.js";

export interface WriteInjectionExplanation {
  readonly whatHappened: string;
  readonly whyItMatters: string;
  readonly suggestedAction: string;
}

export interface WriteInjectionChannel {
  readonly channel: string;
  readonly channelLabel: string;
  readonly status: string;
  readonly latencyMs: number;
  readonly candidateCount: number;
  readonly returnedCount: number;
  readonly estimatedTokens: number;
  /** 全局打包后真正进入上下文的 tokens（injectedTokensByChannel）。 */
  readonly injectedTokens: number;
}

export interface WriteInjectionFixedCard {
  readonly id: string;
  readonly title: string;
  readonly estimatedTokens: number;
  /** 卡片产出了、但在全局 token 打包时被整段裁掉（droppedCardIds 对照）。 */
  readonly droppedInPacking: boolean;
}

export interface WriteInjectionVoiceCharacter {
  readonly name: string;
  readonly confirmedFields: readonly string[];
}

export interface WriteInjectionStyleSample {
  readonly key: string;
  readonly sourceTitle: string;
  readonly sceneType: string;
  readonly sceneTypeLabel: string;
  readonly transfer: string;
  readonly transferLabel: string;
  readonly match: string;
  readonly matchLabel: string;
  readonly rank: number;
  readonly estimatedTokens: number;
  readonly reason: string;
  readonly droppedInPacking: boolean;
}

export interface WriteInjectionTrimmedSample {
  readonly key: string;
  readonly sourceTitle: string;
  readonly sceneType: string;
  readonly sceneTypeLabel: string;
  readonly rank: number;
  readonly estimatedTokens: number;
  readonly kind: string;
  readonly kindLabel: string;
  readonly reason: string;
}

export interface WriteInjectionStyleSamples {
  readonly sceneTypes: {
    readonly labels: readonly string[];
    readonly source: string;
    readonly sourceLabel: string;
    readonly evidence: readonly string[];
    readonly attempts: readonly string[];
    readonly explanation?: WriteInjectionExplanation;
  };
  readonly selected: readonly WriteInjectionStyleSample[];
  readonly trimmed: readonly WriteInjectionTrimmedSample[];
  readonly budget: {
    readonly channelBudgetTokens: number | null;
    readonly reservedTokens: number | null;
    readonly availableTokens: number | null;
    readonly usedTokens: number | null;
  };
  readonly totals: {
    readonly totalSamples: number;
    readonly confirmedSamples: number;
    readonly unconfirmedSamples: number;
  };
  readonly explanations: readonly WriteInjectionExplanation[];
}

export interface WriteInjectionTrimReason {
  readonly id: string;
  readonly reason: string;
  readonly channel?: string;
  readonly kind: string;
  readonly kindLabel: string;
}

export interface WriteInjectionReport {
  readonly logId: string;
  readonly bookId: string;
  readonly chapterNumber?: number;
  readonly purpose: NarrativeRetrievalPurpose;
  readonly purposeLabel: string;
  readonly createdAt: string;
  readonly totalMs: number;
  readonly totalEstimatedTokens: number;
  readonly channels: readonly WriteInjectionChannel[];
  readonly style: {
    /** style 通道是否出现在本次召回（关掉的通道是 skipped，不在是没跑到）。 */
    readonly recorded: boolean;
    readonly status?: string;
    /** 非范文卡片（文风指南 / 声线 / 合规 / 本书设计）明细是否被记录。 */
    readonly fixedCardsRecorded: boolean;
    readonly fixedCards: readonly WriteInjectionFixedCard[];
    readonly voices: {
      readonly provided: boolean;
      /** 逐角色明细是否被记录（旧日志只有 provided 布尔值）。 */
      readonly recorded: boolean;
      readonly characters: readonly WriteInjectionVoiceCharacter[];
    };
    readonly samples: WriteInjectionStyleSamples | null;
  };
  /** 受保护：点名实体在超上限时仍被保留（write profile 的 named-keep）。 */
  readonly protection: {
    readonly namedKeeps: readonly WriteInjectionTrimReason[];
    readonly namedEntities: readonly string[];
  };
  /** 裁剪：计数上限 / token 预算 / 陈旧 / 降级，逐条给出出处与原因。 */
  readonly trimming: {
    readonly reasons: readonly WriteInjectionTrimReason[];
    readonly droppedCardIds: readonly string[];
    readonly degradedCards: readonly { readonly id: string; readonly from: string; readonly to: string }[];
  };
  /** 老日志缺字段等需要作者知道的情况，逐条可读。 */
  readonly notes: readonly string[];
}

const CHANNEL_LABELS: Readonly<Record<string, string>> = {
  "scene-spec": "写作蓝图",
  hard: "硬约束",
  state: "角色/状态",
  relationship: "关系",
  timeline: "时间线",
  hooks: "伏笔",
  facts: "事实",
  style: "文风",
  semantic: "语义记忆",
  "character-kernel": "角色内核",
  "recent-summary": "近章摘要",
  knowledge: "知情边界",
};

const PURPOSE_LABELS: Readonly<Record<NarrativeRetrievalPurpose, string>> = {
  write_chapter: "写章",
  continue: "续写",
  revise: "修订",
  audit: "审计",
  outline: "大纲",
};

const MATCH_LABELS: Readonly<Record<string, string>> = {
  "scene-type": "场景匹配",
  general: "通用范文",
  fallback: "补位范文",
};

const SAMPLE_TRIM_KIND_LABELS: Readonly<Record<string, string>> = {
  "token-budget": "预算不足",
  "count-cap": "段数上限",
};

const TRIM_KIND_LABELS: Readonly<Record<string, string>> = {
  "count-cap": "条数上限",
  "token-budget": "预算不足",
  aged: "过于陈旧",
  degraded: "降档",
  "named-keep": "点名保留",
};

const SCENE_TYPE_SOURCE_LABELS: Readonly<Record<string, string>> = {
  "narrative-scene": "本章场景记录",
  "scene-spec": "写作蓝图",
  "chapter-plan": "章节规划文字",
  none: "未能判定",
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asStringArray(value: unknown): string[] {
  return asArray(value).filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function asExplanation(value: unknown): WriteInjectionExplanation | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const whatHappened = asString(record.whatHappened);
  const whyItMatters = asString(record.whyItMatters);
  const suggestedAction = asString(record.suggestedAction);
  if (!whatHappened && !whyItMatters && !suggestedAction) return undefined;
  return { whatHappened, whyItMatters, suggestedAction };
}

function sceneTypeLabel(type: string): string {
  return STYLE_SCENE_TYPE_LABELS[type as StyleSceneType] ?? type;
}

function buildTrimReasons(log: NarrativeRetrievalLogRecord): WriteInjectionTrimReason[] {
  return (log.diagnostics.trimReasons ?? []).map((item) => ({
    id: item.id,
    reason: item.reason,
    ...(item.channel ? { channel: item.channel } : {}),
    kind: item.kind,
    kindLabel: TRIM_KIND_LABELS[item.kind] ?? item.kind,
  }));
}

function buildStyleSamples(styleStat: Record<string, unknown> | undefined, droppedCardIds: ReadonlySet<string>): WriteInjectionStyleSamples | null {
  const styleSamples = asRecord(styleStat?.styleSamples);
  if (!styleSamples) return null;

  const sceneTypes = asRecord(styleSamples.sceneTypes);
  const sceneTypeExplanation = asExplanation(sceneTypes?.explanation);
  const sceneTypeSource = asString(sceneTypes?.source);
  const droppedAfterPacking = asArray(styleSamples.droppedAfterPacking)
    .map((item) => asString(asRecord(item)?.cardId))
    .filter(Boolean);

  const selected: WriteInjectionStyleSample[] = asArray(styleSamples.selected).flatMap((item) => {
    const record = asRecord(item);
    if (!record) return [];
    const key = asString(record.key);
    if (!key) return [];
    const sceneType = asString(record.sceneType);
    const match = asString(record.match);
    const transfer = asString(record.transfer);
    return [{
      key,
      sourceTitle: asString(record.sourceTitle),
      sceneType,
      sceneTypeLabel: sceneTypeLabel(sceneType),
      transfer,
      transferLabel: transfer === "source-only" ? "作品专属（只学写法）" : "可迁移",
      match,
      matchLabel: MATCH_LABELS[match] ?? match,
      rank: asNumber(record.rank) ?? 0,
      estimatedTokens: asNumber(record.estimatedTokens) ?? 0,
      reason: asString(record.reason),
      // 通道自裁选中后，仍可能在全局打包被裁；两者都如实标出。
      droppedInPacking: droppedCardIds.has(`style:sample:${key}`) || droppedAfterPacking.includes(`style:sample:${key}`),
    }];
  });

  const trimmed: WriteInjectionTrimmedSample[] = asArray(styleSamples.trimmed).flatMap((item) => {
    const record = asRecord(item);
    if (!record) return [];
    const key = asString(record.key);
    if (!key) return [];
    const sceneType = asString(record.sceneType);
    const kind = asString(record.kind);
    return [{
      key,
      sourceTitle: asString(record.sourceTitle),
      sceneType,
      sceneTypeLabel: sceneTypeLabel(sceneType),
      rank: asNumber(record.rank) ?? 0,
      estimatedTokens: asNumber(record.estimatedTokens) ?? 0,
      kind,
      kindLabel: SAMPLE_TRIM_KIND_LABELS[kind] ?? kind,
      reason: asString(record.reason),
    }];
  });

  const budget = asRecord(styleSamples.budget);
  const explanations = asArray(styleSamples.explanations)
    .map(asExplanation)
    .filter((item): item is WriteInjectionExplanation => Boolean(item));

  return {
    sceneTypes: {
      labels: asStringArray(sceneTypes?.labels),
      source: sceneTypeSource,
      sourceLabel: SCENE_TYPE_SOURCE_LABELS[sceneTypeSource] ?? (sceneTypeSource || "未知"),
      evidence: asStringArray(sceneTypes?.evidence),
      attempts: asStringArray(sceneTypes?.attempts),
      ...(sceneTypeExplanation ? { explanation: sceneTypeExplanation } : {}),
    },
    selected,
    trimmed,
    budget: {
      channelBudgetTokens: asNumber(budget?.channelBudgetTokens),
      reservedTokens: asNumber(budget?.reservedTokens),
      availableTokens: asNumber(budget?.availableTokens),
      usedTokens: asNumber(budget?.usedTokens),
    },
    totals: {
      totalSamples: asNumber(styleSamples.totalSamples) ?? 0,
      confirmedSamples: asNumber(styleSamples.confirmedSamples) ?? 0,
      unconfirmedSamples: asNumber(styleSamples.unconfirmedSamples) ?? 0,
    },
    explanations,
  };
}

/** 从一次召回日志整理「写作注入」报告；缺失的明细一律 recorded=false + notes 说明。 */
export function buildWriteInjectionReport(log: NarrativeRetrievalLogRecord): WriteInjectionReport {
  const diagnostics = log.diagnostics;
  const droppedCardIds = new Set(diagnostics.droppedCardIds);
  const notes: string[] = [];

  const styleStat = diagnostics.channelStats.find((stat) => stat.channel === "style");
  const styleMetadata = asRecord(styleStat?.metadata);

  const fixedCards: WriteInjectionFixedCard[] = asArray(styleMetadata?.fixedCards).flatMap((item) => {
    const record = asRecord(item);
    if (!record) return [];
    const id = asString(record.id);
    if (!id) return [];
    return [{
      id,
      title: asString(record.title),
      estimatedTokens: asNumber(record.estimatedTokens) ?? 0,
      droppedInPacking: droppedCardIds.has(id),
    }];
  });
  const fixedCardsRecorded = styleMetadata ? Object.hasOwn(styleMetadata, "fixedCards") : false;
  if (styleStat && !fixedCardsRecorded) {
    notes.push("这次写作的日志还没有记录文风指南等非范文卡片的明细（该字段自本次功能起才开始写入）；此后的写作会逐条可见。");
  }

  const voicesMetadata = asRecord(styleMetadata?.voices);
  const voicesProvided = voicesMetadata
    ? voicesMetadata.provided === true
    : asRecord(styleMetadata?.styleSamples)?.voiceConstraintsProvided === true;
  const voiceCharacters: WriteInjectionVoiceCharacter[] = asArray(voicesMetadata?.characters).flatMap((item) => {
    const record = asRecord(item);
    const name = asString(record?.name);
    if (!name) return [];
    return [{ name, confirmedFields: asStringArray(record?.confirmedFields) }];
  });
  const voicesRecorded = Boolean(voicesMetadata);
  if (voicesProvided && styleStat && !voicesRecorded) {
    notes.push("这次写作注入了角色声线，但日志只记了「注入了」这个事实，逐角色与逐字段明细自本次功能起才开始记录。");
  }

  const trimReasons = buildTrimReasons(log);
  const namedKeeps = trimReasons.filter((item) => item.kind === "named-keep");
  const writeProfile = asRecord(diagnostics.writeProfile);

  return {
    logId: log.id,
    bookId: log.bookId,
    ...(log.chapterNumber !== undefined ? { chapterNumber: log.chapterNumber } : {}),
    purpose: log.purpose,
    purposeLabel: PURPOSE_LABELS[log.purpose] ?? log.purpose,
    createdAt: log.createdAt,
    totalMs: diagnostics.totalMs,
    totalEstimatedTokens: diagnostics.totalEstimatedTokens,
    channels: diagnostics.channelStats.map((stat) => ({
      channel: stat.channel,
      channelLabel: CHANNEL_LABELS[stat.channel] ?? stat.channel,
      status: stat.status,
      latencyMs: stat.latencyMs,
      candidateCount: stat.candidateCount,
      returnedCount: stat.returnedCount,
      estimatedTokens: stat.estimatedTokens,
      injectedTokens: diagnostics.injectedTokensByChannel[stat.channel] ?? 0,
    })),
    style: {
      recorded: Boolean(styleStat),
      ...(styleStat ? { status: styleStat.status } : {}),
      fixedCardsRecorded,
      fixedCards,
      voices: {
        provided: voicesProvided,
        recorded: voicesRecorded,
        characters: voiceCharacters,
      },
      samples: buildStyleSamples(styleMetadata, droppedCardIds),
    },
    protection: {
      namedKeeps,
      namedEntities: asStringArray(writeProfile?.namedEntities),
    },
    trimming: {
      reasons: trimReasons,
      droppedCardIds: diagnostics.droppedCardIds,
      degradedCards: diagnostics.degradedCards.map((item) => ({ id: item.id, from: item.from, to: item.to })),
    },
    notes,
  };
}
