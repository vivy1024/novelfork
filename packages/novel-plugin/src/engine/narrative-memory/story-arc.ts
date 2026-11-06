/**
 * 层级前情（卷摘要 / 全书梗概）——召回时优先用落盘的模型归纳版本，缺失或过期时现场从章摘要确定性派生。
 *
 * 单一权威源：章摘要的权威在经纬 chapter-summaries；卷的划分在经纬 outline「卷纲」条目
 * 的 fields_json.volumes[].chapterRange（多条「卷纲」时的取舍见 outline-volume.ts 的 selectAuthoritativeVolumeOutline）。
 * 落盘的卷摘要 / 全书梗概（narrative_arc_summary，见 arc-summary-store.ts）是由章摘要派生的缓存：
 * 输入指纹对不上（章摘要改过）就当作没有，退回现场派生。待确认（needs-review）的版本可以用，但卡片标注「待确认」。
 *
 * 层级（写/修第 N 章）：
 *   - 近章：最近 R 章（R = recent-summary 的条数上限）由 recent-summary 通道细粒度呈现，这里不重复；
 *   - 当前卷（含 N 的那一卷）里近章之前的部分：一张「本卷前情」卡（有阶段摘要时 = 阶段摘要 + 其后各章首句）；
 *   - 此前最近的 K 卷（默认 K=5）：每卷一张卷摘要卡（落盘版本优先；否则每章摘要取首句，按章号拼接，再截到卷上限）；
 *   - 更早的卷：合成一张全书梗概卡（落盘梗概优先；否则逐卷取落盘卷摘要的一句话版本，再否则每卷取前若干字）。
 *   - 章号上限：所有内容只取 chapter < N；卷区间跨过 N 时截到 N-1。
 *   - 预算降档顺序（budget.ts 的层级前情档位按 priority 执行）：近章 > 本卷前情 > 前卷（近→远）> 全书梗概。
 *
 * 没有卷纲的书：按每 FALLBACK_VOLUME_SIZE（50）章一段兜底分段。
 */

import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { loadCurrentVolumeContext } from "../../handlers/outline-volume.js";
import { estimateTokens } from "../jingwei/context/token-budget.js";
import { isArcSummaryFresh, listArcSummaries, synopsisSegmentId, type ArcSummaryRecord } from "./arc-summary-store.js";
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
  /** 未过期的落盘摘要（前卷 = 整卷摘要；本卷 = 阶段摘要）。 */
  readonly persisted?: ArcSummaryRecord;
}

function digestVolume(
  segment: StoryArcSegment,
  rows: readonly ChapterSummaryRow[],
  upperExclusive: number,
  persisted?: ArcSummaryRecord,
): VolumeDigest | undefined {
  const to = Math.min(segment.to, upperExclusive - 1);
  const inRange = rows.filter((row) => row.chapter >= segment.from && row.chapter <= to);
  if (inRange.length === 0 && !persisted) return undefined;
  // 有阶段摘要时，逐章首句只补阶段摘要之后的章。
  const tail = persisted ? inRange.filter((row) => row.chapter > persisted.chapterTo) : inRange;
  const coveredTo = Math.max(inRange.at(-1)?.chapter ?? 0, persisted?.chapterTo ?? 0);
  return {
    segment,
    coveredTo,
    chapterCount: persisted ? persisted.sourceChapters.length + tail.length : inRange.length,
    lines: tail.map((row) => `第${row.chapter}章：${firstSentence(row.summary, PER_CHAPTER_CHARS)}`),
    ...(persisted ? { persisted } : {}),
  };
}

/**
 * 作者是否确认过这条内容。被结算标过期（stale）、但指纹仍一致（章摘要改回原样）的，
 * 内容与作者确认时相同，仍算已确认。
 */
function isAuthorConfirmed(record: ArcSummaryRecord): boolean {
  return record.status === "confirmed" || (record.status === "stale" && record.confirmedAt !== undefined);
}

function reviewLabel(record: ArcSummaryRecord): string {
  return isAuthorConfirmed(record) ? "" : "（待确认）";
}

function persistedTags(record: ArcSummaryRecord): string[] {
  return ["model-summary", isAuthorConfirmed(record) ? "confirmed" : "needs-review"];
}

