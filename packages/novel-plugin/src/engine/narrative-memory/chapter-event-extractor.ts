import { chatCompletion, type LLMClient } from "@vivy1024/novelfork-core";

import { NarrativeEventTypeSchema } from "./types.js";
import type { NarrativeEventDraft } from "./settlement-risk-gate.js";
import { parseCausedBy } from "./causal-resolve.js";
import { formatEntityDictionaryForPrompt, resolveEntity, type EntityDictionary } from "./entity-dictionary.js";
import {
  collectChapterMentions,
  parseMentionedEntityNames,
  type ChapterMention,
} from "./chapter-mention.js";

/** 当前台账中的一条 open fact，注入抽取 prompt 让 LLM 感知已有状态，只抽增量。 */
export type CurrentLedgerFactSnapshot = Readonly<{
  category: string;
  subject: string;
  predicate: string;
  object: string;
}>;

/** 实体字典的传输形态（handler 层构建后传入，extractor 只读）。 */
export type EntityDictionaryInput = EntityDictionary;

export type ChapterEventExtractorInput = Readonly<{
  bookId: string;
  chapterNumber: number;
  title?: string;
  content: string;
  /** 当前叙事记忆台账的 open fact 快照；用于让 LLM 只抽取相对已有状态的增量变化。 */
  currentLedger?: readonly CurrentLedgerFactSnapshot[];
  /**
   * 经纬实体字典（身份链）。提供时：
   * 1. prompt 注入官方实体名单约束 LLM 用名；
   * 2. 抽取结果对 subject/object 归一化为 canonical 名并回填 entryId。
   * 缺省时行为与旧版一致（不做注入与归一化）。
   */
  entityDictionary?: EntityDictionaryInput;
  llmExtractor?: (input: Readonly<{ bookId: string; chapterNumber: number; title?: string; content: string; currentLedger?: readonly CurrentLedgerFactSnapshot[]; entityDictionary?: EntityDictionaryInput }>) => Promise<unknown>;
}>;

export type ChapterEventExtractionResult = Readonly<{
  drafts: readonly NarrativeEventDraft[];
  deduped: number;
  warnings: readonly string[];
  /** 本章全量出场，供共现图使用；与增量事件分列。 */
  mentionedEntities: readonly ChapterMention[];
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

export interface ParsedChapterExtraction {
  readonly events: readonly unknown[];
  readonly mentionedEntities: readonly string[];
}

function extractJsonValue(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/iu)?.[1]?.trim();
  const raw = fenced ?? text.trim();
  const objectStart = raw.indexOf("{");
  const arrayStart = raw.indexOf("[");
  if (objectStart >= 0 && (arrayStart < 0 || objectStart < arrayStart)) {
    return JSON.parse(raw.slice(objectStart, raw.lastIndexOf("}") + 1));
  }
  if (arrayStart >= 0) {
    return JSON.parse(raw.slice(arrayStart, raw.lastIndexOf("]") + 1));
  }
  return null;
}

/** 兼容旧数组与新对象 `{ events, mentionedEntities }`。 */
export function parseLLMChapterExtraction(content: string): ParsedChapterExtraction {
  try {
    const parsed = extractJsonValue(content);
    if (Array.isArray(parsed)) return { events: parsed, mentionedEntities: [] };
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      const events = Array.isArray(record.events) ? record.events : [];
      return { events, mentionedEntities: parseMentionedEntityNames(record.mentionedEntities) };
    }
  } catch {
    // fall through
  }
  return { events: [], mentionedEntities: [] };
}

function unpackExtractorPayload(payload: unknown): { events: readonly unknown[]; mentionedEntities: readonly string[] } {
  if (Array.isArray(payload)) return { events: payload, mentionedEntities: [] };
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const events = Array.isArray(record.events) ? record.events : [];
    return { events, mentionedEntities: parseMentionedEntityNames(record.mentionedEntities) };
  }
  return { events: [], mentionedEntities: [] };
}

