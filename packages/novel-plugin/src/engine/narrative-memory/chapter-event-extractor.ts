import { chatCompletion, type LLMClient } from "@vivy1024/novelfork-core";

import { NarrativeEventTypeSchema } from "./types.js";
import type { NarrativeEventDraft } from "./settlement-risk-gate.js";

/** 当前台账中的一条 open fact，注入抽取 prompt 让 LLM 感知已有状态，只抽增量。 */
export type CurrentLedgerFactSnapshot = Readonly<{
  category: string;
  subject: string;
  predicate: string;
  object: string;
}>;

export type ChapterEventExtractorInput = Readonly<{
  bookId: string;
  chapterNumber: number;
  title?: string;
  content: string;
  /** 当前叙事记忆台账的 open fact 快照；用于让 LLM 只抽取相对已有状态的增量变化。 */
  currentLedger?: readonly CurrentLedgerFactSnapshot[];
  llmExtractor?: (input: Readonly<{ bookId: string; chapterNumber: number; title?: string; content: string; currentLedger?: readonly CurrentLedgerFactSnapshot[] }>) => Promise<readonly unknown[]>;
}>;

export type ChapterEventExtractionResult = Readonly<{
  drafts: readonly NarrativeEventDraft[];
  deduped: number;
  warnings: readonly string[];
}>;

function extractJsonArray(text: string): unknown[] {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/iu)?.[1]?.trim();
  const raw = fenced ?? text.slice(text.indexOf("["), text.lastIndexOf("]") + 1);
  if (!raw || !raw.startsWith("[")) return [];
  const parsed = JSON.parse(raw) as unknown;
  return Array.isArray(parsed) ? parsed : [];
}

export function parseLLMNarrativeEventDrafts(content: string): readonly unknown[] {
  try {
    return extractJsonArray(content);
  } catch {
    return [];
  }
}

type ExtractorInput = Readonly<{
  bookId: string;
  chapterNumber: number;
  title?: string;
  content: string;
  currentLedger?: readonly CurrentLedgerFactSnapshot[];
}>;

const EXTRACTOR_SYSTEM_PROMPT = [
  "你是网文小说叙事记忆结算器。只从用户提供的正式章节正文中抽取动态叙事变化。",
  "返回严格 JSON 数组，不要输出解释。每项字段：eventType, subject, predicate, object, evidenceText, confidence, source。",
  "eventType 只能是 character_state_changed, relationship_changed, location_changed, hook_planted, hook_progressed, hook_resolved, world_fact_introduced, timeline_advanced。",
  "evidenceText 必须是章节正文中的原文短摘录，source 固定为 settle。没有证据就不要输出该事件。",
  "不要写入静态 Lore/canon；只提出 NarrativeEvent 草案。",
  "若提供了「当前叙事记忆台账」，只抽取相对台账发生变化或新增的状态；与台账一致、本章未改变的内容不要重复输出。",
  "对状态类变化（修为/位置/关系/情绪等），subject+predicate 标识状态槽位，object 是本章后的新值；同一槽位的新值会由系统自动作废旧值，你只需给出新值。",
  "对伏笔：本章新埋用 hook_planted，已有伏笔被推进用 hook_progressed，被揭晓/回收用 hook_resolved。",
].join("\n");

function formatCurrentLedger(ledger: readonly CurrentLedgerFactSnapshot[]): string {
  if (ledger.length === 0) return "（空）";
  return ledger
    .map((fact) => `- [${fact.category}] ${fact.subject} / ${fact.predicate} / ${fact.object}`)
    .join("\n");
}

function buildExtractorUserPrompt(input: ExtractorInput): string {
  const ledgerBlock = input.currentLedger
    ? `\n\n当前叙事记忆台账（已知的最新状态，仅供判断增量，不要复述）：\n${formatCurrentLedger(input.currentLedger)}`
    : "";
  return `bookId: ${input.bookId}\nchapterNumber: ${input.chapterNumber}\ntitle: ${input.title ?? ""}${ledgerBlock}\n\n正式章节正文：\n${input.content.slice(0, 20_000)}`;
}

export function createLLMChapterEventExtractor(client: LLMClient, model: string): NonNullable<ChapterEventExtractorInput["llmExtractor"]> {
  return async (input) => {
    const response = await chatCompletion(client, model, [
      { role: "system", content: EXTRACTOR_SYSTEM_PROMPT },
      { role: "user", content: buildExtractorUserPrompt(input) },
    ], { temperature: 0.1, maxTokens: 2000 });
    return parseLLMNarrativeEventDrafts(response.content);
  };
}

/**
 * 基于 Runtime host 的 generateText 能力构造抽取器。
 * 管线/handler 层没有 LLMClient，只有 ToolExecutionContext.generateText；
 * 用它接线，避免在 handler 层引入具体 provider 依赖。
 */
