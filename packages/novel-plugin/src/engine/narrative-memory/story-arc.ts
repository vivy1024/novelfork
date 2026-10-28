/**
 * 层级前情（卷摘要 / 全书梗概）——召回时现场从章摘要确定性派生，不落库。
 *
 * 单一权威源：章摘要的权威在经纬 chapter-summaries；卷的划分在经纬 outline「卷纲」条目
 * 的 fields_json.volumes[].chapterRange。卷摘要与全书梗概都能由这两者算出，按「能派生的不存储」
 * 不另存表、不写经纬。
 *
 * 层级（写/修第 N 章）：
 *   - 近章：最近 R 章（R = recent-summary 的条数上限）由 recent-summary 通道细粒度呈现，这里不重复；
 *   - 当前卷（含 N 的那一卷）里近章之前的部分：一张「本卷前情」卡（每章首句）；
 *   - 此前最近的 K 卷（默认 K=5）：每卷一张卷摘要卡（每章摘要取首句，按章号拼接，再截到卷上限）；
 *   - 更早的卷：合成一张全书梗概卡（由那些卷的卷摘要再压缩：每卷取前若干字）。
 *   - 章号上限：所有内容只取 chapter < N；卷区间跨过 N 时截到 N-1。
 *   - 预算降档顺序（budget.ts 的层级前情档位按 priority 执行）：近章 > 本卷前情 > 前卷（近→远）> 全书梗概。
 *
 * 没有卷纲的书：按每 FALLBACK_VOLUME_SIZE（50）章一段兜底分段。
 */

import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { loadCurrentVolumeContext } from "../../handlers/outline-volume.js";
import { estimateTokens } from "../jingwei/context/token-budget.js";
import { loadConfirmedChapterSummaries, type ChapterSummaryRow } from "./chapter-summary-source.js";
import { NarrativeContextCardSchema, type NarrativeContextCard } from "./types.js";

export const FALLBACK_VOLUME_SIZE = 50;
/** 单独出卡的前卷数；更早的并入全书梗概。 */
export const DEFAULT_PRIOR_VOLUME_CARDS = 5;
/** 每章摘要在卷摘要里保留的字数上限（取首句后再截）。 */
const PER_CHAPTER_CHARS = 40;
/**
 * 单张卷摘要卡各档正文字数上限（≈ 估算 token，CJK 一字一 token）。
 * 默认 24000 预算下层级前情档约 1600 token：本卷前情保 full、5 张前卷卡 normal 档即可装下。
 */
const VOLUME_CARD_MAX_CHARS = 480;
const VOLUME_CARD_NORMAL_CHARS = 240;
const VOLUME_CARD_SUMMARY_CHARS = 100;
/** 全书梗概里每卷保留的字数。 */
const SYNOPSIS_PER_VOLUME_CHARS = 120;
const SYNOPSIS_MAX_CHARS = 1200;

/** 卡片标签：budget.ts 据此把层级前情放进独立档位。 */
export const STORY_ARC_TAG = "story-arc";
export const VOLUME_SUMMARY_TAG = "volume-summary";
export const BOOK_SYNOPSIS_TAG = "book-synopsis";
export const CURRENT_VOLUME_TAG = "current-volume-summary";

/** 层级前情卡的 priority：决定预算紧时的降档/丢弃顺序（都低于近章卡的 60+）。 */
export const STORY_ARC_PRIORITY = {
  currentVolume: 56,
  /** 最近的前卷；每远一卷减 PRIOR_VOLUME_STEP。 */
  priorVolume: 48,
  priorVolumeStep: 5,
  priorVolumeFloor: 20,
  synopsis: 12,
} as const;

export interface StoryArcSegment {
  readonly id: string;
  readonly title: string;
  readonly from: number;
  readonly to: number;
  readonly goal?: string;
}

export interface StoryArcPlan {
  /** 当前卷（含 currentChapter）；没有卷纲时为兜底段。 */
  readonly current: StoryArcSegment;
  /** 当前卷之前的全部段，按章号升序。 */
  readonly prior: readonly StoryArcSegment[];
  readonly source: "outline" | "fallback";
}

