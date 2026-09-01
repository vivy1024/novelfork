import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";
import {
  RevisionConflictError,
  commitChapterStateDelta,
  getStorageDatabase,
  type ChapterStateDelta,
} from "@vivy1024/novelfork-core";

import { extractNarrativeEventsFromChapter, type ChapterEventExtractorInput, type ChapterEventExtractionResult } from "../engine/narrative-memory/chapter-event-extractor.js";
import {
  DEFAULT_NARRATIVE_MEMORY_CONFIG,
  loadNarrativeMemoryConfig,
  type NarrativeMemoryConfig,
} from "../engine/narrative-memory/config.js";
import { applyNarrativeEvents } from "../engine/narrative-memory/reducer.js";
import { queryCurrentNarrativeLedger } from "../engine/narrative-memory/ledger.js";
import { ensureNarrativeMemorySchema, insertNarrativeEvent, updateNarrativeEventStatus } from "../engine/narrative-memory/storage.js";
import { buildEntityDictionary } from "../engine/narrative-memory/entity-dictionary.js";
import { reconcileCharacterKernel, pickRelatedRecords } from "../engine/narrative-memory/kernel-reconciler.js";
import { NarrativeEventSchema, type NarrativeEvent } from "../engine/narrative-memory/types.js";
import { foreshadowPhase } from "../engine/narrative-memory/foreshadow-phase.js";
import { classifyOOC } from "../engine/narrative-memory/character-psychology.js";
import { scoreChapterTension, TENSION_UNEVALUATED, type TensionDimensions } from "./chapter-tension-scoring.js";
import {
  decideChapterSettlementIdempotency,
  isTerminalSettlementStatus,
  recordChapterSettlement,
  type ChapterSettlementIdempotencyDecision,
} from "../engine/narrative-memory/settlement-idempotency.js";
import {
  decideSettlementRisk,
  type ChapterSettlementIdempotency,
  type ChapterSettlementInput,
  type ChapterSettlementResult,
  type ChapterSettlementSkipReason,
  type NarrativeEventDraft,
  type SettlementRiskDecision,
} from "../engine/narrative-memory/settlement-risk-gate.js";
import { chapterSummaryKey } from "../engine/jingwei/entry-identity.js";
import { createBookRepository } from "../engine/jingwei/repositories/book-repo.js";
import { getJingweiCategoryAliases, sqlInPlaceholders } from "../engine/jingwei/category-compat.js";
import { createStoryJingweiEntryRepository } from "../engine/jingwei/repositories/entry-repo.js";
import type { DiagnosticExplanation } from "./diagnostic-explanation.js";

export type ChapterSettlementOptions = Readonly<{
  storage?: StorageDatabase;
  llmExtractor?: ChapterEventExtractorInput["llmExtractor"];
  now?: () => Date;
  /** Trusted absolute book root for loading book.json narrativeMemory config. */
  bookRoot?: string;
  /** Preloaded config; when omitted and bookRoot is set, loaded from book.json. */
  config?: NarrativeMemoryConfig;
  /**
   * 角色内核重算用的文本生成能力；与 llmExtractor 同源（Runtime host 的
   * generateText）。缺省时内核重算静默跳过（warn），不阻断结算。
   */
  kernelGenerateText?: (request: {
    messages: ReadonlyArray<{ role: "system" | "user" | "assistant"; content: string }>;
    temperature?: number;
    maxTokens?: number;
  }) => Promise<{ text: string }>;
  /**
   * T2 收敛沙漏分母（BookConfig.targetChapters）。调用方可从 book.json 透传；
   * 缺省时沙漏守卫按 development 跳过（诚实不猜）。
   */
  targetChapters?: number;
}>;

function idPart(value: string): string {
  return value.trim().replace(/\s+/gu, "-").replace(/[^\p{L}\p{N}_:-]+/gu, "").slice(0, 48) || "value";
}

