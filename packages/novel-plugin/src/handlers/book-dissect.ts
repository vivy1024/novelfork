/**
 * book.dissect / import 闭环辅助：从已有正文抽取续写所需的最小草案。
 * 默认只出草案；apply=true 时写入 dissection_staging，确认前不进正式经纬。
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { getStorageDatabase } from "@vivy1024/novelfork-core";

import { handleChapterRead } from "./chapter-read.js";
import { handleMemorySettleRange } from "./memory-settle-range.js";
import { handleWritePreflight } from "./write-preflight.js";
import {
  DISSECT_LLM_SYSTEM_PROMPT,
  buildDissectLlmUserPrompt,
  extractKnowledgePack,
  mergeLlmKnowledgePack,
  type DissectKnowledgePack,
  type DissectWorldCategory,
} from "./dissect-knowledge.js";
import {
  dissectPurposeProfile,
  filterKnowledgeForPurpose,
  resolveDissectPurpose,
  resolveDissectTargets,
  shouldStageKind,
  type DissectPurpose,
  type DissectTarget,
} from "./dissect-purpose.js";
import { listLedgerEntries, type LedgerKind } from "./jingwei-ledger-store.js";
import {
  findDuplicateJingweiEntries,
  insertDissectionStaging,
  isInvalidEntityTitle,
  type DissectionStagingKind,
  type DissectionStagingRecord,
  type DissectionSourceRef,
} from "../engine/jingwei/dissection-staging.js";

/** 世界要素分类 → 经纬分类。 */
const WORLD_CATEGORY_MAP: Record<DissectWorldCategory, LedgerKind> = {
  location: "locations",
  faction: "factions",
  "power-system": "power-system",
  rules: "rules",
  props: "props",
  timeline: "world-model",
};

export type { DissectPurpose, DissectTarget } from "./dissect-purpose.js";

export interface BookDissectInput {
  readonly bookId: string;
  readonly bookRoot: string;
  readonly fromChapter?: number;
  readonly toChapter?: number;
  readonly targets?: readonly DissectTarget[];
  /** 拆书目的：写后续 / 同人 / 改编 / AI漫剧剧本。默认写后续。 */
  readonly purpose?: string;
  /** 默认 false：只返回草案；true 时写入 dissection_staging（非正式经纬）。 */
  readonly apply?: boolean;
  readonly settle?: boolean;
  readonly storage?: StorageDatabase;
  readonly generateText?: (input: {
    messages: Array<{ role: "system" | "user"; content: string }>;
    temperature?: number;
    maxTokens?: number;
  }) => Promise<{ text: string }>;
  /** settle=true 时叙事事件抽取器；缺失时对应章节结算失败（不落假账），可重试。 */
  readonly llmExtractor?: import("../engine/narrative-memory/chapter-event-extractor.js").ChapterEventExtractorInput["llmExtractor"];
}

export interface DissectDraft {
  readonly characters: readonly string[];
  readonly locations: readonly string[];
  readonly hooks: readonly string[];
  readonly chapterSummaries: readonly { readonly number: number; readonly summary: string }[];
  readonly suggestedFocus: string | null;
  readonly notes: readonly string[];
}

export interface BookDissectResult {
  readonly ok: boolean;
  readonly bookId: string;
  readonly fromChapter: number;
  readonly toChapter: number;
  readonly applied: boolean;
  readonly settled: boolean;
  readonly purpose?: DissectPurpose;
  readonly purposeLabel?: string;
  /** 兼容字段：扁平草案（等于 knowledge 的兼容视图） */
  readonly draft: DissectDraft;
  /** 结构化续写知识包 */
  readonly knowledge?: DissectKnowledgePack;
  readonly preflight?: Awaited<ReturnType<typeof handleWritePreflight>>;
  readonly settlementSummary?: string;
  readonly writtenFiles: readonly string[];
  readonly staging?: readonly DissectionStagingRecord[];
  readonly rejectedCandidates?: readonly { readonly title: string; readonly reason: string }[];
  readonly summary: string;
  readonly error?: string;
}

const EMPTY_DRAFT: DissectDraft = {
  characters: [],
  locations: [],
  hooks: [],
  chapterSummaries: [],
  suggestedFocus: null,
  notes: [],
};