function keyChapterNote(record: ArcSummaryRecord): string {
  return record.content.keyChapters.length > 0 ? `关键章：第${record.content.keyChapters.join("、")}章` : "";
}

function volumeCard(
  bookId: string,
  digest: VolumeDigest,
  options: { readonly kind: "current" | "prior"; readonly distance: number; readonly currentChapter: number },
): NarrativeContextCard {
  const { segment, persisted } = digest;
  const { kind, distance, currentChapter } = options;
  const range = `第${segment.from}–${digest.coveredTo}章`;
  const label = persisted ? reviewLabel(persisted) : "";
  const header = `${segment.title}${label}（${range}，共 ${digest.chapterCount} 章摘要）${segment.goal ? `；卷目标：${segment.goal}` : ""}`;
  let content: string;
  let normal: string;
  let summary: string;
  if (persisted) {
    // 落盘摘要（模型归纳）在前，阶段摘要之后的章逐章首句补在后面；回查用的关键章附在摘要后。
    const note = keyChapterNote(persisted);
    const body = `${persisted.content.text}${note ? `\n${note}` : ""}`;
    const tail = (max: number) => (digest.lines.length > 0 ? `\n${sampleLinesEvenly(digest.lines, max)}` : "");
    content = `${header}\n${body}${tail(VOLUME_CARD_NORMAL_CHARS)}`;
    normal = `${header}\n${clip(persisted.content.text, VOLUME_CARD_NORMAL_CHARS)}${tail(VOLUME_CARD_SUMMARY_CHARS)}`;
    summary = `${header}\n${persisted.content.gist || clip(persisted.content.text, VOLUME_CARD_SUMMARY_CHARS)}`;
  } else {
    // full / normal / summary / brief：预算紧时逐档变短（均匀抽样的条数越来越少 → 只留标题）
    content = `${header}\n${sampleLinesEvenly(digest.lines, VOLUME_CARD_MAX_CHARS)}`;
    normal = `${header}\n${sampleLinesEvenly(digest.lines, VOLUME_CARD_NORMAL_CHARS)}`;
    summary = `${header}\n${sampleLinesEvenly(digest.lines, VOLUME_CARD_SUMMARY_CHARS)}`;
  }
  const brief = clip(header, 120);
  const priority = kind === "current"
    ? STORY_ARC_PRIORITY.currentVolume
    : Math.max(STORY_ARC_PRIORITY.priorVolumeFloor, STORY_ARC_PRIORITY.priorVolume - (distance - 1) * STORY_ARC_PRIORITY.priorVolumeStep);
  const scope = `写第 ${currentChapter} 章时只用此前已发生的章。`;
  const reason = persisted
    ? `${kind === "current" ? "本卷前情" : "卷摘要"}：模型据第${persisted.chapterFrom}–${persisted.chapterTo}章的章摘要归纳并落盘${isAuthorConfirmed(persisted) ? "（作者已确认）" : "（待作者确认，内容可能有出入，以章摘要为准）"}${digest.lines.length > 0 ? "，其后各章取章摘要首句" : ""}；${scope}`
    : kind === "current"
      ? `本卷前情：当前卷里近章之前的部分，由经纬章摘要（chapter-summaries）现场派生（每章取首句）；${scope}`
      : `卷摘要：由经纬章摘要（chapter-summaries）按卷纲区间现场派生（每章取首句），还没有模型归纳的卷摘要；${scope}`;
  return NarrativeContextCardSchema.parse({
    id: `story-arc:${bookId}:${kind === "current" ? "current" : "volume"}:${segment.id}`,
    bookId,
    sourceType: "chapter-summary",
    sourceId: persisted ? persisted.id : `volume:${segment.id}`,
    channel: "timeline",
    title: kind === "current" ? `本卷前情·${segment.title}${label}` : `卷摘要·${segment.title}${label}`,
    content,
    normal,
    summary,
    brief,
    tags: ["chapter-summary", STORY_ARC_TAG, kind === "current" ? CURRENT_VOLUME_TAG : VOLUME_SUMMARY_TAG, "derived", ...(persisted ? persistedTags(persisted) : [])],
    entities: [],
    priority,
    importance: 55,
    accessCount: 0,
    validFromChapter: segment.from,
    validUntilChapter: digest.coveredTo,
    reason,
    estimatedTokens: Math.max(1, estimateTokens(content)),
  });
}

