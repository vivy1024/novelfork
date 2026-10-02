/**
 * 「待确认」聚合查询（只读）。
 *
 * 有六类「需要作者确认才生效」的产物散在不同入口，作者不知道去哪确认。
 * 本路由把这六类一次聚齐：计数 + 每类前 N 条摘要。
 * 数据全部从现有权威源派生（经纬条目、narrative_event、style_preset.json、
 * style-vault 目录），不新建表、不落盘；审批动作仍走各自的原有入口。
 *
 * 口径：
 * - 角色声线：经纬角色条目已生成过 fields.voice，且还有「待审」或「待补充」字段；
 * - 文风规则：style_preset.json 来源包里 status=needs-review 的规则；
 * - 伏笔草稿：经纬伏笔分类 status=needs-review 的条目（章后结算新埋）；
 * - 叙事事件（本章提议）：待审 narrative_event 里章号最新的一批——与写作视图
 *   「收尾」步的「本章提议」同一语义；
 * - 事实/关系草案：其余待审 narrative_event（更早章的遗留）;
 * - 改稿段：style-vault 里作者改过、但尚未「采纳为范文」的 AI 原稿对照段。
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { getStorageDatabase, isSafeBookId, type StorageDatabase } from "@vivy1024/novelfork-core";

import { createStoryJingweiEntryRepository } from "../engine/jingwei/repositories/entry-repo.js";
import { normalizeCategory } from "../engine/jingwei/unified-categories.js";
import type { StoryJingweiEntryRecord } from "../engine/jingwei/types.js";
import {
  CharacterVoiceError,
  parseCharacterVoice,
  summarizeCharacterVoice,
} from "../engine/writing-layers/character-voice.js";
import { loadStylePreset, StylePresetError } from "../engine/writing-layers/style-preset-store.js";
import {
  AUTHOR_REVISION_SOURCE_ID,
  extractRevisionPairs,
  readChapterAiDraft,
  revisionSampleId,
  STYLE_VAULT_RELATIVE_DIR,
} from "../engine/writing-layers/style-vault.js";
import { CHAPTERS_DIRECTORY, readChapterIndex } from "../engine/writing-resource/chapter-layout.js";
import { listPendingNarrativeEvents } from "../engine/narrative-memory/storage.js";
import type { NarrativeEvent } from "../engine/narrative-memory/types.js";

import {
  PENDING_REVIEW_LABELS,
  type PendingReviewGroup,
  type PendingReviewItem,
  type PendingReviewKind,
  type PendingReviewSummary,
  type PendingReviewTarget,
  type PendingReviewWarning,
} from "./pending-review-contract.js";

export {
  PENDING_REVIEW_KINDS,
  PENDING_REVIEW_LABELS,
  type PendingReviewGroup,
  type PendingReviewItem,
  type PendingReviewKind,
  type PendingReviewSummary,
  type PendingReviewTarget,
  type PendingReviewWarning,
} from "./pending-review-contract.js";

export interface CollectPendingReviewOptions {
  readonly storage: StorageDatabase;
  readonly resolveBookRoot?: (bookId: string) => string;
  /** 每类摘要条数上限（对外默认 5，内部最多 20）。 */
  readonly limit?: number;
}

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const PENDING_EVENT_SCAN_LIMIT = 200;

