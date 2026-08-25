import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { getStorageDatabase } from "@vivy1024/novelfork-core";

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
  const rows = storage.sqlite.prepare<{ id: string; title: string; fields_json: string | null }>(`
    SELECT "id", "title", "fields_json"
    FROM "story_jingwei_entry"
    WHERE "book_id" = ?
      AND "category" IN (${sqlInPlaceholders(categories)})
      AND "deleted_at" IS NULL
  `).all(bookId, ...categories) as Array<{ id: string; title: string; fields_json: string | null }>;

  const stable = rows.find((row) => row.id === stableId);
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
  const rows = storage.sqlite.prepare<{ id: string; title: string; fields_json: string | null }>(`
    SELECT "id", "title", "fields_json"
    FROM "story_jingwei_entry"
    WHERE "book_id" = ?
      AND "category" IN (${sqlInPlaceholders(categories)})
      AND "deleted_at" IS NULL
      AND "id" != ?
  `).all(bookId, ...categories, keepId) as Array<{ id: string; title: string; fields_json: string | null }>;

  return rows.filter((row) => {
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
    suggestedAction: `无需处理，这一章的记忆已是最新。若正文确实改过请先保存再结算；若上次抽取有遗漏，用 force=true 强制重结算；若要处理待审条目，去叙事记忆面板或 memory.bulk_approve。`,
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
    : "作者手动纠正过的事实（manual）不会被本次结算覆盖。";
  return {
    whatHappened: decision.forced
      ? `第${input.chapterNumber}章正文未变，但本次以 force=true 强制重新结算。`
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
    return skipped(input, "章节正文为空，跳过 Narrative Memory 结算。", { skipReason: "empty-content" });
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
      "本书配置已关闭 LLM 抽取（settlement.useLlmExtraction=false），本次结算未执行。",
      {
        skipReason: "extraction-disabled",
        explanation: {
          whatHappened: `第${input.chapterNumber}章未结算：这本书的叙事记忆配置关闭了 LLM 抽取。`,
          whyItMatters: "没有 LLM 抽取就没有叙事事件来源；静默跳过比假结算更安全，本章记忆不会产生虚假记录。",
          suggestedAction: "若确实需要结算，请在写作设置的叙事记忆配置里重新打开 LLM 抽取，再重新执行结算工具。",
        },
      },
    );
  }

  if (!options.llmExtractor) {
    return failed(
      input,
      "settlement-extractor-unavailable",
      {
        whatHappened: `第${input.chapterNumber}章结算失败：当前会话没有可用的 LLM 抽取器（generateText 缺失）。`,
        whyItMatters: "叙事事件只能由 LLM 从正文抽取，没有抽取器就无法产生可信事实；本次未写入任何记忆，也未登记结算。",
        suggestedAction: "检查会话模型配置后重新调用结算工具即可，本章仍保持未结算状态、可安全重试。",
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
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return failed(
      input,
      "settlement-extraction-failed",
      {
        whatHappened: `第${input.chapterNumber}章结算失败：LLM 事件抽取调用未完成（${detail}）。`,
        whyItMatters: "抽取失败时若继续结算，只能写进空账或错误事实；本次未写入任何记忆，也未登记结算。",
        suggestedAction: "直接重新调用结算工具重试即可（例如 memory.settle_chapter 或 memory.settle_range），本章仍保持未结算状态。",
      },
    );
  }
  const warnings = [...extraction.warnings];
  let draftPool = extraction.drafts;

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
      continue;
    }
    events.push(materializeEvent(input, draft, decision, options.now?.() ?? new Date()));
  }

  const persisted = persistSettlementEvents(storage, events, warnings);
  const eventResults = [...persisted.all];

  const applied = applyNarrativeEvents(storage, input.bookId, persisted.reducible, {
    closeSupersededFacts: config.ledger.closeSupersededFacts,
  });
  const downgradedPendingIds: string[] = [];
  for (const failed of applied.failedEvents) {
    const failedEvent = persisted.reducible.find((event) => event.id === failed.id);
    if (failedEvent?.status === "applied") {
      const updated = updateNarrativeEventStatus(storage, { id: failed.id, status: "pending" });
      if (updated) {
        const index = eventResults.findIndex((event) => event.id === failed.id);
        if (index >= 0) eventResults[index] = updated;
      }
      downgradedPendingIds.push(failed.id);
      warnings.push(`事件 ${failed.id} 自动应用失败，已降级为 pending：${failed.error}`);
    } else {
      warnings.push(`事件 ${failed.id} 处理失败：${failed.error}`);
    }
  }

  // 结算真正跑完才登记台账：登记的是「这份正文已被结算」，下一次同内容调用据此跳过。
  // 事件的 applied/pending/rejected 计数不落盘，读取时从 narrative_event 现算，
  // 避免与作者后续的批准/驳回形成两份互相矛盾的计数。
  const settledAt = (input.confirmedAt ? new Date(input.confirmedAt) : (options.now?.() ?? new Date())).toISOString();
  const record = recordChapterSettlement(storage, {
    bookId: input.bookId,
    chapterNumber: input.chapterNumber,
    contentFingerprint: idempotency.fingerprint,
    eventIds: eventResults.map((event) => event.id),
    settledAt,
    ...(idempotency.record ? { previousRecord: idempotency.record } : {}),
  });

  // 角色内核重算（CharacterKernelConfig.enabled 时才生效）。
  // 失败只 warn 不阻断：内核是增强信息，结算主体（facts/events）已成功落库。
  if (config.characterKernel.enabled) {
    if (!options.kernelGenerateText) {
      warnings.push("角色内核已启用但当前会话没有可用的 generateText，本章内核未重算。");
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
            warnings.push(`角色「${character}」内核重算 LLM 调用失败：${result.error ?? "unknown"}`);
          } else if (!result.ok && result.reason === "parse-failed") {
            warnings.push(`角色「${character}」内核重算输出无法解析：${result.error ?? "unknown"}`);
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
    warnings.push("本章自动摘要已启用但当前会话没有可用的 generateText，已跳过摘要生成。");
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
    ...(resettled ? { explanation: explainResettled(input, idempotency, persisted.authorDecidedPreserved) } : {}),
  };
}