function synopsisCard(
  bookId: string,
  digests: readonly VolumeDigest[],
  currentChapter: number,
  persisted: ArcSummaryRecord | undefined,
): NarrativeContextCard {
  const from = digests[0]!.segment.from;
  const to = digests.at(-1)!.coveredTo;
  const heads = digests.map((digest) => `${digest.segment.title}（第${digest.segment.from}–${digest.coveredTo}章）`);
  let content: string;
  let summaryText: string;
  let label = "";
  let reason: string;
  const scope = `写第 ${currentChapter} 章时只用此前已发生的章。`;
  if (persisted) {
    label = reviewLabel(persisted);
    const note = keyChapterNote(persisted);
    content = clip(`${persisted.content.text}${note ? `\n${note}` : ""}`, SYNOPSIS_MAX_CHARS + 200);
    summaryText = `${persisted.content.gist}\n${heads.join("；")}`;
    reason = `全书梗概：模型据第${persisted.chapterFrom}–${persisted.chapterTo}章各卷卷摘要归纳并落盘${isAuthorConfirmed(persisted) ? "（作者已确认）" : "（待作者确认，内容可能有出入，以章摘要为准）"}；${scope}`;
  } else {
    // 没有落盘梗概：每卷优先用落盘卷摘要的一句话版本，否则取首句拼接的前若干字。
    const lines = digests.map((digest, index) => {
      const gist = digest.persisted
        ? `${digest.persisted.content.gist || clip(digest.persisted.content.text, SYNOPSIS_PER_VOLUME_CHARS)}${reviewLabel(digest.persisted)}`
        : clip(digest.lines.map((line) => line.replace(/^第\d+章：/u, "")).join(" "), SYNOPSIS_PER_VOLUME_CHARS);
      return `${heads[index]}：${gist}`;
    });
    content = clip(lines.join("\n"), SYNOPSIS_MAX_CHARS);
    summaryText = heads.join("；");
    const usedPersisted = digests.some((digest) => digest.persisted);
    reason = `全书梗概：更早各卷${usedPersisted ? "优先用模型归纳的卷摘要一句话版本，其余" : ""}由章摘要现场派生（每卷取前 ${SYNOPSIS_PER_VOLUME_CHARS} 字）；${scope}`;
  }
  const brief = clip(`全书前情梗概${label}：第${from}–${to}章，共 ${digests.length} 卷`, 120);
  return NarrativeContextCardSchema.parse({
    id: `story-arc:${bookId}:synopsis`,
    bookId,
    sourceType: "chapter-summary",
    sourceId: persisted ? persisted.id : "book-synopsis",
    channel: "timeline",
    title: `全书前情梗概${label}（第${from}–${to}章）`,
    content,
    summary: clip(summaryText, 400),
    brief,
    tags: ["chapter-summary", STORY_ARC_TAG, BOOK_SYNOPSIS_TAG, "derived", ...(persisted ? persistedTags(persisted) : [])],
    entities: [],
    priority: STORY_ARC_PRIORITY.synopsis,
    importance: 45,
    accessCount: 0,
    validFromChapter: from,
    validUntilChapter: to,
    reason,
    estimatedTokens: Math.max(1, estimateTokens(content)),
  });
}

function loadArcRecords(storage: StorageDatabase, bookId: string): ArcSummaryRecord[] {
  try {
    return listArcSummaries(storage, bookId);
  } catch {
    return [];
  }
}