function targetsOf(input: BookDissectInput, purpose: DissectPurpose): Set<DissectTarget | "all"> {
  return resolveDissectTargets(purpose, input.targets);
}

function uniqueStrings(values: readonly string[], limit = 40): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= limit) break;
  }
  return out;
}

/** 兼容入口：返回扁平草案（内部走结构化知识包）。 */
export function extractDissectDraftFromTexts(
  chapters: readonly { number: number; title: string; content: string }[],
): DissectDraft {
  return toFlatDraft(extractKnowledgePack(chapters));
}

function sourceRefs(chapterNumber: number, excerpt?: string): DissectionSourceRef[] {
  const text = excerpt?.trim() ?? "";
  return text ? [{ chapterNumber, excerpt: text.slice(0, 180) }] : [];
}

function existingLookups(storage: StorageDatabase, bookId: string, category: LedgerKind) {
  return listLedgerEntries(storage, bookId, category).map((entry) => ({
    id: entry.id,
    title: entry.title,
    aliases: Array.isArray(entry.fields.aliases)
      ? entry.fields.aliases.filter((item): item is string => typeof item === "string")
      : [],
    category,
  }));
}

function tryStage(
  storage: StorageDatabase,
  input: Parameters<typeof insertDissectionStaging>[1],
  staged: DissectionStagingRecord[],
  rejected: Array<{ title: string; reason: string }>,
): void {
  const invalid = isInvalidEntityTitle(input.proposedTitle, input.kind);
  if (invalid) {
    rejected.push({ title: input.proposedTitle, reason: invalid });
    return;
  }
  try {
    staged.push(insertDissectionStaging(storage, input));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (/^(invalid-entity:|missing-evidence)/u.test(reason)) {
      rejected.push({ title: input.proposedTitle, reason });
      return;
    }
    throw error;
  }
}

function toFlatDraft(pack: DissectKnowledgePack): DissectDraft {
  return {
    characters: pack.characters,
    locations: pack.locations,
    hooks: pack.hooks,
    chapterSummaries: pack.chapterSummaries,
    suggestedFocus: pack.suggestedFocus,
    notes: pack.notes,
  };
}

async function listChapterRange(
  bookId: string,
  bookRoot: string,
  fromChapter: number,
  toChapter: number,
  storage?: StorageDatabase,
): Promise<Array<{ number: number; title: string; content: string }>> {
  const chapters: Array<{ number: number; title: string; content: string }> = [];
  for (let n = fromChapter; n <= toChapter; n++) {
    const read = await handleChapterRead(
      { bookId, chapterNumber: n },
      undefined,
      { bookRoot, storage },
    );
    if (!read.ok || !read.data?.content?.trim()) continue;
    chapters.push({
      number: n,
      title: `第${n}章`,
      content: read.data.content,
    });
  }
  return chapters;
}