export interface BuildStoryArcInput {
  readonly storage: StorageDatabase;
  readonly bookId: string;
  readonly currentChapter: number;
  readonly priorVolumeCards?: number;
  /** recent-summary 通道会细粒度注入的最近章数；这些章不再进卷摘要，避免重复。默认 3。 */
  readonly recentChapterCount?: number;
}

export interface StoryArcResult {
  readonly plan: StoryArcPlan;
  readonly cards: readonly NarrativeContextCard[];
  readonly diagnostics: Readonly<Record<string, unknown>>;
}

function fallbackSegments(currentChapter: number): StoryArcPlan {
  const index = Math.floor((currentChapter - 1) / FALLBACK_VOLUME_SIZE);
  const segment = (i: number): StoryArcSegment => ({
    id: `segment-${i + 1}`,
    title: `第${i * FALLBACK_VOLUME_SIZE + 1}–${(i + 1) * FALLBACK_VOLUME_SIZE}章`,
    from: i * FALLBACK_VOLUME_SIZE + 1,
    to: (i + 1) * FALLBACK_VOLUME_SIZE,
  });
  return {
    current: segment(index),
    prior: Array.from({ length: index }, (_, i) => segment(i)),
    source: "fallback",
  };
}

/** 由经纬卷纲（权威源）切分；卷纲缺失或当前章不落在任何卷里时，退回 50 章一段。 */
export function planStoryArc(storage: StorageDatabase, bookId: string, currentChapter: number): StoryArcPlan {
  let volumes: readonly { id: string; title: string; chapterRange: { from: number; to: number }; goal?: string }[] = [];
  try {
    volumes = loadCurrentVolumeContext(storage, bookId, currentChapter).volumes;
  } catch {
    volumes = [];
  }
  const current = volumes.find((volume) => currentChapter >= volume.chapterRange.from && currentChapter <= volume.chapterRange.to);
  if (!current) {
    // 卷纲写到一半（当前章超出最后一卷）：已规划的卷照样用，超出部分按 50 章兜底。
    const last = volumes.at(-1);
    if (last && currentChapter > last.chapterRange.to) {
      const tailFrom = last.chapterRange.to + 1;
      const index = Math.floor((currentChapter - tailFrom) / FALLBACK_VOLUME_SIZE);
      const tail = (i: number): StoryArcSegment => ({
        id: `segment-tail-${i + 1}`,
        title: `第${tailFrom + i * FALLBACK_VOLUME_SIZE}–${tailFrom + (i + 1) * FALLBACK_VOLUME_SIZE - 1}章`,
        from: tailFrom + i * FALLBACK_VOLUME_SIZE,
        to: tailFrom + (i + 1) * FALLBACK_VOLUME_SIZE - 1,
      });
      return {
        current: tail(index),
        prior: [
          ...volumes.map((volume) => toSegment(volume)),
          ...Array.from({ length: index }, (_, i) => tail(i)),
        ],
        source: "outline",
      };
    }
    return fallbackSegments(currentChapter);
  }
  return {
    current: toSegment(current),
    prior: volumes.filter((volume) => volume.chapterRange.to < current.chapterRange.from).map((volume) => toSegment(volume)),
    source: "outline",
  };
}

function toSegment(volume: { id: string; title: string; chapterRange: { from: number; to: number }; goal?: string }): StoryArcSegment {
  return {
    id: volume.id,
    title: volume.title,
    from: volume.chapterRange.from,
    to: volume.chapterRange.to,
    ...(volume.goal ? { goal: volume.goal } : {}),
  };
}

/** 取一段摘要的首句（句号/问号/叹号/分号为界），再截到 maxChars。 */
export function firstSentence(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/gu, " ").trim();
  const match = /^[^。！？!?；;]*[。！？!?；;]?/u.exec(normalized);
  const sentence = (match?.[0] ?? normalized).trim() || normalized;
  return sentence.length > maxChars ? `${sentence.slice(0, maxChars - 1)}…` : sentence;
}

function clip(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}

/**
 * 在字数上限内按章号均匀抽样（首尾两章必留），而不是从头截断：
 * 一卷 50 章、上限只够 15 条时，取的是全卷均匀分布的 15 章，后半卷不会整段消失。
 */