const EXTRACTOR_SYSTEM_PROMPT = [
  "你是网文小说叙事记忆结算器。只从用户提供的正式章节正文中抽取动态叙事变化。",
  "返回严格 JSON 对象，不要输出解释。字段：",
  "1. events：数组。每项字段 eventType, subject, predicate, object, evidenceText, confidence, source, causedBy。",
  "2. mentionedEntities：字符串数组。本章出场的全部实体（人物/地点/势力/物品），含未发生状态变化的配角。这一项要全量，与增量事件无关。",
  "eventType 只能是 character_state_changed, relationship_changed, location_changed, hook_planted, hook_progressed, hook_triggered, hook_resolved, world_fact_introduced, timeline_advanced。",
  "evidenceText 必须是章节正文中的原文短摘录，source 固定为 settle。没有证据就不要输出该事件。",
  "causedBy 是可选字符串数组：只填本章或台账里真正导致本事件的前驱。可用同批 events 的 0 起始序号、subject，或 subject|predicate。对不上就省略，禁止猜测。",
  "若用户消息提供了「官方实体名单」：subject、object 与 mentionedEntities 必须优先使用名单中的名字或其列出的称呼；名单中没有的新实体才使用正文原名称。",
  "不要写入静态 Lore/canon；只提出 NarrativeEvent 草案。",
  "若提供了「当前叙事记忆台账」，events 只抽取相对台账发生变化或新增的状态；与台账一致、本章未改变的内容不要重复输出。mentionedEntities 不受此限制。",
  "对人物状态类变化（修为/位置/情绪/伤势等），subject+predicate 标识状态槽位，object 是本章后的新值；同一槽位的新值会由系统自动作废旧值，你只需给出新值。",
  "对关系变化（relationship_changed）：subject 与 object 都只写一方的名字（人物或势力，优先用官方实体名单里的名字），predicate 写两人之间的关系或变化，如「救下」「结为师徒」「反目」「暗中提防」。object 不要写描述句，经过与细节放进 evidenceText。一件事牵涉多人时拆成多条，每条一对。",
  "对伏笔：本章新埋用 hook_planted；已有伏笔被提及/推进但触发条件尚未满足用 hook_progressed；触发条件已出现、该兑现但尚未兑现用 hook_triggered（object 写触发条件）；被揭晓/回收用 hook_resolved。同一条伏笔的后续事件 causedBy 必须指向它更早的 planted/progressed/triggered。",
].join("\n");

function formatCurrentLedger(ledger: readonly CurrentLedgerFactSnapshot[]): string {
  if (ledger.length === 0) return "（空）";
  return ledger
    .map((fact) => `- [${fact.category}] ${fact.subject} / ${fact.predicate} / ${fact.object}`)
    .join("\n");
}

function buildExtractorUserPrompt(input: ChapterEventExtractorInput): string {
  const ledgerBlock = input.currentLedger
    ? `\n\n当前叙事记忆台账（已知的最新状态，仅供判断增量，不要复述）：\n${formatCurrentLedger(input.currentLedger)}`
    : "";
  const entityBlock = formatEntityDictionaryForPrompt(input.entityDictionary)
    ? `\n\n${formatEntityDictionaryForPrompt(input.entityDictionary)}`
    : "";
  return `bookId: ${input.bookId}\nchapterNumber: ${input.chapterNumber}\ntitle: ${input.title ?? ""}${entityBlock}${ledgerBlock}\n\n正式章节正文：\n${input.content.slice(0, 20_000)}`;
}