function parseSummaryFields(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function ensureChapterSummarySection(storage: StorageDatabase, bookId: string, now: Date): string {
  const existing = storage.sqlite.prepare<{ id: string }>(`
    SELECT "id"
    FROM "story_jingwei_section"
    WHERE "book_id" = ? AND "key" = 'chapter-summaries' AND "deleted_at" IS NULL
    LIMIT 1
  `).get(bookId);
  if (existing?.id) return existing.id;

  const sectionId = `chapter-summaries:${idPart(bookId)}`;
  try {
    storage.sqlite.prepare(`
      INSERT INTO "story_jingwei_section" (
        "id", "book_id", "key", "name", "description", "order", "enabled", "show_in_sidebar",
        "participates_in_ai", "default_visibility", "fields_json", "builtin_kind", "source_template",
        "created_at", "updated_at", "deleted_at"
      ) VALUES (?, ?, 'chapter-summaries', '章节摘要', '章后自动生成的剧情摘要与张力评分', 90, 1, 0, 1, 'nested', '[]', 'chapter-summaries', NULL, ?, ?, NULL)
    `).run(sectionId, bookId, now.getTime(), now.getTime());
  } catch {
    // 并发结算可能同时创建 section；只要最终能读到即可继续。
    const concurrent = storage.sqlite.prepare<{ id: string }>(`
      SELECT "id"
      FROM "story_jingwei_section"
      WHERE "book_id" = ? AND "key" = 'chapter-summaries' AND "deleted_at" IS NULL
      LIMIT 1
    `).get(bookId);
    if (concurrent?.id) return concurrent.id;
    throw new Error("无法创建 chapter-summaries 经纬分区。");
  }
  return sectionId;
}

/**
 * 章摘要条目标题是否属于指定章节。
 *
 * 两种历史形态都要命中，否则同一章会出现两条摘要（双轨制根因）：
 * - 旧版 agent-write：「第12章摘要：通道授权」
 * - 新版 auto-settle：「第12章」
 */
export function matchesChapterSummaryTitle(title: string, chapterNumber: number): boolean {
  return new RegExp(`^第\\s*${chapterNumber}\\s*章(?:摘要)?(?:$|[：:《])`, "u").test(title);
}

function findChapterSummaryEntryId(storage: StorageDatabase, bookId: string, chapterNumber: number): string | undefined {
  const categories = getJingweiCategoryAliases("chapter-summaries");
  const stableId = `summary:${idPart(bookId)}:${chapterNumber}`;
  const stableKey = chapterSummaryKey(chapterNumber);
  const rows = storage.sqlite.prepare<{ id: string; title: string; fields_json: string | null; entry_key: string | null }>(`
    SELECT "id", "title", "fields_json", "entry_key"
    FROM "story_jingwei_entry"
    WHERE "book_id" = ?
      AND "category" IN (${sqlInPlaceholders(categories)})
      AND "deleted_at" IS NULL
  `).all(bookId, ...categories) as Array<{ id: string; title: string; fields_json: string | null; entry_key: string | null }>;

  const stable = rows.find((row) => row.id === stableId || row.entry_key === stableKey);
  if (stable) return stable.id;
  const byChapter = rows.find((row) => {
    const fields = parseSummaryFields(row.fields_json);
    const value = fields.chapterNumber ?? fields.chapter_number;
    if (typeof value === "number") return value === chapterNumber;
    if (typeof value === "string") return Number(value) === chapterNumber;
    return matchesChapterSummaryTitle(row.title, chapterNumber);
  });
  return byChapter?.id;
}

/** 同章其余重复摘要条目（双轨自愈：upsert 时软删，保证每章只留一条权威摘要）。 */
function findDuplicateChapterSummaryIds(storage: StorageDatabase, bookId: string, chapterNumber: number, keepId: string): string[] {
  const categories = getJingweiCategoryAliases("chapter-summaries");
  const stableKey = chapterSummaryKey(chapterNumber);
  const rows = storage.sqlite.prepare<{ id: string; title: string; fields_json: string | null; entry_key: string | null }>(`
    SELECT "id", "title", "fields_json", "entry_key"
    FROM "story_jingwei_entry"
    WHERE "book_id" = ?
      AND "category" IN (${sqlInPlaceholders(categories)})
      AND "deleted_at" IS NULL
      AND "id" != ?
  `).all(bookId, ...categories, keepId) as Array<{ id: string; title: string; fields_json: string | null; entry_key: string | null }>;

  return rows.filter((row) => {
    if (row.entry_key === stableKey) return true;
    const fields = parseSummaryFields(row.fields_json);
    const value = fields.chapterNumber ?? fields.chapter_number;
    if (typeof value === "number") return value === chapterNumber;
    if (typeof value === "string") return Number(value) === chapterNumber;
    return matchesChapterSummaryTitle(row.title, chapterNumber);
  }).map((row) => row.id);
}

async function upsertChapterSummaryEntry(input: {
  storage: StorageDatabase;
  bookId: string;
  chapterNumber: number;
  title?: string;
  summary: string;
  /** 0-10 综合分；-1 = 已尝试评分但失败（未评估哨兵），缺省 = 从未评过。 */
  tensionScore?: number;
  tensionDims?: TensionDimensions;
  now: Date;
}): Promise<void> {
  const sectionId = ensureChapterSummarySection(input.storage, input.bookId, input.now);
  const entryRepo = createStoryJingweiEntryRepository(input.storage);
  const stableId = `summary:${idPart(input.bookId)}:${input.chapterNumber}`;
  const stableKey = chapterSummaryKey(input.chapterNumber);
  const fields = {
    chapterNumber: input.chapterNumber,
    title: input.title ?? "",
    summary: input.summary,
    ...(input.tensionScore !== undefined ? { tension_score: input.tensionScore } : {}),
    ...(input.tensionDims ? { tension_dims: input.tensionDims } : {}),
  };
  const entryId = findChapterSummaryEntryId(input.storage, input.bookId, input.chapterNumber);
  const common = {
    sectionId,
    title: `第${input.chapterNumber}章`,
    contentMd: input.summary,
    summaryMd: input.summary,
    category: "chapter-summaries",
    fields,
    customFields: fields,
    relatedChapterNumbers: [input.chapterNumber],
    visibilityRule: { type: "nested" as const },
    participatesInAi: true,
    priorityTier: "relevant" as const,
    layer: "dynamic" as const,
    importance: 70,
    summaryL0: input.summary.slice(0, 180),
    lifecycle: "active" as const,
    status: "confirmed" as const,
    source: "auto-settle" as const,
    changedBy: "auto-settle",
    revisionReason: "auto-chapter-summary",
    updatedAt: input.now,
    entryKey: stableKey,
    sourceRefs: input.summary.trim() ? [{ chapterNumber: input.chapterNumber, excerpt: input.summary }] : [],
  };

  if (entryId) {
    const updated = await entryRepo.update(input.bookId, entryId, common);
    if (!updated) throw new Error(`章节摘要条目 ${entryId} 更新后无法读取。`);
  } else {
    await entryRepo.create({
      id: stableId,
      bookId: input.bookId,
      ...common,
      tags: ["chapter-summary", "auto-settle"],
      aliases: [],
      relatedEntryIds: [],
      tokenBudget: null,
      parentId: null,
      sortOrder: input.chapterNumber,
      version: 1,
      createdAt: input.now,
    });
  }

  // 双轨自愈：同章若残留旧版「第N章摘要：…」等重复条目，软删除，保证每章只留一条权威摘要。
  const survivorId = entryId ?? stableId;
  for (const duplicateId of findDuplicateChapterSummaryIds(input.storage, input.bookId, input.chapterNumber, survivorId)) {
    await entryRepo.softDelete(input.bookId, duplicateId, input.now);
  }
}

function eventId(input: ChapterSettlementInput, draft: NarrativeEventDraft): string {
  return [
    "chapter-settle",
    input.bookId,
    String(input.chapterNumber),
    draft.eventType,
    idPart(draft.subject),
    idPart(draft.predicate),
    idPart(draft.object),
  ].join(":");
}

function materializeEvent(input: ChapterSettlementInput, draft: NarrativeEventDraft, decision: SettlementRiskDecision, now: Date): NarrativeEvent {
  const status = decision.decision === "auto_apply" ? "applied" : "pending";
  const createdAt = (input.confirmedAt ? new Date(input.confirmedAt) : now).toISOString();
  return NarrativeEventSchema.parse({
    id: eventId(input, draft),
    bookId: input.bookId,
    chapterNumber: input.chapterNumber,
    eventType: draft.eventType,
    subject: draft.subject,
    predicate: draft.predicate,
    object: draft.object,
    evidenceText: draft.evidenceText,
    confidence: draft.confidence,
    source: "settle",
    status,
    riskLevel: decision.riskLevel,
    ...(draft.subjectEntryId ? { subjectEntryId: draft.subjectEntryId } : {}),
    ...(draft.objectEntryId ? { objectEntryId: draft.objectEntryId } : {}),
    createdAt,
    appliedAt: status === "applied" ? createdAt : undefined,
  });
}

function readExistingEvent(storage: StorageDatabase, id: string): NarrativeEvent | undefined {
  const row = storage.sqlite.prepare<Record<string, unknown>>(`
    SELECT
      id,
      book_id AS bookId,
      chapter_number AS chapterNumber,
      event_type AS eventType,
      subject,
      predicate,
      object,
      evidence_text AS evidenceText,
      confidence,
      source,
      status,
      risk_level AS riskLevel,
      created_at AS createdAt,
      applied_at AS appliedAt
    FROM narrative_event
    WHERE id = ?
  `).get(id);
  if (!row) return undefined;
  return NarrativeEventSchema.parse({ ...row, appliedAt: row.appliedAt ?? undefined });
}

type PersistedSettlementEvents = Readonly<{
  /** 需要走归约的事件（新插入的，或复用但尚未被作者裁决的）。 */
  reducible: readonly NarrativeEvent[];
  /** 本次涉及的全部事件（含被作者裁决保护、未再归约的）。 */
  all: readonly NarrativeEvent[];
  /** 因作者已裁决（applied/rejected）而未再归约的事件数。 */
  authorDecidedPreserved: number;
}>;

/**
 * 事件落库。事件 id 由 (bookId, chapterNumber, tuple) 决定，所以插入冲突意味着
 * 「这条事件之前结算过」。此时不重复写，改为复用既有行；若既有行已是 applied/rejected
 * （作者裁决过），进一步把它排除在归约之外——作者的裁决是终态，不能被重结算翻回去。
 */
function persistSettlementEvents(storage: StorageDatabase, events: readonly NarrativeEvent[], warnings: string[]): PersistedSettlementEvents {
  const reducible: NarrativeEvent[] = [];
  const all: NarrativeEvent[] = [];
  let authorDecidedPreserved = 0;

  for (const event of events) {
    try {
      const inserted = insertNarrativeEvent(storage, event);
      reducible.push(inserted);
      all.push(inserted);
      continue;
    } catch (error) {
      const existing = readExistingEvent(storage, event.id);
      if (!existing) {
        warnings.push(`事件 ${event.id} 写入失败：${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      all.push(existing);
      if (isTerminalSettlementStatus(existing.status)) {
        authorDecidedPreserved += 1;
        warnings.push(`事件 ${event.id} 已由作者裁决为 ${existing.status}，本次重结算保留原裁决，不重新处理。`);
      } else {
        reducible.push(existing);
        warnings.push(`事件 ${event.id} 已存在（${existing.status}），复用既有待审记录，不重复入队。`);
      }
    }
  }

  return { reducible, all, authorDecidedPreserved };
}

function skipped(
  input: ChapterSettlementInput,
  warning: string,
  extras: Readonly<{
    skipReason: ChapterSettlementSkipReason;
    explanation?: DiagnosticExplanation;
    idempotency?: ChapterSettlementIdempotency;
  }>,
): ChapterSettlementResult {
  return {
    status: "skipped",
    bookId: input.bookId,
    chapterId: input.chapterId,
    chapterNumber: input.chapterNumber,
    extracted: 0,
    autoApplied: 0,
    pending: 0,
    highRiskPending: 0,
    warnings: [warning],
    events: [],
    skipReason: extras.skipReason,
    ...(extras.explanation ? { explanation: extras.explanation } : {}),
    ...(extras.idempotency ? { idempotency: extras.idempotency } : {}),
  };
}

/**
 * 抽取失败：不写任何事件、不登记结算台账。
 *
 * 关键：绝不能走到 recordChapterSettlement —— 一旦把「没抽成」登记成「已结算」，
 * 幂等门会把同章后续调用全部跳过，漏抽的章节就再也补不回来。失败必须保持可重试。
 */
function failed(
  input: ChapterSettlementInput,
  error: string,
  explanation: DiagnosticExplanation,
): ChapterSettlementResult {
  return {
    status: "failed",
    bookId: input.bookId,
    chapterId: input.chapterId,
    chapterNumber: input.chapterNumber,
    extracted: 0,
    autoApplied: 0,
    pending: 0,
    highRiskPending: 0,
    warnings: [explanation.whatHappened],
    events: [],
    error,
    explanation,
  };
}

/** 幂等跳过的人话解释：明确「已结算过、本次跳过」，既不假装成功也不报成错误。 */
function explainAlreadySettled(
  input: ChapterSettlementInput,
  decision: ChapterSettlementIdempotencyDecision,
): DiagnosticExplanation {
  const counts = decision.existingEventCounts;
  const settledAt = decision.record?.settledAt ?? "此前";
  const breakdown = counts
    ? `已沉淀 ${counts.applied} 条、待审 ${counts.pending} 条、已驳回 ${counts.rejected} 条`
    : "既有结算结果保持不变";
  return {
    whatHappened: `第${input.chapterNumber}章的正文与上一次结算（${settledAt}）时完全一致，本次没有重新抽取，也没有写入任何叙事记忆。${breakdown}。`,
    whyItMatters: "重复结算同一份正文只会反复写入同样的事实、反复往待审队列塞同样的条目。跳过是为了让台账与待审队列保持干净，这不是失败。",
    suggestedAction: "不用处理，这一章的记忆已经是最新。若正文确实改过，先保存再结算；若上次漏记了，结算时勾选强制重算；待审条目去叙事记忆面板处理。",
  };
}

/** 改写后重结算的人话解释：告诉作者为什么这次没有被幂等挡住。 */
function explainResettled(
  input: ChapterSettlementInput,
  decision: ChapterSettlementIdempotencyDecision,
  authorDecidedPreserved: number,
): DiagnosticExplanation {
  const preserved = authorDecidedPreserved > 0
    ? `你此前批准/驳回过的 ${authorDecidedPreserved} 条事件保留原裁决，未被本次结算改动。`
    : "你手工纠正过的事实不会被本次结算覆盖。";
  return {
    whatHappened: decision.forced
      ? `第${input.chapterNumber}章正文没变，但这次按你的要求强制重新结算。`
      : `第${input.chapterNumber}章正文自上次结算后已被改写，因此本次重新抽取了叙事事件。`,
    whyItMatters: "内容变了，旧的结算结论就不再对应当前正文；这种重结算是正常的，不属于重复结算。",
    suggestedAction: `${preserved}检查新增的待审条目后批准或驳回即可。`,
  };
}

export async function settleConfirmedChapter(input: ChapterSettlementInput, options: ChapterSettlementOptions = {}): Promise<ChapterSettlementResult> {
  const storage = options.storage ?? getStorageDatabase();
  ensureNarrativeMemorySchema(storage);

  let config = options.config ?? DEFAULT_NARRATIVE_MEMORY_CONFIG;
  if (!options.config && options.bookRoot?.trim()) {
    try {
      config = await loadNarrativeMemoryConfig(input.bookId, options.bookRoot);
    } catch {
      config = DEFAULT_NARRATIVE_MEMORY_CONFIG;
    }
  }

  if (!config.settlement.enabled) {
    return skipped(input, "叙事记忆结算已在本书配置中关闭。", { skipReason: "settlement-disabled" });
  }

  if (!input.content.trim()) {
    return skipped(input, "章节正文是空的，跳过了本章记忆结算。", { skipReason: "empty-content" });
  }

  // P5 幂等门：必须在任何抽取之前判定。
  // 抽取走 LLM，同一正文两次输出未必一致；若先抽再去重，第二次会产出对不上去重键的
  // 「新」事件，重复写入照旧发生。所以这里是前置门，不是事后清理。
  const idempotency = decideChapterSettlementIdempotency(storage, {
    bookId: input.bookId,
    chapterNumber: input.chapterNumber,
    content: input.content,
    ...(input.force ? { force: true } : {}),
  });

  if (idempotency.decision === "skip") {
    return skipped(
      input,
      `第${input.chapterNumber}章正文未变化，已结算过（第 ${idempotency.record?.settlementCount ?? 1} 次），本次跳过，未重复写入。`,
      {
        skipReason: "already-settled",
        explanation: explainAlreadySettled(input, idempotency),
        idempotency: {
          outcome: "skipped-duplicate",
          contentFingerprint: idempotency.fingerprint,
          settlementCount: idempotency.record?.settlementCount ?? 1,
          ...(idempotency.record?.settledAt ? { previouslySettledAt: idempotency.record.settledAt } : {}),
        },
      },
    );
  }

  // 抽取前取出当前台账 open fact 快照，注入 LLM prompt 让其只抽增量、感知伏笔进度。
  const currentLedger = queryCurrentNarrativeLedger(storage, {
    bookId: input.bookId,
    limit: 120,
  }).items.map((fact) => ({
    category: fact.category,
    subject: fact.subject,
    predicate: fact.predicate,
    object: fact.object,
  }));

  // 作者在 book.json 里明确关闭了 LLM 抽取：不抽也不假装成功，跳过并说明。
  if (!config.settlement.useLlmExtraction) {
    return skipped(
      input,
      "这本书关掉了从正文自动抽记忆，本次没有结算。",
      {
        skipReason: "extraction-disabled",
        explanation: {
          whatHappened: `第${input.chapterNumber}章没有结算：这本书关掉了从正文自动抽记忆。`,
          whyItMatters: "关掉之后不会凭空记假账，所以本章记忆还是空的。",
          suggestedAction: "若需要跟上记忆，打开写作设置里的叙事记忆自动抽取，再让叙述者结算这一章。",
        },
      },
    );
  }

  if (!options.llmExtractor) {
    return failed(
      input,
      "settlement-extractor-unavailable",
      {
        whatHappened: `第${input.chapterNumber}章的记忆没写上：当前会话没法从正文里读出人物位置、伏笔这些事。`,
        whyItMatters: "没有抽出来就没法记下本章发生了什么；这次没有写入任何记忆，也没有当成已经结算。",
        suggestedAction: "确认模型可用后，让叙述者再结算这一章。正文已经保存，不会丢稿。",
      },
    );
  }

  let extraction: ChapterEventExtractionResult;
  try {
    // 实体身份链：结算前从经纬构建实体字典，注入抽取 prompt 并在写入端归一化。
    // 字典为空（书还没有实体条目/表未建）时 extractNarrativeEventsFromChapter 内部按无字典降级。
    const entityDictionary = buildEntityDictionary(storage, input.bookId);
    extraction = await extractNarrativeEventsFromChapter({
      bookId: input.bookId,
      chapterNumber: input.chapterNumber,
      title: input.title,
      content: input.content,
      currentLedger,
      entityDictionary,
      llmExtractor: options.llmExtractor,
    });
  } catch {
    return failed(
      input,
      "settlement-extraction-failed",
      {
        whatHappened: `第${input.chapterNumber}章的记忆没抽出来：从正文里读人物位置、伏笔这些事时中断了。`,
        whyItMatters: "抽失败时如果继续结算，只能记空账或记错。这次没有写入任何记忆，也没有当成已经结算。",
        suggestedAction: "让叙述者再结算这一章即可。正文已经保存，不会丢稿。",
      },
    );
  }
  const warnings = [...extraction.warnings];
  let draftPool = extraction.drafts;
  /** T4 证据链：逐草案决策记录（含沙漏拦截），结算成功后随指纹落盘。 */
  const evidenceDrafts: Array<{
    eventType: string;
    subject: string;
    predicate: string;
    object: string;
    confidence?: number;
    riskLevel?: string;
    outcome: string;
    reason?: string;
    eventId?: string;
  }> = [];
  let sandboxIntercepted = 0;

  // T2 收敛沙漏：CONVERGENCE（≥75%）禁开新坑——hook_planted 草稿直接丢弃并告警；
  // FINALE（≥95%）列出全部未回收伏笔，提示作者集中安排回收（只提示不代收）。
  // 分母 targetChapters 由调用方从 BookConfig 透传；缺省时诚实跳过守卫。
  try {
    if (options.targetChapters !== undefined && options.targetChapters > 0) {
      const phase = foreshadowPhase(input.chapterNumber, options.targetChapters);
      if (phase !== "development") {
        const plantedDrafts = draftPool.filter((draft) => draft.eventType === "hook_planted");
        if (plantedDrafts.length > 0) {
          const pct = Math.round((input.chapterNumber / Math.max(1, options.targetChapters)) * 100);
          draftPool = draftPool.filter((draft) => draft.eventType !== "hook_planted");
          sandboxIntercepted += plantedDrafts.length;
          for (const draft of plantedDrafts) {
            evidenceDrafts.push({
              eventType: draft.eventType,
              subject: draft.subject,
              predicate: draft.predicate,
              object: draft.object,
              ...(draft.confidence !== undefined ? { confidence: draft.confidence } : {}),
              outcome: "intercepted-by-convergence",
              reason: `收敛沙漏拦截（进度 ${pct}%）`,
            });
          }
          warnings.push(
            `收敛沙漏：叙事已进入${phase === "finale" ? "终局" : "收敛"}期（进度 ${pct}%），已拦截 ${plantedDrafts.length} 条新伏笔草案——请优先回收既有坑。`,
          );
        }
        if (phase === "finale") {
          const openStatuses = ["已埋设", "部分揭示", "唤醒中"];
          const categories = getJingweiCategoryAliases("foreshadowing");
          const openRows = storage.sqlite.prepare<{ title: string; fields_json: string | null }>(`
            SELECT title, fields_json FROM story_jingwei_entry
            WHERE book_id = ? AND category IN (${sqlInPlaceholders(categories)}) AND deleted_at IS NULL
          `).all(input.bookId, ...categories) as Array<{ title: string; fields_json: string | null }>;
          const openTitles = openRows
            .filter((row) => {
              try {
                const fields = JSON.parse(row.fields_json ?? "{}") as { status?: unknown };
                return !fields.status || openStatuses.includes(String(fields.status));
              } catch {
                return true;
              }
            })
            .map((row) => row.title);
          if (openTitles.length > 0) {
            warnings.push(`终局回收提醒：仍有 ${openTitles.length} 个未回收伏笔——${openTitles.slice(0, 8).join("、")}${openTitles.length > 8 ? " 等" : ""}。`);
          }
        }
      }
    }
  } catch (error) {
    warnings.push(`收敛沙漏检查失败（不影响结算主体）：${error instanceof Error ? error.message : String(error)}`);
  }

  const events: NarrativeEvent[] = [];

  for (const draft of draftPool) {
    const decision = decideSettlementRisk(draft, {
      minConfidence: config.settlement.minConfidence,
      autoApplyLowRisk: config.settlement.autoApplyLowRisk,
      autoApplyMediumRisk: config.settlement.autoApplyMediumRisk,
      highRiskAlwaysPending: config.settlement.highRiskAlwaysPending,
    });
    if (decision.decision === "reject") {
      warnings.push(`丢弃事件草案：${decision.reason}`);
      evidenceDrafts.push({
        eventType: draft.eventType,
        subject: draft.subject,
        predicate: draft.predicate,
        object: draft.object,
        ...(draft.confidence !== undefined ? { confidence: draft.confidence } : {}),
        outcome: "rejected",
        reason: decision.reason,
      });
      continue;
    }
    const event = materializeEvent(input, draft, decision, options.now?.() ?? new Date());
    evidenceDrafts.push({
      eventType: draft.eventType,
      subject: draft.subject,
      predicate: draft.predicate,
      object: draft.object,
      ...(draft.confidence !== undefined ? { confidence: draft.confidence } : {}),
      ...(decision.riskLevel ? { riskLevel: decision.riskLevel } : {}),
      outcome: decision.decision === "auto_apply" ? "auto-apply" : "pending-review",
      eventId: event.id,
    });
    events.push(event);
  }

  const settledAt = (input.confirmedAt ? new Date(input.confirmedAt) : (options.now?.() ?? new Date())).toISOString();
  const chapterStateDelta: ChapterStateDelta = {
    chapterNumber: input.chapterNumber,
    origin: `settle:${idempotency.fingerprint}:${idempotency.record ? idempotency.record.settlementCount + 1 : 1}`,
    ...(input.title ? { title: input.title } : {}),
    characters: events
      .filter((event) => event.eventType === "character_state_changed")
      .map((event) => ({
        characterId: event.subject,
        currentState: event.object,
        knowledge: [],
      })),
    relationships: events
      .filter((event) => event.eventType === "relationship_changed")
      .map((event) => ({
        source: event.subject,
        target: event.object,
        relationType: event.predicate,
        sentiment: "neutral" as const,
        status: "evolving" as const,
        description: event.evidenceText,
      })),
    hooks: events.flatMap((event) => {
      if (event.eventType !== "hook_planted" && event.eventType !== "hook_progressed" && event.eventType !== "hook_resolved") {
        return [];
      }
      return [{
        hookId: event.subject,
        action: event.eventType === "hook_planted" ? "upsert" as const : event.eventType === "hook_resolved" ? "resolve" as const : "mention" as const,
        type: event.predicate,
        status: event.eventType === "hook_resolved" ? "resolved" as const : event.eventType === "hook_planted" ? "open" as const : "progressing" as const,
        expectedPayoff: event.object,
        notes: event.evidenceText || event.object,
      }];
    }),
    ...(events.find((event) => event.eventType === "timeline_advanced")
      ? {
        timeline: {
          chapter: input.chapterNumber,
          storyTime: events.find((event) => event.eventType === "timeline_advanced")!.object,
          label: events.find((event) => event.eventType === "timeline_advanced")!.predicate,
          durationFromPrev: "",
        },
      }
      : {}),
    commitments: [],
    resources: [],
    knowledge: [],
    notes: warnings.slice(0, 8),
  };
  let commit: {
    readonly persisted: PersistedSettlementEvents;
    readonly applied: ReturnType<typeof applyNarrativeEvents>;
    readonly eventResults: NarrativeEvent[];
    readonly downgradedPendingIds: string[];
    readonly record: ReturnType<typeof recordChapterSettlement>;
    readonly stateRevision: number;
    readonly stateFingerprint: string;
  };
  try {
    const committed = commitChapterStateDelta(storage, {
      bookId: input.bookId,
      delta: chapterStateDelta,
      ...(typeof input.expectedStateRevision === "number" ? { expectedStateRevision: input.expectedStateRevision } : {}),
      now: () => Date.parse(settledAt) || Date.now(),
      project: () => {
        const persisted = persistSettlementEvents(storage, events, warnings);
        const eventResults = [...persisted.all];

        const applied = applyNarrativeEvents(storage, input.bookId, persisted.reducible, {
          closeSupersededFacts: config.ledger.closeSupersededFacts,
        });
        if (applied.failedEvents.length > 0) {
          const details = applied.failedEvents
            .map((failed) => `${failed.id}: ${failed.error}`)
            .join("；");
          // reducer 已捕获底层写入异常，但章后结算不能把“事实未写成”的结果
          // 当成 pending 后登记为已结算；抛出后由外层 SQLite 事务整体回滚，保留可重试性。
          throw new Error(`narrative-reducer-failed: ${details}`);
        }
        const downgradedPendingIds: string[] = [];

        // 结算真正跑完才登记台账：登记的是「这份正文已被结算」，下一次同内容调用据此跳过。
        const record = recordChapterSettlement(storage, {
          bookId: input.bookId,
          chapterNumber: input.chapterNumber,
          contentFingerprint: idempotency.fingerprint,
          eventIds: eventResults.map((event) => event.id),
          settledAt,
          ...(idempotency.record ? { previousRecord: idempotency.record } : {}),
        });

        // T4 证据链与事件、事实、结算台账同事务提交，避免留下半套记忆。
        const appliedById = new Map(eventResults.map((event) => [event.id, event.status] as const));
        const artifact = {
          chapterNumber: input.chapterNumber,
          chapterTitle: input.title ?? null,
          settledAt,
          sandboxIntercepted,
          drafts: evidenceDrafts.map((entry) => {
            const eventStatus = entry.eventId ? appliedById.get(entry.eventId) : undefined;
            return {
              ...entry,
              ...(eventStatus ? { eventStatus } : {}),
            };
          }),
        };
        storage.sqlite.prepare(`
          INSERT OR REPLACE INTO narrative_settlement_artifact
            (book_id, chapter_number, content_fingerprint, artifact_json, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(
          input.bookId,
          input.chapterNumber,
          idempotency.fingerprint,
          JSON.stringify(artifact),
          settledAt,
        );

        return { persisted, applied, eventResults, downgradedPendingIds, record };
      },
    });
    if (committed.idempotent || !committed.projection) {
      throw new Error("chapter-state-delta-replayed-without-projection");
    }
    commit = {
      ...committed.projection,
      stateRevision: committed.resultingRevision,
      stateFingerprint: committed.fingerprint,
    };
  } catch (error) {
    if (error instanceof RevisionConflictError) {
      return failed(
        input,
        "state-revision-conflict",
        {
          whatHappened: `第${input.chapterNumber}章的记忆没写上：这本书的故事状态刚被另一次结算或手工修订改过。`,
          whyItMatters: "强行覆盖会丢掉刚才那次改动，人物位置、伏笔或修为可能对不上。正文已经保存，不会丢稿。",
          suggestedAction: "直接再结算一次这一章即可，系统会按最新状态接着写；不要手工填版本号。",
        },
      );
    }
    return failed(
      input,
      "settlement-commit-failed",
      {
        whatHappened: `第${input.chapterNumber}章的记忆没写上，已经整体回滚，没有留下半成品。`,
        whyItMatters: "人物位置、伏笔和结算记录必须一次写完；只写一半会对不上。正文已经保存，不会丢稿。",
        suggestedAction: "让叙述者再结算这一章即可。这次没有记成已结算，可以安全重试。",
      },
    );
  }

  const { persisted, applied, eventResults, downgradedPendingIds, record, stateRevision, stateFingerprint } = commit;

  // 角色内核重算（CharacterKernelConfig.enabled 时才生效）。
  // 失败只 warn 不阻断：内核是增强信息，结算主体（facts/events）已成功落库。
  if (config.characterKernel.enabled) {
    if (!options.kernelGenerateText) {
      warnings.push("角色内核已启用，但当前会话没法重算角色状态，本章先跳过。");
    } else {
      const chapterCharacters = new Set<string>();
      for (const event of eventResults) {
        chapterCharacters.add(event.subject);
        chapterCharacters.add(event.object);
      }
      for (const character of chapterCharacters) {
        if (!character.trim()) continue;
        try {
          const result = await reconcileCharacterKernel({
            storage,
            bookId: input.bookId,
            chapterNumber: input.chapterNumber,
            characterId: character,
            config: config.characterKernel,
            chapterExcerpt: input.content,
            relatedRecords: pickRelatedRecords(eventResults, character),
            generateText: options.kernelGenerateText,
            ...(options.now ? { now: options.now } : {}),
          });
          if (!result.ok && result.reason === "llm-failed") {
            warnings.push(`角色「${character}」的状态没能重算出来，本章先跳过。`);
          } else if (!result.ok && result.reason === "parse-failed") {
            warnings.push(`角色「${character}」内核重算输出无法解析：${result.error ?? "unknown"}`);
          } else if (result.ok) {
            // T5 OOC 三分类：内核重算成功后检查行为是否偏离心理内核。
            const oocResult = classifyOOC({
              scars: [],
              motivations: [],
              behaviorSummary: input.content.slice(0, 500),
              currentChapter: input.chapterNumber,
            });
            if (oocResult === "ooc") {
              warnings.push(`OOC 预警：角色「${character}」本章行为缺乏心理支撑（无活跃伤痕或高执念驱动），建议复查。`);
            }
            // breakout（合理偏离/高光）不告警——那是好故事。
          }
        } catch (error) {
          warnings.push(`角色「${character}」内核重算异常：${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  }

  // 章级摘要自生产（闭环灵魂）：结算完成后用轻量 LLM 调用生成 50-100 字剧情摘要，
  // 写入经纬 chapter-summaries 类目。下一章写前的 recent-summary 通道会自动召回——
  // 形成「写→结算→摘要→喂下章」的自进化环。
  // T1 张力评分与摘要解耦为第二个独立调用（墨枢方案）：模型经常在混合契约里丢掉
  // tensionScore 导致断流；独立小调用 + 容错解析 + -1 未评估哨兵根治该问题。
  // 失败只 warn 不阻断：摘要是增强信息，结算主体（facts/events）已成功落库。
  if (config.settlement.autoChapterSummary === false) {
    // 作者显式关闭时不调用 LLM，也不产生额外告警。
  } else if (!options.kernelGenerateText) {
    warnings.push("本章自动摘要已启用，但当前会话没法生成摘要，先跳过。");
  } else {
    try {
      const summaryResponse = await options.kernelGenerateText({
        messages: [
          {
            role: "system",
            content: [
              "你是网文章节摘要器。阅读章节正文，输出严格 JSON（不要解释、不要代码块围栏）：",
              '{"summary":"50-100字的剧情要点总结，涵盖关键人物/事件/结果"}',
              "summary 必须是独立可读的一段话。不要输出张力评分——评分由独立的评估器负责。",
            ].join("\n"),
          },
          { role: "user", content: `第${input.chapterNumber}章${input.title ? `《${input.title}》` : ""}正文：\n${input.content.slice(0, 3000)}` },
        ],
        temperature: 0.2,
        maxTokens: 300,
      });
      let summaryText = "";
      try {
        const fenced = summaryResponse.text.match(/```(?:json)?\s*([\s\S]*?)```/iu)?.[1]?.trim();
        const text = fenced ?? summaryResponse.text.trim();
        const start = text.indexOf("{");
        const end = text.lastIndexOf("}");
        const raw = start >= 0 && end > start ? text.slice(start, end + 1) : text;
        const parsed = JSON.parse(raw) as { summary?: unknown };
        if (typeof parsed.summary === "string" && parsed.summary.trim()) summaryText = parsed.summary.trim();
      } catch {
        // JSON 解析失败：只把原始文本当摘要使用。
        if (summaryResponse.text.trim()) summaryText = summaryResponse.text.trim().slice(0, 200);
      }
      if (!summaryText) {
        warnings.push("本章自动摘要生成结果为空，已跳过写入（张力评分随之跳过）。");
      } else {
        // T1 独立张力评分：前章基线取上一章权威摘要的 tension_score（负值哨兵不算基线）。
        const previousEntryId = findChapterSummaryEntryId(storage, input.bookId, input.chapterNumber - 1);
        let previousScore100: number | undefined;
        if (previousEntryId) {
          const row = storage.sqlite.prepare<{ fields_json: string | null }>(
            "SELECT fields_json FROM story_jingwei_entry WHERE id = ? AND deleted_at IS NULL",
          ).get(previousEntryId);
          const prevScore = parseSummaryFields(row?.fields_json).tension_score;
          if (typeof prevScore === "number" && prevScore >= 0) previousScore100 = Math.round(prevScore * 10);
        }

        const scored = await scoreChapterTension(
          {
            chapterNumber: input.chapterNumber,
            ...(input.title ? { title: input.title } : {}),
            content: input.content,
            ...(previousScore100 !== undefined ? { previousScore100 } : {}),
          },
          options.kernelGenerateText,
        );

        if (scored.status === "evaluated") {
          await upsertChapterSummaryEntry({
            storage,
            bookId: input.bookId,
            chapterNumber: input.chapterNumber,
            title: input.title,
            summary: summaryText,
            tensionScore: scored.composite,
            tensionDims: scored.dims,
            now: options.now?.() ?? new Date(),
          });
        } else {
          // -1 哨兵持久化：前端据此区分「低分」与「评分失败」，绝不伪造中性分。
          await upsertChapterSummaryEntry({
            storage,
            bookId: input.bookId,
            chapterNumber: input.chapterNumber,
            title: input.title,
            summary: summaryText,
            tensionScore: TENSION_UNEVALUATED,
            now: options.now?.() ?? new Date(),
          });
          warnings.push(`本章张力评分失败，已标记未评估（${TENSION_UNEVALUATED}）：${scored.reason}`);
        }
      }
    } catch (error) {
      warnings.push(`本章自动摘要生成失败（不影响结算主体）：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const resettled = idempotency.decision === "resettle";
  const idempotencyInfo: ChapterSettlementIdempotency = {
    outcome: resettled ? "resettled" : "first",
    contentFingerprint: idempotency.fingerprint,
    settlementCount: record.settlementCount,
    ...(idempotency.record?.settledAt ? { previouslySettledAt: idempotency.record.settledAt } : {}),
    ...(resettled && idempotency.previousFingerprint ? { previousContentFingerprint: idempotency.previousFingerprint } : {}),
    ...(idempotency.forced ? { forced: true } : {}),
    ...(resettled ? { authorDecidedPreserved: persisted.authorDecidedPreserved } : {}),
  };

  return {
    status: "completed",
    bookId: input.bookId,
    chapterId: input.chapterId,
    chapterNumber: input.chapterNumber,
    extracted: draftPool.length,
    autoApplied: applied.appliedEventIds.length,
    pending: applied.pendingEventIds.length + downgradedPendingIds.length,
    highRiskPending: eventResults.filter((event) => event.status === "pending" && event.riskLevel === "high").length,
    warnings,
    events: eventResults,
    idempotency: idempotencyInfo,
    stateRevision,
    stateFingerprint,
    ...(resettled ? { explanation: explainResettled(input, idempotency, persisted.authorDecidedPreserved) } : {}),
  };
}