export function sampleLinesEvenly(lines: readonly string[], maxChars: number): string {
  const joined = lines.join("\n");
  if (joined.length <= maxChars || lines.length <= 2) return clip(joined, maxChars);
  for (let step = 2; step <= lines.length; step += 1) {
    const picked = lines.filter((_, index) => index % step === 0 || index === lines.length - 1);
    const text = picked.join("\n");
    if (text.length <= maxChars) return text;
  }
  return clip([lines[0], lines.at(-1)].filter(Boolean).join("\n"), maxChars);
}

interface VolumeDigest {
  readonly segment: StoryArcSegment;
  readonly coveredTo: number;
  readonly chapterCount: number;
  readonly lines: readonly string[];
}

function digestVolume(segment: StoryArcSegment, rows: readonly ChapterSummaryRow[], upperExclusive: number): VolumeDigest | undefined {
  const to = Math.min(segment.to, upperExclusive - 1);
  const inRange = rows.filter((row) => row.chapter >= segment.from && row.chapter <= to);
  if (inRange.length === 0) return undefined;
  return {
    segment,
    coveredTo: inRange.at(-1)!.chapter,
    chapterCount: inRange.length,
    lines: inRange.map((row) => `第${row.chapter}章：${firstSentence(row.summary, PER_CHAPTER_CHARS)}`),
  };
}

function volumeCard(
  bookId: string,
  digest: VolumeDigest,
  options: { readonly kind: "current" | "prior"; readonly distance: number; readonly currentChapter: number },
): NarrativeContextCard {
  const { segment } = digest;
  const { kind, distance, currentChapter } = options;
  const range = `第${segment.from}–${digest.coveredTo}章`;
  const header = `${segment.title}（${range}，共 ${digest.chapterCount} 章摘要）${segment.goal ? `；卷目标：${segment.goal}` : ""}`;
  // full / normal / summary / brief：预算紧时逐档变短（均匀抽样的条数越来越少 → 只留标题）
  const content = `${header}\n${sampleLinesEvenly(digest.lines, VOLUME_CARD_MAX_CHARS)}`;
  const normal = `${header}\n${sampleLinesEvenly(digest.lines, VOLUME_CARD_NORMAL_CHARS)}`;
  const summary = `${header}\n${sampleLinesEvenly(digest.lines, VOLUME_CARD_SUMMARY_CHARS)}`;
  const brief = clip(header, 120);
  const priority = kind === "current"
    ? STORY_ARC_PRIORITY.currentVolume
    : Math.max(STORY_ARC_PRIORITY.priorVolumeFloor, STORY_ARC_PRIORITY.priorVolume - (distance - 1) * STORY_ARC_PRIORITY.priorVolumeStep);
  return NarrativeContextCardSchema.parse({
    id: `story-arc:${bookId}:${kind === "current" ? "current" : "volume"}:${segment.id}`,
    bookId,
    sourceType: "chapter-summary",
    sourceId: `volume:${segment.id}`,
    channel: "timeline",
    title: kind === "current" ? `本卷前情·${segment.title}` : `卷摘要·${segment.title}`,
    content,
    normal,
    summary,
    brief,
    tags: ["chapter-summary", STORY_ARC_TAG, kind === "current" ? CURRENT_VOLUME_TAG : VOLUME_SUMMARY_TAG, "derived"],
    entities: [],
    priority,
    importance: 55,
    accessCount: 0,
    validFromChapter: segment.from,
    validUntilChapter: digest.coveredTo,
    reason: kind === "current"
      ? `本卷前情：当前卷里近章之前的部分，由经纬章摘要（chapter-summaries）现场派生（每章取首句），不落库；写第 ${currentChapter} 章时只用此前已发生的章。`
      : `卷摘要：由经纬章摘要（chapter-summaries）按卷纲区间现场派生（每章取首句），不落库；写第 ${currentChapter} 章时只用此前已发生的章。`,
    estimatedTokens: Math.max(1, estimateTokens(content)),
  });
}