async function resolveRange(
  bookRoot: string,
  fromChapter?: number,
  toChapter?: number,
): Promise<{ from: number; to: number }> {
  try {
    const raw = await readFile(join(bookRoot, "chapters", "index.json"), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const numbers = Array.isArray(parsed)
      ? parsed
          .map((entry) => Number((entry as { number?: unknown }).number))
          .filter((n) => Number.isFinite(n) && n > 0)
      : [];
    const max = numbers.length ? Math.max(...numbers) : 1;
    const from = typeof fromChapter === "number" && fromChapter > 0 ? Math.trunc(fromChapter) : 1;
    const to = typeof toChapter === "number" && toChapter >= from ? Math.trunc(toChapter) : max;
    return { from, to: Math.max(from, to) };
  } catch {
    const from = typeof fromChapter === "number" && fromChapter > 0 ? Math.trunc(fromChapter) : 1;
    const to = typeof toChapter === "number" && toChapter >= from ? Math.trunc(toChapter) : from;
    return { from, to };
  }
}

async function maybeLlmEnrichPack(
  pack: DissectKnowledgePack,
  chapters: readonly { number: number; title: string; content: string }[],
  range: { from: number; to: number },
  generateText: BookDissectInput["generateText"],
  purposeHint?: string,
): Promise<DissectKnowledgePack> {
  if (!generateText || chapters.length === 0) return pack;
  const sampleChapters = chapters.slice(-4);
  const totalChars = sampleChapters.reduce((sum, chapter) => sum + chapter.content.length, 0);
  if (totalChars < 200) return pack;
  try {
    const generated = await generateText({
      messages: [
        { role: "system", content: DISSECT_LLM_SYSTEM_PROMPT },
        {
          role: "user",
          content: buildDissectLlmUserPrompt({
            heuristic: pack,
            chapters: sampleChapters,
            fromChapter: range.from,
            toChapter: range.to,
            ...(purposeHint ? { purposeHint } : {}),
          }),
        },
      ],
      temperature: 0.2,
      maxTokens: 4000,
    });
    return mergeLlmKnowledgePack(pack, generated.text);
  } catch {
    return {
      ...pack,
      notes: [...pack.notes, "LLM 增补失败，保留规则抽取结果。"],
    };
  }
}

export async function handleBookDissect(input: BookDissectInput): Promise<BookDissectResult> {
  const bookId = input.bookId?.trim();
  if (!bookId) {
    return {
      ok: false,
      bookId: "",
      fromChapter: 0,
      toChapter: 0,
      applied: false,
      settled: false,
      draft: EMPTY_DRAFT,
      writtenFiles: [],
      summary: "缺少 bookId。",
      error: "missing-book-id",
    };
  }
  if (!input.bookRoot?.trim()) {
    return {
      ok: false,
      bookId,
      fromChapter: 0,
      toChapter: 0,
      applied: false,
      settled: false,
      draft: EMPTY_DRAFT,
      writtenFiles: [],
      summary: "缺少可信 bookRoot。",
      error: "missing-book-root",
    };
  }

  const range = await resolveRange(input.bookRoot, input.fromChapter, input.toChapter);
  if (range.to - range.from > 200) {
    return {
      ok: false,
      bookId,
      fromChapter: range.from,
      toChapter: range.to,
      applied: false,
      settled: false,
      draft: EMPTY_DRAFT,
      writtenFiles: [],
      summary: "单次 dissect 最多 200 章。",
      error: "range-too-large",
    };
  }

  const purposeOrInvalid = resolveDissectPurpose(input.purpose);
  if (purposeOrInvalid === "invalid") {
    return {
      ok: false,
      bookId,
      fromChapter: range.from,
      toChapter: range.to,
      applied: false,
      settled: false,
      draft: EMPTY_DRAFT,
      writtenFiles: [],
      summary: "拆书目的只能是写后续、同人、改编或 AI 漫剧剧本。",
      error: "invalid-purpose",
    };
  }
  const purpose = purposeOrInvalid;
  const purposeProfile = dissectPurposeProfile(purpose);
  const storage = input.storage ?? getStorageDatabase();
  const want = targetsOf(input, purpose);
  const chapters = await listChapterRange(bookId, input.bookRoot, range.from, range.to, storage);
  if (chapters.length === 0) {
    return {
      ok: false,
      bookId,
      fromChapter: range.from,
      toChapter: range.to,
      applied: false,
      settled: false,
      draft: EMPTY_DRAFT,
      writtenFiles: [],
      summary: "指定范围内无正文可读。",
      error: "no-chapters",
    };
  }

  let knowledge = extractKnowledgePack(chapters);
  if (want.has("all") || want.has("characters") || want.has("hooks") || want.has("world") || want.has("summaries")) {
    knowledge = await maybeLlmEnrichPack(knowledge, chapters, range, input.generateText, purposeProfile.promptHint);
  }
  knowledge = filterKnowledgeForPurpose(knowledge, purpose);
  const draft = toFlatDraft(knowledge);

  let settled = false;
  let settlementSummary: string | undefined;
  if (input.settle) {
    const settlement = await handleMemorySettleRange({
      bookId,
      bookRoot: input.bookRoot,
      fromChapter: range.from,
      toChapter: range.to,
      storage,
      ...(input.llmExtractor ? { llmExtractor: input.llmExtractor } : {}),
    });
    settled = settlement.ok && settlement.chaptersSettled > 0;
    settlementSummary = settlement.summary;
  }

  const writtenFiles: string[] = [];
  const staged: DissectionStagingRecord[] = [];
  const rejectedCandidates: Array<{ title: string; reason: string }> = [];
  if (input.apply) {
    const createdAt = new Date().toISOString();
    const now = () => new Date(createdAt);

    const applyStagingWrite = () => {
      if ((want.has("all") || want.has("hooks")) && shouldStageKind(purpose, "foreshadowing")) {
        const existing = existingLookups(storage, bookId, "foreshadowing");
        for (const hook of knowledge.openHooks) {
          const title = hook.description.slice(0, 24) || `伏笔`;
          const refs = sourceRefs(hook.plantedChapter, hook.evidence || hook.description);
          tryStage(storage, {
            bookId,
            kind: "foreshadowing",
            category: "foreshadowing",
            proposedTitle: title,
            aliases: [],
            sourceRefs: refs,
            classificationReason: "拆书抽取未回收线索",
            confidence: 0.4,
            duplicateCandidates: findDuplicateJingweiEntries(existing, { title, category: "foreshadowing" }),
            contentMd: [
              `- 埋设章：第${hook.plantedChapter}章`,
              `- 状态：${hook.status === "progressed" ? "已有进展" : "未回收"}`,
              hook.evidence ? `- 证据：${hook.evidence}` : "",
              hook.speculation ? `- 续写建议：${hook.speculation}` : "",
            ].filter(Boolean).join("\n"),
            fields: {
              hookStatus: hook.status === "progressed" ? "progressed" : "pending",
              plantedChapter: hook.plantedChapter,
              source: "book.dissect",
            },
            now,
          }, staged, rejectedCandidates);
        }
      }

      if ((want.has("all") || want.has("summaries")) && shouldStageKind(purpose, "chapter-summaries")) {
        const existing = existingLookups(storage, bookId, "chapter-summaries");
        for (const summary of knowledge.detailedSummaries) {
          const title = `第${summary.number}章`;
          tryStage(storage, {
            bookId,
            kind: "chapter-summaries",
            category: "chapter-summaries",
            proposedTitle: title,
            sourceRefs: sourceRefs(summary.number, summary.summary),
            classificationReason: "拆书抽取章摘要",
            confidence: 0.5,
            duplicateCandidates: findDuplicateJingweiEntries(existing, { title, category: "chapter-summaries" }),
            contentMd: [
              summary.summary,
              summary.keyEvents.length > 0 ? `\n关键事件：\n${summary.keyEvents.map((item) => `- ${item}`).join("\n")}` : "",
            ].filter(Boolean).join("\n"),
            fields: { chapterNumber: summary.number, keyEvents: summary.keyEvents, source: "book.dissect" },
            now,
          }, staged, rejectedCandidates);
        }
      }

      if ((want.has("all") || want.has("characters")) && shouldStageKind(purpose, "characters")) {
        const existing = existingLookups(storage, bookId, "characters");
        for (const card of knowledge.characterCards) {
          tryStage(storage, {
            bookId,
            kind: "characters",
            category: "characters",
            proposedTitle: card.name,
            aliases: card.aliases,
            sourceRefs: sourceRefs(card.firstAppearance, card.identity),
            classificationReason: "拆书抽取角色",
            confidence: card.confidence,
            duplicateCandidates: findDuplicateJingweiEntries(existing, {
              title: card.name,
              aliases: card.aliases,
              category: "characters",
            }),
            contentMd: [
              `- 身份：${card.identity}`,
              card.aliases.length > 0 ? `- 别名：${card.aliases.join("、")}` : "",
              `- 首次出现：第${card.firstAppearance}章`,
            ].filter(Boolean).join("\n"),
            fields: {
              aliases: card.aliases,
              role: card.role,
              firstAppearance: card.firstAppearance,
              source: "book.dissect",
            },
            now,
          }, staged, rejectedCandidates);
        }
      }

      if (want.has("all") || want.has("world")) {
        for (const element of knowledge.worldElements) {
          const category = WORLD_CATEGORY_MAP[element.category] ?? "world-model";
          const kind = (category === "locations" || category === "factions" || category === "power-system" || category === "rules" || category === "props" || category === "world-model"
            ? category
            : "world-model") as DissectionStagingKind;
          if (!shouldStageKind(purpose, kind)) continue;
          const existing = existingLookups(storage, bookId, category);
          const excerpt = element.description;
          const chapterNumber = element.sourceChapters[0] ?? range.from;
          tryStage(storage, {
            bookId,
            kind,
            category,
            proposedTitle: element.name,
            sourceRefs: sourceRefs(chapterNumber, excerpt),
            classificationReason: `拆书抽取世界要素（${element.category}）`,
            confidence: 0.4,
            duplicateCandidates: findDuplicateJingweiEntries(existing, { title: element.name, category }),
            contentMd: [
              element.description,
              element.sourceChapters.length > 0 ? `\n出处章节：${element.sourceChapters.join("、")}` : "",
            ].filter(Boolean).join("\n"),
            fields: { worldCategory: element.category, sourceChapters: element.sourceChapters, source: "book.dissect" },
            now,
          }, staged, rejectedCandidates);
        }

        if (shouldStageKind(purpose, "relationships")) {
          const existingRelations = existingLookups(storage, bookId, "relationships");
          for (const edge of knowledge.relationshipGraph) {
            const title = `${edge.source}与${edge.target}`;
            tryStage(storage, {
              bookId,
              kind: "relationships",
              category: "relationships",
              proposedTitle: title,
              sourceRefs: sourceRefs(range.from, edge.description),
              classificationReason: "拆书抽取共现关系，待确认",
              confidence: 0.3,
              duplicateCandidates: findDuplicateJingweiEntries(existingRelations, { title, category: "relationships" }),
              contentMd: edge.description,
              fields: { source: edge.source, target: edge.target, origin: "book.dissect" },
              now,
            }, staged, rejectedCandidates);
          }
        }
      }
      if (staged.length > 0) writtenFiles.push(`dissection_staging × ${staged.length}`);
    };

    try {
      const runInTx = storage.sqlite.transaction(applyStagingWrite);
      runInTx();
    } catch (txError) {
      return {
        ok: false,
        bookId,
        fromChapter: range.from,
        toChapter: range.to,
        applied: false,
        settled,
        draft,
        writtenFiles: [],
        staging: [],
        rejectedCandidates,
        summary: `拆书暂存事务写入失败，数据已完全回滚：${txError instanceof Error ? txError.message : String(txError)}`,
        error: "dissect-transaction-failed",
      };
    }

    try {
      const storyDir = join(input.bookRoot, "story");
      await mkdir(storyDir, { recursive: true });
      await writeFile(
        join(storyDir, "dissect_draft.json"),
        `${JSON.stringify({ bookId, range, purpose, purposeLabel: purposeProfile.label, createdAt, note: "调试快照；权威候选在 dissection_staging", draft, knowledge, staging: staged }, null, 2)}\n`,
        "utf8",
      );
      writtenFiles.push("story/dissect_draft.json（快照）");
    } catch (exportError) {
      writtenFiles.push(`export:warning - 派生导出失败（不影响暂存）：${exportError instanceof Error ? exportError.message : String(exportError)}`);
    }
  }

  const preflight = await handleWritePreflight({
    bookId,
    bookRoot: input.bookRoot,
    storage,
    userDirectives: knowledge.suggestedFocus ?? undefined,
    acceptFocusDefault: true,
  });

  return {
    ok: true,
    bookId,
    fromChapter: range.from,
    toChapter: range.to,
    applied: Boolean(input.apply),
    settled,
    purpose,
    purposeLabel: purposeProfile.label,
    draft,
    knowledge,
    preflight,
    settlementSummary,
    writtenFiles,
    ...(input.apply ? { staging: staged, rejectedCandidates } : {}),
    summary: [
      `按「${purposeProfile.label}」拆解第 ${range.from}-${range.to} 章（有效正文 ${chapters.length} 章）`,
      `角色卡 ${knowledge.characterCards.length} / 设定 ${knowledge.worldElements.length} / 钩子 ${knowledge.openHooks.length} / 摘要 ${knowledge.detailedSummaries.length}`,
      settled ? "动态记忆已结算" : "动态记忆未结算",
      input.apply
        ? `实体已写入经纬草稿 ${staged.length} 条（待确认）；拒绝 ${rejectedCandidates.length} 条脏候选`
        : "仅草案未落盘",
      preflight.ok ? "写前检查就绪" : `写前检查未就绪：${preflight.blockers.map((item) => item.code).join(",") || "unknown"}`,
    ].join("；"),
  };
}
