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
import { NarrativeEventSchema, type NarrativeEvent } from "../engine/narrative-memory/types.js";
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
import type { DiagnosticExplanation } from "./diagnostic-explanation.js";

export type ChapterSettlementOptions = Readonly<{
  storage?: StorageDatabase;
  llmExtractor?: ChapterEventExtractorInput["llmExtractor"];
  now?: () => Date;
  /** Trusted absolute book root for loading book.json narrativeMemory config. */
  bookRoot?: string;
  /** Preloaded config; when omitted and bookRoot is set, loaded from book.json. */
  config?: NarrativeMemoryConfig;
}>;

function idPart(value: string): string {
  return value.trim().replace(/\s+/gu, "-").replace(/[^\p{L}\p{N}_:-]+/gu, "").slice(0, 48) || "value";
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
    extraction = await extractNarrativeEventsFromChapter({
      bookId: input.bookId,
      chapterNumber: input.chapterNumber,
      title: input.title,
      content: input.content,
      currentLedger,
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
  const events: NarrativeEvent[] = [];

  for (const draft of extraction.drafts) {
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
    extracted: extraction.drafts.length,
    autoApplied: applied.appliedEventIds.length,
    pending: applied.pendingEventIds.length + downgradedPendingIds.length,
    highRiskPending: eventResults.filter((event) => event.status === "pending" && event.riskLevel === "high").length,
    warnings,
    events: eventResults,
    idempotency: idempotencyInfo,
    ...(resettled ? { explanation: explainResettled(input, idempotency, persisted.authorDecidedPreserved) } : {}),
  };
}