function synopsisCard(bookId: string, digests: readonly VolumeDigest[], currentChapter: number): NarrativeContextCard {
  const lines = digests.map((digest) => {
    const head = `${digest.segment.title}（第${digest.segment.from}–${digest.coveredTo}章）`;
    const gist = clip(digest.lines.map((line) => line.replace(/^第\d+章：/u, "")).join(" "), SYNOPSIS_PER_VOLUME_CHARS);
    return `${head}：${gist}`;
  });
  const content = clip(lines.join("\n"), SYNOPSIS_MAX_CHARS);
  const from = digests[0]!.segment.from;
  const to = digests.at(-1)!.coveredTo;
  const brief = clip(`全书前情梗概：第${from}–${to}章，共 ${digests.length} 卷`, 120);
  return NarrativeContextCardSchema.parse({
    id: `story-arc:${bookId}:synopsis`,
    bookId,
    sourceType: "chapter-summary",
    sourceId: "book-synopsis",
    channel: "timeline",
    title: `全书前情梗概（第${from}–${to}章）`,
    content,
    summary: clip(lines.map((line) => line.split("：")[0]).join("；"), 400),
    brief,
    tags: ["chapter-summary", STORY_ARC_TAG, BOOK_SYNOPSIS_TAG, "derived"],
    entities: [],
    priority: STORY_ARC_PRIORITY.synopsis,
    importance: 45,
    accessCount: 0,
    validFromChapter: from,
    validUntilChapter: to,
    reason: `全书梗概：更早各卷的卷摘要再压缩一次（每卷取前 ${SYNOPSIS_PER_VOLUME_CHARS} 字），由章摘要现场派生，不落库；写第 ${currentChapter} 章时只用此前已发生的章。`,
    estimatedTokens: Math.max(1, estimateTokens(content)),
  });
}

/**
 * 构建层级前情卡。currentChapter 之前（不含）没有任何章摘要时返回空卡片。
 */
export function buildStoryArcCards(input: BuildStoryArcInput): StoryArcResult {
  const plan = planStoryArc(input.storage, input.bookId, input.currentChapter);
  const priorLimit = Math.max(0, input.priorVolumeCards ?? DEFAULT_PRIOR_VOLUME_CARDS);
  const recentCount = Math.max(0, input.recentChapterCount ?? 3);
  const allRows = loadConfirmedChapterSummaries(input.storage, input.bookId, { beforeChapter: input.currentChapter });
  // 最近 R 章由 recent-summary 通道细粒度注入，这里剔除，避免同一章两份表达。
  const recentChapters = new Set(allRows.slice(Math.max(0, allRows.length - recentCount)).map((row) => row.chapter));
  const rows = allRows.filter((row) => !recentChapters.has(row.chapter));

  const currentDigest = digestVolume(plan.current, rows, input.currentChapter);
  const digests = plan.prior
    .map((segment) => digestVolume(segment, rows, input.currentChapter))
    .filter((digest): digest is VolumeDigest => Boolean(digest));

  const detailed = digests.slice(Math.max(0, digests.length - priorLimit));
  const folded = digests.slice(0, Math.max(0, digests.length - priorLimit));
  const cards: NarrativeContextCard[] = [];
  if (currentDigest) cards.push(volumeCard(input.bookId, currentDigest, { kind: "current", distance: 0, currentChapter: input.currentChapter }));
  cards.push(...detailed.map((digest, index) => volumeCard(input.bookId, digest, { kind: "prior", distance: detailed.length - index, currentChapter: input.currentChapter })));
  if (folded.length > 0) cards.push(synopsisCard(input.bookId, folded, input.currentChapter));

  return {
    plan,
    cards,
    diagnostics: {
      source: plan.source,
      currentVolume: { id: plan.current.id, title: plan.current.title, from: plan.current.from, to: plan.current.to },
      currentVolumeCard: currentDigest ? { from: currentDigest.segment.from, to: currentDigest.coveredTo, chapters: currentDigest.chapterCount } : null,
      recentChaptersLeftToRecentSummary: [...recentChapters].sort((a, b) => a - b),
      volumeCards: detailed.map((digest) => ({ id: digest.segment.id, from: digest.segment.from, to: digest.coveredTo, chapters: digest.chapterCount })),
      synopsisVolumes: folded.map((digest) => digest.segment.id),
      priorVolumesWithoutSummaries: plan.prior.length - digests.length,
      chapterCap: input.currentChapter - 1,
      note: "卷摘要/全书梗概由经纬章摘要按卷纲现场派生，不落库。",
    },
  };
}
