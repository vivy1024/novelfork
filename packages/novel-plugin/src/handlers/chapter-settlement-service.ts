import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { getStorageDatabase } from "@vivy1024/novelfork-core";

import { extractNarrativeEventsFromChapter, type ChapterEventExtractorInput } from "../engine/narrative-memory/chapter-event-extractor.js";
import {
  DEFAULT_NARRATIVE_MEMORY_CONFIG,
  loadNarrativeMemoryConfig,
  type NarrativeMemoryConfig,
} from "../engine/narrative-memory/config.js";
import { applyNarrativeEvents } from "../engine/narrative-memory/reducer.js";
import { queryCurrentNarrativeLedger } from "../engine/narrative-memory/ledger.js";
import { ensureNarrativeMemorySchema, insertNarrativeEvent, updateNarrativeEventStatus } from "../engine/narrative-memory/storage.js";
import { NarrativeEventSchema, type NarrativeEvent } from "../engine/narrative-memory/types.js";
import { decideSettlementRisk, type ChapterSettlementInput, type ChapterSettlementResult, type NarrativeEventDraft, type SettlementRiskDecision } from "../engine/narrative-memory/settlement-risk-gate.js";

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

function persistSettlementEvents(storage: StorageDatabase, events: readonly NarrativeEvent[], warnings: string[]): NarrativeEvent[] {
  const persisted: NarrativeEvent[] = [];
  for (const event of events) {
    try {
      persisted.push(insertNarrativeEvent(storage, event));
    } catch (error) {
      const existing = readExistingEvent(storage, event.id);
      if (existing) {
        persisted.push(existing);
        warnings.push(`事件 ${event.id} 已存在，复用既有结算记录以保持幂等。`);
      } else {
        warnings.push(`事件 ${event.id} 写入失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return persisted;
}

function skipped(input: ChapterSettlementInput, warning: string): ChapterSettlementResult {
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
    return skipped(input, "叙事记忆结算已在本书配置中关闭。");
  }

  if (!input.content.trim()) {
    return skipped(input, "章节正文为空，跳过 Narrative Memory 结算。");
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

  const extraction = await extractNarrativeEventsFromChapter({
    bookId: input.bookId,
    chapterNumber: input.chapterNumber,
    title: input.title,
    content: input.content,
    currentLedger,
    llmExtractor: config.settlement.useLlmExtraction ? options.llmExtractor : undefined,
  });
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
  const eventResults = [...persisted];

  const applied = applyNarrativeEvents(storage, input.bookId, persisted, {
    closeSupersededFacts: config.ledger.closeSupersededFacts,
  });
  const downgradedPendingIds: string[] = [];
  for (const failed of applied.failedEvents) {
    const failedEvent = persisted.find((event) => event.id === failed.id);
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
  };
}