export function createLLMChapterEventExtractor(client: LLMClient, model: string): NonNullable<ChapterEventExtractorInput["llmExtractor"]> {
  return async (input) => {
    const response = await chatCompletion(client, model, [
      { role: "system", content: EXTRACTOR_SYSTEM_PROMPT },
      { role: "user", content: buildExtractorUserPrompt(input) },
    ], { temperature: 0.1, maxTokens: 2000 });
    return parseLLMChapterExtraction(response.content);
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
    return parseLLMChapterExtraction(response.text);
  };
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function confidence(value: unknown, fallback = 0.82): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

function parseUnknownDraft(raw: unknown): NarrativeEventDraft | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const eventType = normalizeText(record.eventType);
  const parsedType = NarrativeEventTypeSchema.safeParse(eventType);
  if (!parsedType.success) return null;
  if (record.source !== "settle") return null;
  const causedBy = parseCausedBy(record.causedBy);
  return {
    eventType: parsedType.data,
    subject: normalizeText(record.subject),
    predicate: normalizeText(record.predicate),
    object: normalizeText(record.object),
    evidenceText: normalizeText(record.evidenceText),
    confidence: confidence(record.confidence),
    source: "settle",
    ...(causedBy.length > 0 ? { causedBy } : {}),
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

/**
 * 关系事件的对方应是一个名字（关系图按名字连线）。已对上实体字典的一定是名字；
 * 对不上时，过长或带句读、括注的多半是模型写成了描述句，只告警、不丢弃——
 * 关系事件本来就进待审，由作者改成人名或驳回。
 */
function relationObjectIsNotAName(draft: NarrativeEventDraft): boolean {
  if (draft.eventType !== "relationship_changed" || draft.objectEntryId) return false;
  const object = draft.object.trim();
  return object.length > 16 || /[。！？；，：:,;（）()『』「」]/u.test(object);
}

/**
 * 身份链归一化：subject/object 命中实体字典时改写为 canonical 名并回填 entryId。
 * 未命中保持原文——新登场实体、非实体的状态值（"兴奋""重伤"）都不强行映射。
 * relationship_changed / location_changed 的 object 端同样是实体，一并处理。
 */
function normalizeDraftEntities(draft: NarrativeEventDraft, dictionary: EntityDictionary | undefined): NarrativeEventDraft {
  if (!dictionary || dictionary.entries.length === 0) return draft;
  const subjectHit = resolveEntity(dictionary, draft.subject);
  const objectHit = resolveEntity(dictionary, draft.object);
  return {
    ...draft,
    ...(subjectHit ? { subject: subjectHit.entry.canonicalName, subjectEntryId: subjectHit.entry.entryId } : {}),
    ...(objectHit ? { object: objectHit.entry.canonicalName, objectEntryId: objectHit.entry.entryId } : {}),
  };
}

/**
 * 从章节正文抽取叙事事件草案。
 *
 * 抽取只走 LLM：没有可用的 llmExtractor 或 LLM 调用失败时直接抛错，由上层把
 * 结算表达为失败（agent 重试工具调用），绝不静默降级为规则兜底 —— 兜底会以
 * 「抽到 0 条 / 抽偏」的假成功写进结算台账，下回同章幂等跳过，漏抽就再也补不回来。
 */
export async function extractNarrativeEventsFromChapter(input: ChapterEventExtractorInput): Promise<ChapterEventExtractionResult> {
  if (!input.llmExtractor) {
    throw new Error("当前会话没有可用的 LLM 抽取器（generateText 缺失），无法抽取叙事事件。");
  }

  const warnings: string[] = [];
  const rawDrafts: NarrativeEventDraft[] = [];

  const llmPayload = unpackExtractorPayload(await input.llmExtractor({
    bookId: input.bookId,
    chapterNumber: input.chapterNumber,
    title: input.title,
    content: input.content,
    currentLedger: input.currentLedger,
    entityDictionary: input.entityDictionary,
  }));
  for (const raw of llmPayload.events) {
    const draft = parseUnknownDraft(raw);
    if (draft) rawDrafts.push(draft);
    else warnings.push("丢弃无效事件草案：schema 不匹配。");
  }

  const validDrafts: NarrativeEventDraft[] = [];
  for (const draft of rawDrafts) {
    if (isValidDraft(draft, input.content)) {
      const normalized = normalizeDraftEntities(draft, input.entityDictionary);
      validDrafts.push(normalized);
      if (relationObjectIsNotAName(normalized)) {
        warnings.push(`关系事件「${normalized.subject} / ${normalized.predicate}」的对方写成了描述「${normalized.object.slice(0, 30)}」，不是名字，人物关系图连不上这条线；审核时可把对方改成人物名。`);
      }
    } else {
      warnings.push("丢弃无效事件草案：缺少 subject/predicate/object/evidenceText，或 evidenceText 不是正文原文摘录。");
    }
  }

  const deduped = dedupeDrafts(validDrafts);
  const mentionedEntities = collectChapterMentions({
    content: input.content,
    dictionary: input.entityDictionary,
    eventNames: deduped.drafts.flatMap((draft) => [draft.subject, draft.object]),
    llmNames: llmPayload.mentionedEntities,
  });
  return { drafts: deduped.drafts, deduped: deduped.deduped, warnings, mentionedEntities };
}