function clip(text: string, max = 90): string {
  const normalized = text.replace(/\s+/gu, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function eventSentence(event: NarrativeEvent): string {
  return clip([event.subject, event.predicate, event.object].filter(Boolean).join(" · "));
}

// ---------------------------------------------------------------------------
// 六类采集
// ---------------------------------------------------------------------------

function collectVoiceItems(
  entries: readonly StoryJingweiEntryRecord[],
  warnings: PendingReviewWarning[],
): PendingReviewItem[] {
  const items: PendingReviewItem[] = [];
  for (const entry of entries) {
    if (normalizeCategory(entry.category).category !== "characters") continue;
    if (entry.fields.voice === undefined || entry.fields.voice === null) continue;
    let needsReview: number;
    let missing: number;
    try {
      const summary = summarizeCharacterVoice(parseCharacterVoice(entry.fields.voice));
      needsReview = summary.needsReview;
      missing = summary.missing;
    } catch (error) {
      warnings.push({
        code: error instanceof CharacterVoiceError ? error.code : "CHARACTER_VOICE_UNREADABLE",
        message: `角色「${entry.title}」的声线数据损坏，已从聚合里跳过；请到角色卡从历史版本恢复。`,
      });
      continue;
    }
    if (needsReview === 0 && missing === 0) continue;
    const parts = [needsReview > 0 ? `${needsReview} 项待审` : "", missing > 0 ? `${missing} 项待补充` : ""].filter(Boolean);
    items.push({
      id: `voice:${entry.id}`,
      kind: "voice",
      typeLabel: PENDING_REVIEW_LABELS.voice,
      location: `角色「${entry.title}」`,
      summary: `声线${parts.join("、")}，确认后才写进对白约束。`,
      resolveAt: "角色卡 › 声线",
      target: { kind: "jingwei-entry", entryId: entry.id },
    });
  }
  return items;
}

interface StyleRuleDraft {
  readonly sourceId: string;
  readonly sourceTitle: string;
  readonly ruleIndex: number;
  readonly text: string;
}

async function loadStylePresetSources(bookRoot: string, warnings: PendingReviewWarning[]) {
  try {
    const loaded = await loadStylePreset(bookRoot);
    return { preset: loaded.preset, corrupted: false };
  } catch (error) {
    if (error instanceof StylePresetError) {
      warnings.push({ code: error.code, message: error.message });
      return { preset: null, corrupted: true };
    }
    throw error;
  }
}

function collectStyleRuleItems(
  preset: Awaited<ReturnType<typeof loadStylePreset>>["preset"],
): PendingReviewItem[] {
  if (!preset) return [];
  const drafts: StyleRuleDraft[] = [];
  for (const source of preset.sources) {
    source.rules.forEach((rule, ruleIndex) => {
      if (rule.status !== "needs-review") return;
      drafts.push({ sourceId: source.id, sourceTitle: source.title, ruleIndex, text: rule.text });
    });
  }
  return drafts.map((draft) => ({
    id: `styleRule:${draft.sourceId}:${draft.ruleIndex}`,
    kind: "styleRule" as const,
    typeLabel: PENDING_REVIEW_LABELS.styleRule,
    location: `来源包「${draft.sourceTitle}」`,
    summary: clip(draft.text),
    resolveAt: "文风自动蒸馏 › 审阅，或「技能文风 › 文风」规则列表",
    target: { kind: "style-panel" as const },
  }));
}

function collectForeshadowItems(entries: readonly StoryJingweiEntryRecord[]): PendingReviewItem[] {
  const items: PendingReviewItem[] = [];
  for (const entry of entries) {
    if (normalizeCategory(entry.category).category !== "foreshadowing") continue;
    if (entry.status !== "needs-review") continue;
    const plantedChapter = typeof entry.fields.plantedChapter === "number" ? entry.fields.plantedChapter : null;
    items.push({
      id: `foreshadow:${entry.id}`,
      kind: "foreshadow",
      typeLabel: PENDING_REVIEW_LABELS.foreshadow,
      location: plantedChapter !== null ? `第 ${plantedChapter} 章埋下` : "经纬 › 伏笔",
      summary: clip(entry.title),
      resolveAt: "伏笔条目（角色与设定 › 推进 › 伏笔）",
      target: { kind: "jingwei-entry", entryId: entry.id },
    });
  }
  return items;
}

function eventTargetFor(): PendingReviewTarget {
  return { kind: "events" };
}

function collectNarrativeEventItems(storage: StorageDatabase, bookId: string): {
  readonly current: readonly PendingReviewItem[];
  readonly earlier: readonly PendingReviewItem[];
} {
  const events = listPendingNarrativeEvents(storage, { bookId, limit: PENDING_EVENT_SCAN_LIMIT });
  if (events.length === 0) return { current: [], earlier: [] };
  // 「本章提议」与写作视图收尾步同义：待审事件里章号最新的一批；更早章的遗留归入事实/关系草案。
  const latestChapter = Math.max(...events.map((event) => event.chapterNumber));
  const toItem = (event: NarrativeEvent, kind: "event" | "fact", subKind: string): PendingReviewItem => ({
    id: `${kind}:${event.id}`,
    kind,
    typeLabel: PENDING_REVIEW_LABELS[kind],
    location: `第 ${event.chapterNumber} 章`,
    summary: `${subKind}：${eventSentence(event)}`,
    resolveAt: kind === "event" ? "写作视图「收尾」步，或「章后事实 › 待审队列」" : "「章后事实 › 待审队列」",
    target: eventTargetFor(),
  });
  const current: PendingReviewItem[] = [];
  const earlier: PendingReviewItem[] = [];
  for (const event of events) {
    const subKind = event.eventType === "relationship_changed" ? "关系草案" : event.eventType === "hook_planted" ? "伏笔动向" : "事实";
    if (event.chapterNumber === latestChapter) current.push(toItem(event, "event", subKind));
    else earlier.push(toItem(event, "fact", subKind));
  }
  return { current, earlier };
}

/** 没有 AI 原稿也保留 chapters 空；草稿损坏如实告警，不当作「没有可讨论的改稿」。 */
async function collectRevisionItems(
  bookRoot: string,
  preset: Awaited<ReturnType<typeof loadStylePreset>>["preset"],
  warnings: PendingReviewWarning[],
): Promise<PendingReviewItem[]> {
  const adoptedIds = new Set(
    preset?.sources.find((source) => source.id === AUTHOR_REVISION_SOURCE_ID)?.samples.map((sample) => sample.id) ?? [],
  );
  const vaultDir = join(bookRoot, STYLE_VAULT_RELATIVE_DIR);
  const names = await readdir(vaultDir).catch(() => [] as string[]);
  const draftChapters: number[] = [];
  for (const name of names) {
    const match = /^chapter-(\d{4,})\.json$/u.exec(name);
    if (match) draftChapters.push(Number(match[1]));
  }
  if (draftChapters.length === 0) return [];
  const index = new Map((await readChapterIndex(bookRoot)).map((entry) => [entry.number, entry] as const));
  const items: PendingReviewItem[] = [];
  for (const chapterNumber of draftChapters.sort((a, b) => a - b)) {
    const indexEntry = index.get(chapterNumber);
    if (!indexEntry) continue;
    let draft;
    try {
      draft = await readChapterAiDraft(bookRoot, chapterNumber);
    } catch (error) {
      warnings.push({
        code: "STYLE_VAULT_DRAFT_CORRUPTED",
        message: error instanceof Error ? error.message : `第 ${chapterNumber} 章的 AI 原稿无法读取。`,
      });
      continue;
    }
    if (!draft) continue;
    const current = await readFile(join(bookRoot, CHAPTERS_DIRECTORY, indexEntry.fileName), "utf8").catch(() => "");
    if (!current) continue;
    for (const pair of extractRevisionPairs(draft.text, current)) {
      const id = revisionSampleId(chapterNumber, pair.authorText);
      if (adoptedIds.has(id)) continue;
      items.push({
        id: `revision:${id}`,
        kind: "revision",
        typeLabel: PENDING_REVIEW_LABELS.revision,
        location: "第 " + chapterNumber + " 章",
        summary: `作者改稿：${clip(pair.authorText)}`,
        resolveAt: "文风金库 › 采纳为范文",
        target: { kind: "vault", chapterNumber },
      });
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// 聚合
// ---------------------------------------------------------------------------

export async function collectPendingReview(
  options: CollectPendingReviewOptions & { readonly bookId: string },
): Promise<PendingReviewSummary> {
  const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_LIMIT, MAX_LIMIT));
  const warnings: PendingReviewWarning[] = [];
  const entries = options.storage
    ? await createStoryJingweiEntryRepository(options.storage).listByBook(options.bookId)
    : [];
  const bookRoot = options.resolveBookRoot?.(options.bookId);

  const voiceItems = collectVoiceItems(entries, warnings);
  const { preset } = bookRoot
    ? await loadStylePresetSources(bookRoot, warnings)
    : { preset: null };
  const styleRuleItems = collectStyleRuleItems(preset);
  const foreshadowItems = collectForeshadowItems(entries);
  const { current: eventItems, earlier: factItems } = collectNarrativeEventItems(options.storage, options.bookId);
  const revisionItems = bookRoot ? await collectRevisionItems(bookRoot, preset, warnings) : [];

  const groups: PendingReviewGroup[] = (
    [
      ["voice", voiceItems],
      ["styleRule", styleRuleItems],
      ["foreshadow", foreshadowItems],
      ["event", eventItems],
      ["fact", factItems],
      ["revision", revisionItems],
    ] as Array<[PendingReviewKind, PendingReviewItem[]]>
  ).map(([kind, items]) => ({
    kind,
    label: PENDING_REVIEW_LABELS[kind],
    count: items.length,
    items: items.slice(0, limit),
  }));
  const total = groups.reduce((sum, group) => sum + group.count, 0);

  const explanation = total > 0
    ? [
        "这些产物要作者确认后才生效：声线规则（确认前先不进对白约束）、文风规则（确认前不进写作指南）、",
        "伏笔草稿与待审事件（确认前不进写作上下文）、改稿段（采纳后才成为范文）。",
        "逐项去「去处理」列出的原有入口决定，本面板不做就地审批。",
      ].join("")
    : [
        "六类待确认来源都查过了，当前没有待处理项。",
        "来源包括：角色声线（角色卡）、文风蒸馏规则（文风自动蒸馏/技能文风）、伏笔草稿（章后结算）、",
        "待审叙事事件（写作视图收尾/章后事实）与文风金库未采纳的改稿段。",
        "以后机器生成的草稿会先在这里排队，确认入口不变。",
      ].join("");

  return { bookId: options.bookId, total, groups, explanation, warnings };
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

export interface CreatePendingReviewRouterOptions {
  readonly storage?: StorageDatabase;
  /** 书籍根目录（文风预设与金库是文件权威源）；不给时这两类返回空并在 warning 里说明。 */
  readonly resolveBookRoot?: (bookId: string) => string;
}

export function createPendingReviewRouter(options: CreatePendingReviewRouterOptions = {}): Hono {
  const app = new Hono();

  app.get("/api/books/:bookId/pending-review", async (c) => {
    const bookId = c.req.param("bookId");
    if (!isSafeBookId(bookId)) {
      return c.json({
        error: `书籍 ID 不合法：${bookId}`,
        code: "INVALID_BOOK_ID",
        explanation: {
          whatHappened: "请求里的书籍 ID 含非法字符。",
          whyItMatters: "非法 ID 可能指向书籍目录之外。",
          suggestedAction: "从作品列表重新打开这本书。",
        },
      }, 400);
    }
    const rawLimit = Number(c.req.query("limit") ?? "");
    const limit = Number.isSafeInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_LIMIT) : DEFAULT_LIMIT;
    const storage = options.storage ?? getStorageDatabase();
    const summary = await collectPendingReview({
      storage,
      bookId,
      ...(options.resolveBookRoot ? { resolveBookRoot: options.resolveBookRoot } : {}),
      limit,
    });
    const routeWarnings = options.resolveBookRoot
      ? summary.warnings
      : [
          ...summary.warnings,
          { code: "BOOK_ROOT_UNAVAILABLE", message: "这个入口没有接到书籍目录，文风规则与改稿段未统计。" } satisfies PendingReviewWarning,
        ];
    return c.json({ ...summary, warnings: routeWarnings });
  });

  return app;
}