/** 当前卷可用的阶段摘要：覆盖区间完全早于本章、未过期，取覆盖最远的一条。 */
function pickCheckpoint(
  records: readonly ArcSummaryRecord[],
  segment: StoryArcSegment,
  allRows: readonly ChapterSummaryRow[],
  currentChapter: number,
): ArcSummaryRecord | undefined {
  const prefix = `${segment.id}@`;
  return records
    .filter((record) => record.kind === "volume" && record.segmentId.startsWith(prefix) && record.chapterFrom === segment.from && record.chapterTo < currentChapter)
    .filter((record) => isArcSummaryFresh(record, allRows, { from: record.chapterFrom, to: record.chapterTo }))
    .sort((a, b) => b.chapterTo - a.chapterTo)[0];
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

  // 落盘摘要：只用区间完全早于本章、指纹与当前章摘要一致的（过期的当作没有）。
  const records = allRows.length > 0 ? loadArcRecords(input.storage, input.bookId) : [];
  const volumeRecords = new Map(records.filter((record) => record.kind === "volume").map((record) => [record.segmentId, record]));
  let staleIgnored = 0;
  const freshVolume = (segment: StoryArcSegment): ArcSummaryRecord | undefined => {
    const record = volumeRecords.get(segment.id);
    if (!record || segment.to >= input.currentChapter) return undefined;
    if (isArcSummaryFresh(record, allRows, { from: segment.from, to: segment.to })) return record;
    staleIgnored += 1;
    return undefined;
  };

  // 本卷阶段摘要会覆盖近章时不用（近章由 recent-summary 细粒度给，阶段摘要只取近章之前的）。
  const firstRecent = Math.min(...[...recentChapters], input.currentChapter);
  const checkpoint = pickCheckpoint(records, plan.current, allRows, firstRecent);
  const currentDigest = digestVolume(plan.current, rows, input.currentChapter, checkpoint);
  const digests = plan.prior
    .map((segment) => digestVolume(segment, rows, input.currentChapter, freshVolume(segment)))
    .filter((digest): digest is VolumeDigest => Boolean(digest));

  const detailed = digests.slice(Math.max(0, digests.length - priorLimit));
  const folded = digests.slice(0, Math.max(0, digests.length - priorLimit));
  let synopsisRecord: ArcSummaryRecord | undefined;
  if (folded.length > 0) {
    const candidate = records.find((record) => record.kind === "synopsis" && record.segmentId === synopsisSegmentId(folded.at(-1)!.segment.id));
    const range = { from: folded[0]!.segment.from, to: folded.at(-1)!.segment.to };
    if (candidate && range.to < input.currentChapter) {
      if (isArcSummaryFresh(candidate, allRows, range)) synopsisRecord = candidate;
      else staleIgnored += 1;
    }
  }
  const cards: NarrativeContextCard[] = [];
  if (currentDigest) cards.push(volumeCard(input.bookId, currentDigest, { kind: "current", distance: 0, currentChapter: input.currentChapter }));
  cards.push(...detailed.map((digest, index) => volumeCard(input.bookId, digest, { kind: "prior", distance: detailed.length - index, currentChapter: input.currentChapter })));
  if (folded.length > 0) cards.push(synopsisCard(input.bookId, folded, input.currentChapter, synopsisRecord));

  const persistedSummary = (record: ArcSummaryRecord | undefined) => (record ? { id: record.id, status: record.status, from: record.chapterFrom, to: record.chapterTo } : null);
  return {
    plan,
    cards,
    diagnostics: {
      source: plan.source,
      currentVolume: { id: plan.current.id, title: plan.current.title, from: plan.current.from, to: plan.current.to },
      currentVolumeCard: currentDigest ? { from: currentDigest.segment.from, to: currentDigest.coveredTo, chapters: currentDigest.chapterCount, persisted: persistedSummary(currentDigest.persisted) } : null,
      recentChaptersLeftToRecentSummary: [...recentChapters].sort((a, b) => a - b),
      volumeCards: detailed.map((digest) => ({ id: digest.segment.id, from: digest.segment.from, to: digest.coveredTo, chapters: digest.chapterCount, persisted: persistedSummary(digest.persisted) })),
      synopsisVolumes: folded.map((digest) => digest.segment.id),
      synopsis: folded.length > 0 ? { persisted: persistedSummary(synopsisRecord) } : null,
      staleArcSummariesIgnored: staleIgnored,
      priorVolumesWithoutSummaries: plan.prior.length - digests.length,
      chapterCap: input.currentChapter - 1,
      note: "卷摘要/全书梗概优先用模型归纳的落盘版本（待确认的会标注）；缺失或章摘要已改过时由经纬章摘要按卷纲现场派生。",
    },
  };
}