export function createRuntimeChapterEventExtractor(
  generateText: (request: {
    messages: ReadonlyArray<{ role: "system" | "user" | "assistant"; content: string }>;
    temperature?: number;
    maxTokens?: number;
  }) => Promise<{ text: string }>,
): NonNullable<ChapterEventExtractorInput["llmExtractor"]> {
  return async (input) => {
    const response = await generateText({
      messages: [
        { role: "system", content: EXTRACTOR_SYSTEM_PROMPT },
        { role: "user", content: buildExtractorUserPrompt(input) },
      ],
      temperature: 0.1,
      maxTokens: 2000,
    });
    return parseLLMNarrativeEventDrafts(response.text);
  };
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function confidence(value: unknown, fallback = 0.82): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

function locationDraft(line: string): NarrativeEventDraft | null {
  const body = line.replace(/^【地点】/u, "").trim();
  const match = body.match(/^(.+?)(?:抵达|来到|进入|到达)(.+)$/u);
  if (!match) return null;
  return {
    eventType: "location_changed",
    subject: match[1]!.trim(),
    predicate: "抵达",
    object: match[2]!.trim(),
    evidenceText: line,
    confidence: 0.88,
    source: "settle",
  };
}

function hookDraft(line: string): NarrativeEventDraft | null {
  const body = line.replace(/^【伏笔】/u, "").trim();
  const match = body.match(/^(.+?)[：:](.+)$/u);
  if (!match) return null;
  return {
    eventType: "hook_planted",
    subject: match[1]!.trim(),
    predicate: "埋设",
    object: match[2]!.trim(),
    evidenceText: line,
    confidence: 0.82,
    source: "settle",
  };
}

function timelineDraft(line: string): NarrativeEventDraft | null {
  const body = line.replace(/^【时间线】/u, "").trim();
  const match = body.match(/^(.+?)[：:](.+)$/u);
  if (!match) return null;
  return {
    eventType: "timeline_advanced",
    subject: "时间线",
    predicate: match[1]!.trim(),
    object: match[2]!.trim(),
    evidenceText: line,
    confidence: 0.88,
    source: "settle",
  };
}

function extractStructuredDrafts(content: string): NarrativeEventDraft[] {
  const drafts: NarrativeEventDraft[] = [];
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) continue;
    const draft = line.startsWith("【地点】")
      ? locationDraft(line)
      : line.startsWith("【伏笔】")
        ? hookDraft(line)
        : line.startsWith("【时间线】")
          ? timelineDraft(line)
          : null;
    if (draft) drafts.push(draft);
  }
  return drafts;
}

function parseUnknownDraft(raw: unknown): NarrativeEventDraft | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const eventType = normalizeText(record.eventType);
  const parsedType = NarrativeEventTypeSchema.safeParse(eventType);
  if (!parsedType.success) return null;
  if (record.source !== "settle") return null;
  return {
    eventType: parsedType.data,
    subject: normalizeText(record.subject),
    predicate: normalizeText(record.predicate),
    object: normalizeText(record.object),
    evidenceText: normalizeText(record.evidenceText),
    confidence: confidence(record.confidence),
    source: "settle",
  };
}

function isValidDraft(draft: NarrativeEventDraft, chapterContent: string): boolean {
  if (!draft.subject.trim() || !draft.predicate.trim() || !draft.object.trim() || !draft.evidenceText.trim() || draft.source !== "settle") return false;
  return chapterContent.includes(draft.evidenceText.trim());
}

function keyOf(draft: NarrativeEventDraft): string {
  return [draft.eventType, draft.subject, draft.predicate, draft.object].map((part) => part.trim()).join("\u0000");
}

function dedupeDrafts(drafts: readonly NarrativeEventDraft[]): { drafts: NarrativeEventDraft[]; deduped: number } {
  const seen = new Set<string>();
  const result: NarrativeEventDraft[] = [];
  let deduped = 0;
  for (const draft of drafts) {
    const key = keyOf(draft);
    if (seen.has(key)) {
      deduped += 1;
      continue;
    }
    seen.add(key);
    result.push(draft);
  }
  return { drafts: result, deduped };
}

export async function extractNarrativeEventsFromChapter(input: ChapterEventExtractorInput): Promise<ChapterEventExtractionResult> {
  const warnings: string[] = [];
  const rawDrafts: NarrativeEventDraft[] = [...extractStructuredDrafts(input.content)];

  if (input.llmExtractor) {
    try {
      const llmDrafts = await input.llmExtractor({ bookId: input.bookId, chapterNumber: input.chapterNumber, title: input.title, content: input.content });
      for (const raw of llmDrafts) {
        const draft = parseUnknownDraft(raw);
        if (draft) rawDrafts.push(draft);
        else warnings.push("丢弃无效事件草案：schema 不匹配。");
      }
    } catch (error) {
      warnings.push(`LLM 抽取失败，已使用规则兜底：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const validDrafts: NarrativeEventDraft[] = [];
  for (const draft of rawDrafts) {
    if (isValidDraft(draft, input.content)) {
      validDrafts.push(draft);
    } else {
      warnings.push("丢弃无效事件草案：缺少 subject/predicate/object/evidenceText，或 evidenceText 不是正文原文摘录。");
    }
  }

  const deduped = dedupeDrafts(validDrafts);
  return { drafts: deduped.drafts, deduped: deduped.deduped, warnings };
}
