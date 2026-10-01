import { Hono, type Context } from "hono";
import { getStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core";

import {
  handleMemoryEvents,
  handleMemoryGraph,
  type MemoryGraphInput,
} from "../handlers/lore-memory-boundary-handlers.js";
import {
  handleMemoryList,
  handleMemoryReadEntry,
  handleMemorySearch,
  handleMemoryStats,
  type MemoryEntryKind,
} from "../handlers/memory-admin-handlers.js";
import {
  loadNarrativeMemoryConfig,
  parseNarrativeMemoryConfigPatch,
  saveNarrativeMemoryConfig,
} from "../engine/narrative-memory/config.js";
import { queryCurrentNarrativeLedger } from "../engine/narrative-memory/ledger.js";
import { readChapterSettlementRecord, chapterContentFingerprint } from "../engine/narrative-memory/settlement-idempotency.js";
import { readLatestSettlementArtifact } from "../engine/narrative-memory/storage.js";
import { readLatestAuditIssues, markChapterAuditStale } from "../engine/tools/health/audit-log-persist.js";
import { backfillNarrativeEventEntityIds } from "../engine/narrative-memory/entity-id-backfill.js";
import { readBookSettlementFreshness } from "../engine/narrative-memory/settlement-freshness.js";
import { createRuntimeChapterEventExtractor } from "../engine/narrative-memory/chapter-event-extractor.js";
import type { HostTextGenerationAvailability } from "./context.js";
import { rebuildNarrativeEntityIndex } from "../engine/narrative-entity/entity-index.js";
import { refreshBookEntityEmbeddings } from "../engine/narrative-memory/embedding-provider.js";
import { buildEntityDictionary } from "../engine/narrative-memory/entity-dictionary.js";
import { backfillHookCausalLinks } from "../engine/narrative-memory/causal-backfill.js";
import {
  checkMountBelongsToBook,
  createScene,
  createStoryline,
  listMounts,
  listScenes,
  listStorylines,
  mountSceneToStoryline,
  reorderChapterScenes,
  setScenePrimaryStoryline,
  unmountSceneFromStoryline,
  isSceneFunction,
  isStorylineKind,
  SCENE_FUNCTIONS,
  STORYLINE_KINDS,
} from "../engine/narrative-memory/scene-store.js";
import { listStructureScores, scoreAndPersistNarrativeStructure } from "../engine/narrative-memory/structure-score.js";
import { collectStaleFacts, STALE_FACT_THRESHOLD } from "../engine/narrative-memory/staleness.js";
import { runConsistencyCheck } from "../engine/narrative-memory/consistency-detect.js";
import { listCharacterKernels, getCharacterKernel } from "../engine/narrative-memory/storage.js";
import {
  correctNarrativeFact,
  createManualNarrativeFact,
  queryFactsByEntity,
  queryNarrativeFactHistory,
  retireNarrativeFact,
} from "../engine/narrative-memory/fact-mutations.js";
import { getLatestChapterRetrievalLog, getLatestNarrativeRetrievalLog } from "../engine/narrative-memory/storage.js";
import { buildWriteInjectionReport } from "../engine/narrative-memory/write-injection-report.js";
import { loadActiveWritingSkillsForBook } from "../handlers/writing-skill-handlers.js";
import { estimateTokens } from "../engine/jingwei/context/token-budget.js";
import {
  NarrativeEventStatusSchema,
  NarrativeEventTypeSchema,
  NarrativeFactLayerSchema,
  NarrativeRetrievalPurposeSchema,
  type NarrativeEvent,
  type NarrativeEventType,
} from "../engine/narrative-memory/types.js";
import type { NarrativeRetrievalLogRecord } from "../engine/narrative-memory/storage.js";

export interface NarrativeMemoryRouterOptions {
  readonly storage?: StorageDatabase;
  /** Resolve trusted absolute book root for config IO. */
  readonly resolveBookRoot?: (bookId: string) => string;
  /** 宿主提供的服务端文本生成（按当前登录用户选模型、记用量）；网页端重新结算用。 */
  readonly resolveTextGeneration?: (c: Context) => Promise<HostTextGenerationAvailability>;
}

type HandlerResult = {
  readonly ok: boolean;
  readonly summary: string;
  readonly error?: string;
  readonly data?: Record<string, unknown>;
};

const GRAPH_VIEWS = [
  "relationship",
  "timeline",
  "character_arc",
  "foreshadowing",
  "conflict",
  "event_chain",
  "wave",
] as const;

const MEMORY_KINDS = ["fact", "event", "log", "vector"] as const;

function storageFor(options: NarrativeMemoryRouterOptions): StorageDatabase {
  return options.storage ?? getStorageDatabase();
}

function diagnosticsSummary(log: NarrativeRetrievalLogRecord) {
  const diagnostics = log.diagnostics;
  return {
    purpose: log.purpose,
    chapterNumber: log.chapterNumber,
    totalMs: diagnostics.totalMs,
    totalEstimatedTokens: diagnostics.totalEstimatedTokens,
    channels: diagnostics.channelStats.map((stat) => ({
      channel: stat.channel,
      status: stat.status,
      latencyMs: stat.latencyMs,
      candidateCount: stat.candidateCount,
      returnedCount: stat.returnedCount,
      estimatedTokens: stat.estimatedTokens,
      metadata: stat.metadata,
    })),
    injectedTokensByChannel: diagnostics.injectedTokensByChannel,
    droppedCount: diagnostics.droppedCardIds.length,
    degradedCount: diagnostics.degradedCards.length,
    warnings: diagnostics.warnings,
    wave: diagnostics.wave,
    trimReasons: diagnostics.trimReasons ?? [],
    writeProfile: diagnostics.writeProfile,
  };
}

interface WriteInjectionSkillsSection {
  readonly source: "current-enabled" | "unavailable";
  readonly note: string;
  readonly items: readonly {
    readonly slug: string;
    readonly name: string;
    readonly entry: string | null;
    readonly mode: string;
    readonly estimatedTokens: number;
  }[];
}

/**
 * 写作技能不进 narrative_retrieval_log：启用即物化到作品 .novelfork/skills/，
 * 由正在写作的模型按需加载，写前另有合规硬门。因此技能清单没有「写时快照」可查，
 * 只能如实给「当前启用状态 + 正文体积（估算 tokens）」，并在 note 里说清这层语义。
 */
async function loadWriteInjectionSkills(
  options: NarrativeMemoryRouterOptions,
  bookId: string,
): Promise<WriteInjectionSkillsSection> {
  if (!options.resolveBookRoot) {
    return {
      source: "unavailable",
      note: "当前宿主没有提供书籍目录入口，读不到这本书启用了哪些写作技能。",
      items: [],
    };
  }
  try {
    const { skills } = await loadActiveWritingSkillsForBook(bookId, { bookRoot: options.resolveBookRoot(bookId) });
    return {
      source: "current-enabled",
      note: "技能正文不进写作上下文：启用即物化到作品 .novelfork/skills/，由写章的模型自行加载。这里列的是当前启用的技能与其正文估算体积，不是这一章写作当时的快照。",
      items: skills.map((skill) => ({
        slug: skill.slug,
        name: skill.name,
        entry: skill.entry ?? null,
        mode: skill.mode,
        estimatedTokens: estimateTokens(`${skill.name}\n${skill.description}\n${skill.body}`),
      })),
    };
  } catch (error) {
    return {
      source: "unavailable",
      note: `读取技能目录失败：${error instanceof Error ? error.message : String(error)}`,
      items: [],
    };
  }
}

function pendingEventSummary(event: NarrativeEvent) {
  return {
    ...event,
    entity: event.subject,
    risk: event.riskLevel,
    evidence: event.evidenceText,
  };
}

function queryText(c: { req: { query(name: string): string | undefined } }, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = c.req.query(name)?.trim();
    if (value) return value;
  }
  return undefined;
}

function queryInteger(c: { req: { query(name: string): string | undefined } }, ...names: string[]): number | undefined {
  const value = queryText(c, ...names);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function queryLimit(c: { req: { query(name: string): string | undefined } }): number | undefined {
  return queryInteger(c, "limit");
}

function queryChapterRange(
  c: { req: { query(name: string): string | undefined } },
): [number | undefined, number | undefined] | undefined {
  const from = queryInteger(c, "chapterFrom", "from");
  const to = queryInteger(c, "chapterTo", "to");
  if (from !== undefined || to !== undefined) return [from, to];
  const range = queryText(c, "chapterRange");
  if (!range) return undefined;
  const [fromText = "", toText = ""] = range.split(",", 2).map((item) => item.trim());
  const parsedFrom = fromText ? Number(fromText) : undefined;
  const parsedTo = toText ? Number(toText) : undefined;
  if (parsedFrom !== undefined && !Number.isSafeInteger(parsedFrom)) return undefined;
  if (parsedTo !== undefined && !Number.isSafeInteger(parsedTo)) return undefined;
  return parsedFrom === undefined && parsedTo === undefined ? undefined : [parsedFrom, parsedTo];
}

function queryCompleteChapterRange(
  c: { req: { query(name: string): string | undefined } },
): [number, number] | undefined {
  const range = queryChapterRange(c);
  return range?.[0] !== undefined && range[1] !== undefined ? [range[0], range[1]] : undefined;
}

function invalidQuery(c: { json(body: unknown, status?: number): Response }, message: string): Response {
  return c.json({ error: "invalid-input", summary: message }, 400);
}

function handlerStatus(error: string | undefined): number {
  if (error === "not-found" || error === "event-not-found") return 404;
  if (error === "event-apply-failed" || error === "event-not-applied") return 409;
  if (error === "forbidden") return 403;
  return 400;
}

function respondHandler(c: { json(body: unknown, status?: number): Response }, result: HandlerResult): Response {
  if (result.ok) return c.json({ ...(result.data ?? {}), summary: result.summary });
  return c.json({ error: result.error ?? "request-failed", summary: result.summary, ...(result.data ?? {}) }, handlerStatus(result.error));
}

async function readJson(c: { req: { json<T>(): Promise<T> } }): Promise<Record<string, unknown>> {
  try {
    const body = await c.req.json<unknown>();
    return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parseKind(value: string | undefined): MemoryEntryKind | undefined {
  return MEMORY_KINDS.includes(value as MemoryEntryKind) ? value as MemoryEntryKind : undefined;
}

function parseStatus(value: string | undefined) {
  if (!value) return undefined;
  const parsed = NarrativeEventStatusSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function parseLayer(value: string | undefined) {
  if (!value) return undefined;
  const parsed = NarrativeFactLayerSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function createNarrativeMemoryRouter(options: NarrativeMemoryRouterOptions = {}): Hono {
  const app = new Hono();
  const base = "/api/books/:bookId/narrative-memory";
  const storage = () => storageFor(options);
  const bookRootFor = (bookId: string): string => {
    if (!options.resolveBookRoot) {
      throw new Error("narrative-memory config requires resolveBookRoot on the product router");
    }
    return options.resolveBookRoot(bookId);
  };
  const optionalBookRootFor = (bookId: string): string | undefined => (
    options.resolveBookRoot ? options.resolveBookRoot(bookId) : undefined
  );

  // The Runtime mounts this router below its authenticated, ready-book guard.
  // This router never resolves a browser-supplied book ID to a filesystem path
  // and all queries remain scoped by the guarded :bookId.

  app.get(`${base}/config`, async (c) => {
    const bookId = c.req.param("bookId");
    try {
      const config = await loadNarrativeMemoryConfig(bookId, bookRootFor(bookId));
      return c.json({ config });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  // T4 证据链读取：某章最新一次结算的「草案+决策」artifact。
  app.get(`${base}/settlement-artifact`, (c) => {
    const bookId = c.req.param("bookId");
    const chapterRaw = c.req.query("chapter");
    const chapter = Number(chapterRaw);
    if (!Number.isInteger(chapter) || chapter <= 0) {
      return invalidQuery(c, "chapter 必须是正整数。");
    }
    try {
      const payload = readLatestSettlementArtifact(storage(), bookId, chapter);
      if (!payload) return c.json({ error: "not-found", summary: "该章尚无结算证据记录。" }, 404);
      return c.json({ ok: true, chapterNumber: chapter, ...payload });
    } catch (error) {
      return c.json({ error: "artifact-read-failed", detail: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  // T4b 审计 issue 生命周期读取：某章最新审计的明细 + stale 标记。
  app.get(`${base}/audit-issues`, (c) => {
    const bookId = c.req.param("bookId");
    const chapterRaw = c.req.query("chapter");
    const chapter = Number(chapterRaw);
    if (!Number.isInteger(chapter) || chapter <= 0) {
      return invalidQuery(c, "chapter 必须是正整数。");
    }
    try {
      const payload = readLatestAuditIssues(storage(), bookId, chapter);
      // 没审过是常态，不是错误：与 settlement-status 一样返回 200，免得每开一章都记一次失败请求。
      if (!payload) return c.json({ ok: true, chapterNumber: chapter, exists: false, issues: [], stale: false, summary: "该章尚无审计记录。" });
      return c.json({ ok: true, chapterNumber: chapter, exists: true, ...payload });
    } catch (error) {
      return c.json({ error: "audit-read-failed", detail: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  // T4b 改章 stale 比对：前端传当前正文，后端用同一指纹算法对比已结算台账。
  // 全书结算新鲜度：任何入口改过正文、指纹与结算时不一致的章都列为过期（现算，不落盘）。
  app.get(`${base}/settlement-freshness`, async (c) => {
    const bookId = c.req.param("bookId");
    try {
      const freshness = await readBookSettlementFreshness(storage(), bookId, bookRootFor(bookId));
      return c.json({
        ok: true,
        ...freshness,
        ...(freshness.staleChapters.length > 0 ? {
          explanation: {
            whatHappened: `第 ${freshness.staleChapters.join("、")} 章的正文在结算后又被改过。`,
            whyItMatters: "这些章的事实、事件和章摘要还停在旧正文上，后面写作时召回的记忆可能与正文对不上。",
            suggestedAction: "逐章点「重新结算」，或让叙述者对这些章调用 memory.settle_chapter。",
          },
        } : {}),
      });
    } catch (error) {
      return c.json({ error: "settlement-freshness-failed", detail: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  // 网页端结算一章：经宿主服务端文本生成调模型；没有可用模型时不用规则兜底冒充结算。
  // 请求体可带 { force: true }：正文没改也重新抽取（上次漏记时用）。
  app.post(`${base}/chapters/:chapterNumber/resettle`, async (c) => {
    const bookId = c.req.param("bookId");
    const chapterNumber = Number(c.req.param("chapterNumber"));
    if (!Number.isInteger(chapterNumber) || chapterNumber <= 0) return invalidQuery(c, "章号必须是正整数。");
    const body = await readJson(c);
    const force = body.force === true;
    const generation = options.resolveTextGeneration
      ? await options.resolveTextGeneration(c).catch((): HostTextGenerationAvailability => ({
        available: false, code: "MODEL_PROVIDER_UNAVAILABLE", message: "读取模型配置失败。", suggestedAction: "稍后重试，或改用叙述者对话结算本章。",
      }))
      : { available: false as const, code: "MODEL_NOT_CONFIGURED", message: "当前宿主没有提供服务端模型能力。", suggestedAction: "在叙述者对话里让它结算本章。" };
    if (!generation.available) {
      return c.json({
        ok: false,
        code: generation.code,
        explanation: {
          whatHappened: `第 ${chapterNumber} 章没有结算：${generation.message}`,
          whyItMatters: "章后结算要靠模型从正文里抽取事实和事件，只用规则会漏掉大部分变化。",
          suggestedAction: generation.suggestedAction,
        },
      }, 422);
    }
    try {
      const { handleMemorySettleChapter } = await import("../handlers/memory-settle-chapter.js");
      const result = await handleMemorySettleChapter({
        bookId,
        bookRoot: bookRootFor(bookId),
        chapterNumber,
        storage: storage(),
        llmExtractor: createRuntimeChapterEventExtractor(generation.generateText),
        kernelGenerateText: generation.generateText,
        ...(force ? { force: true } : {}),
      });
      return c.json(result, result.ok ? 200 : 422);
    } catch (error) {
      return c.json({ error: "resettle-failed", detail: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  app.post(`${base}/settlement-status`, async (c) => {
    const bookId = c.req.param("bookId");
    try {
      const body = await c.req.json().catch(() => ({}));
      const chapterNumber = Number(body.chapterNumber);
      const content = typeof body.content === "string" ? body.content : "";
      if (!Number.isInteger(chapterNumber) || chapterNumber <= 0) {
        return invalidQuery(c, "chapterNumber 必须是正整数。");
      }
      if (!content.trim()) {
        return invalidQuery(c, "content 不能为空。");
      }
      const record = readChapterSettlementRecord(storage(), { bookId, chapterNumber });
      if (!record) {
        return c.json({ ok: true, changed: false, recordExists: false, summary: "该章尚未结算过，无 stale 可言。" });
      }
      const currentFingerprint = chapterContentFingerprint(content);
      const changed = currentFingerprint !== record.contentFingerprint;
      if (changed) {
        // 改章联动：正文变了 → 同步翻转该章审计行 stale 标记。
        try { markChapterAuditStale(storage(), bookId, chapterNumber, currentFingerprint); } catch { /* 审计行可能不存在 */ }
      }
      return c.json({
        ok: true,
        changed,
        recordExists: true,
        settledAt: record.settledAt,
        summary: changed
          ? "本章正文在结算后已被修改，叙事记忆可能过期——建议重新结算。"
          : "本章与最近一次结算内容一致，记忆仍然新鲜。",
      });
    } catch (error) {
      return c.json({ error: "settlement-status-failed", detail: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  // T8 · 存量事件身份链回填：用实体字典把旧事件的 subject/object 挂到经纬条目。
  // 幂等，只补缺失列；解析不到的行保持原样。返回计数供前端提示。
  app.post(`${base}/backfill-entity-embeddings`, async (c) => {
    const bookId = c.req.param("bookId");
    try {
      const dictionary = buildEntityDictionary(storage(), bookId);
      const result = await refreshBookEntityEmbeddings({ storage: storage(), bookId, dictionary });
      const remaining = dictionary.entries.filter((entry) => entry.category !== "foreshadowing").length - result.reused - result.embedded;
      return c.json({
        ok: true,
        ...result,
        remaining: Math.max(0, remaining),
        summary: result.skipped
          ? result.skipped === "no-embedding-config"
            ? "还没有配置向量模型，无法回填实体向量。"
            : "这本书没有可嵌入的实体。"
          : `写入 ${result.embedded} 条，复用 ${result.reused} 条${remaining > 0 ? `，还剩 ${remaining} 条` : ""}。`,
      });
    } catch (error) {
      return c.json({ error: "embedding-backfill-failed", detail: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  app.post(`${base}/backfill-entity-ids`, (c) => {
    const bookId = c.req.param("bookId");
    try {
      const result = backfillNarrativeEventEntityIds(storage(), bookId);
      return c.json({
        ok: true,
        ...result,
        summary: result.scanned === 0
          ? "没有需要回填的事件（全部已有身份链或字典为空）。"
          : `扫描 ${result.scanned} 条缺失事件：主体回填 ${result.subjectBackfilled}，客体回填 ${result.objectBackfilled}，未命中 ${result.unresolved}。`,
      });
    } catch (error) {
      return c.json({ error: "backfill-failed", detail: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  // 实体索引整本重建：结算后会自动跑；作者改了经纬名字 / 别名后可手动触发。dryRun=1 只统计不写入。
  app.post(`${base}/entity-index/rebuild`, (c) => {
    const bookId = c.req.param("bookId");
    const dryRun = c.req.query("dryRun") === "1";
    try {
      const result = rebuildNarrativeEntityIndex(storage(), bookId, { dryRun });
      if (!result.ok) {
        return c.json({
          ok: false,
          code: "ENTITY_INDEX_SCHEMA_MISSING",
          explanation: {
            whatHappened: result.explanation,
            whyItMatters: "没有实体索引时，关系图与状态回放只能按名字猜，同一角色的不同称呼不会被归到一起。",
            suggestedAction: "重启 NovelFork 让数据库迁移执行完成后再试。",
          },
        }, 409);
      }
      const linkRate = result.totalMentions > 0 ? Math.round((result.resolvedMentions / result.totalMentions) * 100) : null;
      return c.json({
        ...result,
        linkRate,
        summary: `实体 ${result.entities} 个，事件参与者 ${result.participants} 条，关系边 ${result.relations} 条，状态流水 ${result.stateChanges} 条，知情账 ${result.knowledge} 条；`
          + (linkRate === null ? "没有可归并的称呼。" : `称呼归并率 ${linkRate}%（${result.resolvedMentions}/${result.totalMentions}）。`)
          + (result.unresolvedSamples.length > 0 ? ` 未归并的称呼如：${result.unresolvedSamples.slice(0, 5).join("、")}——若是重要角色或地点，请先在经纬里建条目。` : ""),
      });
    } catch (error) {
      return c.json({ error: "entity-index-rebuild-failed", detail: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  app.post(`${base}/structure-score`, async (c) => {
    const bookId = c.req.param("bookId");
    try {
      const body = await c.req.json().catch(() => ({}));
      const chapterNumber = Number(body.chapterNumber);
      if (!Number.isInteger(chapterNumber) || chapterNumber <= 0) {
        return invalidQuery(c, "chapterNumber 必须是正整数。");
      }
      const scores = scoreAndPersistNarrativeStructure(storage(), bookId, chapterNumber);
      return c.json({
        ok: true,
        chapterNumber,
        written: scores.length,
        scores,
        summary: `第${chapterNumber}章结构打分已写入 ${scores.length} 项（StoryScope 子集）。`,
      });
    } catch (error) {
      return c.json({ error: "structure-score-failed", detail: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  app.get(`${base}/structure-score`, (c) => {
    const bookId = c.req.param("bookId");
    const chapterRaw = c.req.query("chapter");
    const chapter = chapterRaw === undefined || chapterRaw === "" ? undefined : Number(chapterRaw);
    if (chapter !== undefined && (!Number.isInteger(chapter) || chapter <= 0)) {
      return invalidQuery(c, "chapter 必须是正整数。");
    }
    try {
      const scores = listStructureScores(storage(), bookId, chapter);
      return c.json({
        ok: true,
        chapterNumber: chapter ?? null,
        scores,
        summary: scores.length === 0 ? "尚无结构打分。" : `已读取 ${scores.length} 项结构打分。`,
      });
    } catch (error) {
      return c.json({ error: "structure-score-read-failed", detail: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  app.post(`${base}/backfill-causal-links`, (c) => {
    const bookId = c.req.param("bookId");
    try {
      const result = backfillHookCausalLinks(storage(), bookId);
      return c.json({
        ok: true,
        ...result,
        summary: result.scanned === 0
          ? "没有需要回填的伏笔事件。"
          : `扫描 ${result.scanned} 条伏笔事件：新补因果 ${result.linked}，已有前驱跳过 ${result.skippedExisting}。`,
      });
    } catch (error) {
      return c.json({ error: "causal-backfill-failed", detail: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  app.put(`${base}/config`, async (c) => {
    const bookId = c.req.param("bookId");
    try {
      const body = await c.req.json().catch(() => ({}));
      const patch = parseNarrativeMemoryConfigPatch(body?.config ?? body);
      const config = await saveNarrativeMemoryConfig(bookId, bookRootFor(bookId), patch);
      return c.json({ config, summary: "叙事记忆配置已保存。" });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.get(`${base}/current`, async (c) => {
    const bookId = c.req.param("bookId");
    const asOfRaw = c.req.query("asOfChapter") ?? c.req.query("chapter");
    const asOfChapter = asOfRaw ? Number(asOfRaw) : undefined;
    const limitRaw = c.req.query("limit");
    const limit = limitRaw ? Number(limitRaw) : undefined;
    if (asOfChapter !== undefined && (!Number.isInteger(asOfChapter) || asOfChapter < 0)) {
      return invalidQuery(c, "asOfChapter 必须是非负整数。");
    }
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 500)) {
      return invalidQuery(c, "limit 必须是 1 到 500 的整数。");
    }
    try {
      const config = await loadNarrativeMemoryConfig(bookId, bookRootFor(bookId));
      const ledger = queryCurrentNarrativeLedger(storage(), {
        bookId,
        asOfChapter,
        limit: limit ?? config.ledger.currentViewLimit,
      });
      const items = ledger.items.map((fact) => ({ kind: "fact" as const, ...fact }));
      return c.json({
        bookId: ledger.bookId,
        asOfChapter: ledger.asOfChapter,
        items,
        counts: ledger.counts,
        facts: items,
      });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  app.get(`${base}/diagnostics/latest`, (c) => {
    const bookId = c.req.param("bookId");
    const log = getLatestNarrativeRetrievalLog(storage(), bookId);
    if (!log) return c.json({ log: null, summary: null });
    return c.json({ log, summary: diagnosticsSummary(log) });
  });

  // W6 写作可见：某章最近一次写作（默认 purpose=write_chapter）的注入清单。
  // 与 audit-issues 同纪律：没写过是常态，返回 200 + exists:false + 解释，不算失败。
  app.get(`${base}/write-injection`, async (c) => {
    const bookId = c.req.param("bookId");
    const chapterRaw = c.req.query("chapter");
    const chapter = Number(chapterRaw);
    if (!Number.isInteger(chapter) || chapter <= 0) {
      return invalidQuery(c, "chapter 必须是正整数。");
    }
    const purposeRaw = c.req.query("purpose")?.trim() || "write_chapter";
    const purpose = NarrativeRetrievalPurposeSchema.safeParse(purposeRaw);
    if (!purpose.success) {
      return invalidQuery(c, `purpose 必须是 ${NarrativeRetrievalPurposeSchema.options.join(" | ")}。`);
    }
    try {
      const log = getLatestChapterRetrievalLog(storage(), { bookId, chapterNumber: chapter, purpose: purpose.data });
      if (!log) {
        return c.json({
          ok: true,
          exists: false,
          chapterNumber: chapter,
          purpose: purpose.data,
          summary: `第 ${chapter} 章没有「${purpose.data === "write_chapter" ? "写章" : purpose.data}」的注入记录。`,
          explanation: {
            whatHappened: `没有找到第 ${chapter} 章最近一次写作的上下文注入记录。`,
            whyItMatters: "只有经写作管线（pipeline.write）召回过上下文的章才有注入日志；用别的方式写或还没写的章，看不到「写作时模型看到了什么」。",
            suggestedAction: "经「写下一章」流程写过这一章后再来查看；或换个章号查询。",
          },
        });
      }
      const report = buildWriteInjectionReport(log);
      const skills = await loadWriteInjectionSkills(options, bookId);
      return c.json({ ok: true, exists: true, ...report, skills });
    } catch (error) {
      return c.json({ error: "write-injection-read-failed", detail: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  app.get(`${base}/events/pending`, async (c) => {
    // 存储层上限 200；超出的请求截到 200，而不是让校验失败变成 500。
    const requestedLimit = queryLimit(c);
    const result = await handleMemoryEvents({
      bookId: c.req.param("bookId"),
      action: "list",
      limit: requestedLimit === undefined ? undefined : Math.min(requestedLimit, 200),
    }, storage());
    if (!result.ok) return respondHandler(c, result);
    const events = Array.isArray(result.data.events) ? result.data.events as NarrativeEvent[] : [];
    return c.json({ events: events.map(pendingEventSummary), summary: result.summary });
  });

  app.post(`${base}/events`, async (c) => {
    const body = await readJson(c);
    if (body.eventType !== undefined) {
      const parsedType = NarrativeEventTypeSchema.safeParse(body.eventType);
      if (!parsedType.success) {
        return c.json({
          error: "invalid-event-type",
          code: "NARRATIVE_EVENT_TYPE_INVALID",
          explanation: {
            whatHappened: `事件类型「${String(body.eventType)}」不在可接受的取值里。`,
            whyItMatters: "未知类型的事件无法参与伏笔、关系与状态的推导，写进去只会成为看不懂的记录。",
            suggestedAction: `改用以下之一：${NarrativeEventTypeSchema.options.join("、")}。`,
          },
        }, 400);
      }
    }
    const result = await handleMemoryEvents({
      bookId: c.req.param("bookId"),
      action: "create",
      chapterNumber: typeof body.chapterNumber === "number" ? body.chapterNumber : Number(body.chapterNumber),
      eventType: typeof body.eventType === "string" ? body.eventType as NarrativeEventType : undefined,
      subject: typeof body.subject === "string" ? body.subject : undefined,
      predicate: typeof body.predicate === "string" ? body.predicate : undefined,
      object: typeof body.object === "string" ? body.object : undefined,
      evidenceText: typeof body.evidenceText === "string" ? body.evidenceText : undefined,
      confidence: typeof body.confidence === "number" ? body.confidence : undefined,
      layer: typeof body.layer === "string" ? body.layer as "dynamic" | "canon" | "reference" : undefined,
    }, storage());
    return respondHandler(c, result);
  });

  async function mutatePendingEvent(c: Context, action: "approve" | "reject"): Promise<Response> {
    const body = await readJson(c);
    const bookId = c.req.param("bookId");
    const result = await handleMemoryEvents({
      bookId,
      action,
      eventId: c.req.param("eventId"),
      reason: typeof body.reason === "string" ? body.reason : undefined,
      ...(typeof body.editSubject === "string" ? { editSubject: body.editSubject } : {}),
      ...(typeof body.editPredicate === "string" ? { editPredicate: body.editPredicate } : {}),
      ...(typeof body.editObject === "string" ? { editObject: body.editObject } : {}),
      ...(typeof body.editEvidenceText === "string" ? { editEvidenceText: body.editEvidenceText } : {}),
      bookRoot: optionalBookRootFor(bookId),
    }, storage());
    return respondHandler(c, result);
  }

  app.post(`${base}/events/:eventId/approve`, (c) => mutatePendingEvent(c, "approve"));
  app.post(`${base}/events/:eventId/reject`, (c) => mutatePendingEvent(c, "reject"));
  // Keep the collection-oriented spelling available to UI clients that treat
  // pending events as a review queue.
  app.post(`${base}/events/pending/:eventId/approve`, (c) => mutatePendingEvent(c, "approve"));
  app.post(`${base}/events/pending/:eventId/reject`, (c) => mutatePendingEvent(c, "reject"));

  /**
   * 待审队列批量操作（作者工作台专用）。
   *
   * approve：逐条复用与单条批准完全相同的 handleMemoryEvents 路径（manual 保护、
   * closeSuperseded 配置、重复跳过语义一致），不会为批量另写一套归约逻辑。
   * delete：物理删除待审事件记录（丢弃，不留痕）；只允许删除 status=pending 的行，
   * 已 applied/rejected 的是裁决历史，不允许从这里抹掉。
   */
  app.post(`${base}/events/bulk`, async (c) => {
    const bookId = c.req.param("bookId");
    const body = await readJson(c);
    const action = body.action === "delete" ? "delete" : "approve";
    const eventIds = Array.isArray(body.eventIds)
      ? body.eventIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0).map((id) => id.trim()).slice(0, 200)
      : [];
    if (eventIds.length === 0) {
      return c.json({ error: "invalid-input", summary: "eventIds 不能为空。" }, 400);
    }
    const reason = typeof body.reason === "string" && body.reason.trim()
      ? body.reason.trim()
      : action === "approve" ? "工作台批量批准" : "工作台批量丢弃";

    if (action === "approve") {
      const approved: string[] = [];
      const skipped: string[] = [];
      const failed: Array<{ id: string; error: string }> = [];
      for (const eventId of eventIds) {
        const result = await handleMemoryEvents({
          bookId,
          action: "approve",
          eventId,
          reason,
          bookRoot: optionalBookRootFor(bookId),
        }, storage());
        if (result.ok) {
          const appliedData = result.data?.applied as { skippedEventIds?: unknown } | undefined;
          if (Array.isArray(appliedData?.skippedEventIds) && appliedData.skippedEventIds.includes(eventId)) {
            skipped.push(eventId);
          } else {
            approved.push(eventId);
          }
        } else {
          failed.push({ id: eventId, error: result.error ?? "approve-failed" });
        }
      }
      return c.json({
        summary: `批量批准完成：${approved.length} 成功，${skipped.length} 跳过（事实已存在），${failed.length} 失败。`,
        approved,
        skipped,
        failed,
        reason,
      });
    }

    const deleted: string[] = [];
    const skipped: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];
    for (const eventId of eventIds) {
      const existing = storage().sqlite
        .prepare<{ status: string }>("SELECT status FROM narrative_event WHERE id = ? AND book_id = ?")
        .get(eventId, bookId);
      if (!existing) { failed.push({ id: eventId, error: "not-found" }); continue; }
      if (existing.status !== "pending") { skipped.push(eventId); continue; }
      try {
        storage().sqlite.prepare("DELETE FROM narrative_event WHERE id = ? AND book_id = ?").run(eventId, bookId);
        deleted.push(eventId);
      } catch (error) {
        failed.push({ id: eventId, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return c.json({
      summary: `批量丢弃完成：${deleted.length} 已删除，${skipped.length} 跳过（非待审），${failed.length} 失败。`,
      deleted,
      skipped,
      failed,
      reason,
    });
  });

  app.get(`${base}/facts`, (c) => {
    const bookId = c.req.param("bookId");
    const asOfRaw = c.req.query("asOfChapter") ?? c.req.query("chapter");
    const asOfChapter = asOfRaw ? Number(asOfRaw) : undefined;
    if (asOfChapter !== undefined && (!Number.isInteger(asOfChapter) || asOfChapter < 0)) {
      return invalidQuery(c, "asOfChapter 必须是非负整数。");
    }
    const ledger = queryCurrentNarrativeLedger(storage(), { bookId, asOfChapter, limit: 500 });
    return c.json({ facts: ledger.items, counts: ledger.counts, asOfChapter: ledger.asOfChapter });
  });

  // 作者手动新增一条叙事事实（sourceType=manual，享有结算覆盖保护）。
  app.post(`${base}/facts`, async (c) => {
    const bookId = c.req.param("bookId");
    const body = await readJson(c);
    const result = createManualNarrativeFact(storage(), {
      bookId,
      subject: typeof body.subject === "string" ? body.subject : "",
      predicate: typeof body.predicate === "string" ? body.predicate : "",
      object: typeof body.object === "string" ? body.object : "",
      category: typeof body.category === "string" ? body.category : "",
      ...(typeof body.confidence === "number" ? { confidence: body.confidence } : {}),
      ...(typeof body.evidenceText === "string" ? { evidenceText: body.evidenceText } : {}),
      ...(typeof body.validFromChapter === "number" ? { validFromChapter: body.validFromChapter } : {}),
      ...(typeof body.closeSuperseded === "boolean" ? { closeSuperseded: body.closeSuperseded } : {}),
    });
    if (!result.ok) return c.json({ error: result.error, summary: result.summary }, 400);
    return c.json({ fact: result.fact, summary: result.summary });
  });

  // 作者纠正：关闭旧值 + 写入 manual 新值（替代语义，历史可回溯）。
  app.put(`${base}/facts/:factId/correct`, async (c) => {
    const bookId = c.req.param("bookId");
    const body = await readJson(c);
    const result = correctNarrativeFact(storage(), {
      bookId,
      factId: c.req.param("factId"),
      ...(typeof body.subject === "string" ? { subject: body.subject } : {}),
      ...(typeof body.object === "string" ? { object: body.object } : {}),
      ...(typeof body.predicate === "string" ? { predicate: body.predicate } : {}),
      ...(typeof body.category === "string" ? { category: body.category } : {}),
      ...(typeof body.confidence === "number" ? { confidence: body.confidence } : {}),
      ...(typeof body.evidenceText === "string" ? { evidenceText: body.evidenceText } : {}),
      ...(typeof body.reason === "string" ? { reason: body.reason } : {}),
    });
    if (!result.ok) return c.json({ error: result.error, summary: result.summary }, result.error === "not-found" ? 404 : 400);
    return c.json({ fact: result.fact, superseded: result.superseded, summary: result.summary });
  });

  // 作者作废：关闭 open fact（不进当前视图，历史保留）。
  app.delete(`${base}/facts/:factId`, async (c) => {
    const bookId = c.req.param("bookId");
    const body = await readJson(c);
    const result = retireNarrativeFact(storage(), {
      bookId,
      factId: c.req.param("factId"),
      ...(typeof body.reason === "string" ? { reason: body.reason } : {}),
    });
    if (!result.ok) return c.json({ error: result.error, summary: result.summary }, result.error === "not-found" ? 404 : 400);
    return c.json({ fact: result.fact, summary: result.summary });
  });

  // 按实体聚合当前 open fact（人物状态板数据源）。
  app.get(`${base}/facts/by-entity`, (c) => {
    const bookId = c.req.param("bookId");
    const asOfChapter = queryInteger(c, "asOfChapter", "chapter");
    if (asOfChapter !== undefined && asOfChapter < 0) {
      return invalidQuery(c, "asOfChapter 必须是非负整数。");
    }
    const categories = queryText(c, "categories")?.split(",").map((item) => item.trim()).filter(Boolean);
    const entity = queryText(c, "entity");
    const entryId = queryText(c, "entryId");
    const groups = queryFactsByEntity(storage(), {
      bookId,
      ...(asOfChapter !== undefined ? { asOfChapter } : {}),
      ...(categories?.length ? { categories } : {}),
      ...(queryLimit(c) !== undefined ? { limit: queryLimit(c) } : {}),
      ...(entryId ? { entryId } : entity ? { entity } : {}),
    });
    return c.json({ groups, total: groups.reduce((sum, group) => sum + group.facts.length, 0) });
  });

  // 角色内核：全部活跃内核的摘要，供角色册/详情页把"这个角色当前是谁"挂到节点上。
  app.get(`${base}/kernels`, (c) => {
    const bookId = c.req.param("bookId");
    const items = listCharacterKernels(storage(), { bookId });
    const kernels = items.map((kernel) => ({
      characterId: kernel.characterId,
      entryStatus: kernel.entryStatus,
      fields: kernel.fields,
      evidence: kernel.evidence,
      updatedChapter: kernel.updatedChapter,
      updatedAt: kernel.updatedAt,
      origin: kernel.origin,
    }));
    return c.json({ kernels, total: kernels.length });
  });

  // 单个角色的完整内核读取。
  app.get(`${base}/kernels/:characterId`, (c) => {
    const bookId = c.req.param("bookId");
    const characterId = c.req.param("characterId");
    const kernel = getCharacterKernel(storage(), bookId, decodeURIComponent(characterId));
    if (!kernel) return c.json({ error: "not-found", summary: "该角色没有内核记录。" }, 404);
    return c.json({ kernel });
  });

  // 某 slot 的完整变迁史（含已关闭值），按生效章节升序。
  app.get(`${base}/facts/:factId/history`, (c) => {
    const bookId = c.req.param("bookId");
    const items = queryNarrativeFactHistory(storage(), { bookId, factId: c.req.param("factId") });
    if (items.length === 0) return c.json({ error: "not-found", summary: "找不到该叙事事实。" }, 404);
    return c.json({ items });
  });

  // 陈旧 fact 归档提示（P5 · 子项1）：动态状态超阈值未变动 → 提示可能已过时。
  // 只读、只返回提示，绝不作废/隐藏；由作者决定是否处理。派生自当前视图 ledger，不落库。
  app.get(`${base}/stale-facts`, (c) => {
    const bookId = c.req.param("bookId");
    const currentChapter = queryInteger(c, "currentChapter", "chapter", "asOfChapter");
    if (currentChapter !== undefined && currentChapter < 0) {
      return invalidQuery(c, "currentChapter 必须是非负整数。");
    }
    // asOfChapter 用于取「截至当前章的现状」；当前章号本身用于计算陈旧程度。
    const asOfChapter = currentChapter;
    const ledger = queryCurrentNarrativeLedger(storage(), {
      bookId,
      ...(asOfChapter !== undefined ? { asOfChapter } : {}),
      limit: 500,
    });
    const reports = collectStaleFacts(ledger.items, currentChapter);
    return c.json({
      bookId,
      currentChapter: currentChapter ?? null,
      thresholdChapters: STALE_FACT_THRESHOLD,
      staleCount: reports.length,
      items: reports.map((report) => ({
        kind: "fact" as const,
        ...report.fact,
        staleness: report.staleness,
      })),
      summary: currentChapter === undefined
        ? "未提供 currentChapter，无法计算陈旧程度；请带上当前章号后重试。"
        : reports.length === 0
          ? `没有超过 ${STALE_FACT_THRESHOLD} 章未变动的动态状态。`
          : `发现 ${reports.length} 条动态状态已超过 ${STALE_FACT_THRESHOLD} 章未变动，可能已过时，请复查。`,
    });
  });

  // 经纬设定 × 叙事记忆现状 一致性检测（纰漏），只读不写。
  app.get(`${base}/consistency`, async (c) => {
    const bookId = c.req.param("bookId");
    const asOfChapter = queryInteger(c, "asOfChapter", "chapter");
    const result = await runConsistencyCheck(storage(), {
      bookId,
      ...(asOfChapter !== undefined ? { asOfChapter } : {}),
    });
    return c.json(result);
  });

  const graphHandler = async (c: Context): Promise<Response> => {
    const view = queryText(c, "view") ?? "relationship";
    if (!GRAPH_VIEWS.includes(view as MemoryGraphInput["view"])) {
      return invalidQuery(c, "view 必须是 relationship | timeline | character_arc | foreshadowing | conflict | event_chain | wave。");
    }
    try {
      const result = await handleMemoryGraph({
        bookId: c.req.param("bookId"),
        view: view as MemoryGraphInput["view"],
        focusEntity: queryText(c, "focusEntity", "focus"),
        focusEntryId: queryText(c, "focusEntryId", "entryId"),
        chapterRange: queryChapterRange(c),
        ...(queryLimit(c) !== undefined ? { limit: queryLimit(c) } : {}),
        ...(queryInteger(c, "offset") !== undefined ? { offset: queryInteger(c, "offset") } : {}),
      }, storage());
      return respondHandler(c, result);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[narrative-memory] graph ${view} 500: ${detail}`);
      return c.json({ error: "graph-query-failed", detail }, 500);
    }
  };
  app.get(`${base}/graph`, graphHandler);

  const listHandler = async (c: Context): Promise<Response> => {
    const kindValue = queryText(c, "kind");
    const statusValue = queryText(c, "status");
    const layerValue = queryText(c, "layer");
    if (kindValue && !parseKind(kindValue)) return invalidQuery(c, "kind 必须是 fact | event | log | vector。");
    if (statusValue && !parseStatus(statusValue)) return invalidQuery(c, "status 必须是 pending | applied | rejected。");
    if (layerValue && !parseLayer(layerValue)) return invalidQuery(c, "layer 必须是 canon | dynamic | reference。");
    const result = await handleMemoryList({
      bookId: c.req.param("bookId"),
      kind: parseKind(kindValue),
      status: parseStatus(statusValue),
      layer: parseLayer(layerValue),
      category: queryText(c, "category"),
      chapterRange: queryCompleteChapterRange(c),
      query: queryText(c, "query", "q"),
      limit: queryLimit(c),
      offset: queryInteger(c, "offset"),
    }, storage());
    return respondHandler(c, result);
  };
  app.get(`${base}/list`, listHandler);
  app.get(`${base}/admin/list`, listHandler);

  const searchHandler = async (c: Context): Promise<Response> => {
    const kindValue = queryText(c, "kind");
    const statusValue = queryText(c, "status");
    if (kindValue && !parseKind(kindValue)) return invalidQuery(c, "kind 必须是 fact | event | log | vector。");
    if (statusValue && !parseStatus(statusValue)) return invalidQuery(c, "status 必须是 pending | applied | rejected。");
    const offset = queryInteger(c, "offset");
    if (offset !== undefined && offset < 0) return invalidQuery(c, "offset 必须是非负整数。");
    const result = await handleMemorySearch({
      bookId: c.req.param("bookId"),
      query: queryText(c, "query", "q") ?? "",
      kind: parseKind(kindValue),
      status: parseStatus(statusValue),
      limit: queryLimit(c),
      ...(offset !== undefined ? { offset } : {}),
    }, storage());
    return respondHandler(c, result);
  };
  app.get(`${base}/search`, searchHandler);
  app.get(`${base}/admin/search`, searchHandler);

  const statsHandler = async (c: Context): Promise<Response> => {
    const result = await handleMemoryStats({ bookId: c.req.param("bookId") }, storage());
    return respondHandler(c, result);
  };
  app.get(`${base}/stats`, statsHandler);
  app.get(`${base}/admin/stats`, statsHandler);

  const readEntryHandler = async (c: Context, kindValue?: string, idValue?: string): Promise<Response> => {
    const kind = parseKind(kindValue ?? queryText(c, "kind"));
    const id = idValue ?? queryText(c, "id");
    if (!kind) return invalidQuery(c, "kind 必须是 fact | event | log | vector。");
    if (!id) return invalidQuery(c, "id 必填。");
    const result = await handleMemoryReadEntry({ bookId: c.req.param("bookId"), kind, id }, storage());
    return respondHandler(c, result);
  };
  app.get(`${base}/read-entry`, (c) => readEntryHandler(c));
  app.get(`${base}/admin/read-entry`, (c) => readEntryHandler(c));
  app.get(`${base}/entries/:kind/:entryId`, (c) => readEntryHandler(c, c.req.param("kind"), c.req.param("entryId")));
  app.get(`${base}/admin/entries/:kind/:entryId`, (c) => readEntryHandler(c, c.req.param("kind"), c.req.param("entryId")));

  // -------------------------------------------------------------------------
  // 场景与剧情线：两棵正交叙事树的数据面
  // -------------------------------------------------------------------------

  /**
   * 一次取全。承载树还需要卷与章（各有自己的权威来源与接口），
   * 但场景/剧情线/挂载这三样必须同时到手才能建因果树——分三次拉会出现
   * 「场景已更新、挂载还是旧的」的中间态，树上就会凭空多出或少掉连线。
   */
  app.get(`${base}/scene-graph`, (c) => {
    const bookId = c.req.param("bookId");
    try {
      const db = storage();
      return c.json({
        ok: true,
        bookId,
        scenes: listScenes(db, bookId),
        storylines: listStorylines(db, bookId),
        mounts: listMounts(db, bookId),
      });
    } catch (error) {
      return c.json(
        { error: "scene-graph-read-failed", detail: error instanceof Error ? error.message : String(error) },
        500,
      );
    }
  });

  app.post(`${base}/storylines`, async (c) => {
    const bookId = c.req.param("bookId");
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    const name = typeof body?.name === "string" ? body.name : "";
    if (!name.trim()) return invalidQuery(c, "name 必填：剧情线需要一个名字，否则树上会出现点不中的无名节点。");
    if (body?.kind !== undefined && !isStorylineKind(body.kind)) {
      return invalidQuery(c, `kind 取值无效（收到「${String(body.kind)}」）：只接受 ${STORYLINE_KINDS.join(" / ")}。无效值会让剧情线查不到类别标签、排序也会错位。`);
    }
    const result = createStoryline(storage(), {
      bookId,
      name,
      ...(isStorylineKind(body?.kind) ? { kind: body.kind } : {}),
      ...(typeof body?.goal === "string" ? { goal: body.goal } : {}),
      ...(typeof body?.entryId === "string" ? { entryId: body.entryId } : {}),
      // 作者在界面上手建的线不该背 needs-review；只有机器抽取才走待审。
      layer: "canon",
      status: "confirmed",
      source: "manual",
    });
    return c.json(result, result.ok ? 200 : 400);
  });

  app.post(`${base}/scenes`, async (c) => {
    const bookId = c.req.param("bookId");
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    const chapterNumber = Number(body?.chapterNumber);
    if (!Number.isInteger(chapterNumber) || chapterNumber < 1) {
      return invalidQuery(c, "chapterNumber 必须是正整数：场景必须落在某一章上。");
    }
    if (body?.function !== undefined && !isSceneFunction(body.function)) {
      return invalidQuery(c, `function 取值无效（收到「${String(body.function)}」）：只接受 ${SCENE_FUNCTIONS.join(" / ")}。`);
    }
    const result = createScene(storage(), {
      bookId,
      chapterNumber,
      ...(typeof body?.title === "string" ? { title: body.title } : {}),
      ...(typeof body?.summary === "string" ? { summary: body.summary } : {}),
      ...(isSceneFunction(body?.function) ? { function: body.function } : {}),
      ...(Number.isInteger(body?.ordinal) ? { ordinal: body!.ordinal as number } : {}),
      layer: "canon",
      status: "confirmed",
      source: "manual",
    });
    return c.json(result, result.ok ? 200 : 400);
  });

  /** 重排要求给出该章全序——少给会留下空号，树的先后就错了。 */
  app.put(`${base}/chapters/:chapterNumber/scene-order`, async (c) => {
    const bookId = c.req.param("bookId");
    const chapterNumber = Number(c.req.param("chapterNumber"));
    if (!Number.isInteger(chapterNumber) || chapterNumber < 1) {
      return invalidQuery(c, "chapterNumber 必须是正整数。");
    }
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    const orderedSceneIds = Array.isArray(body?.sceneIds)
      ? body.sceneIds.filter((item): item is string => typeof item === "string")
      : null;
    if (!orderedSceneIds) return invalidQuery(c, "sceneIds 必须是字符串数组，且需给出该章全部场景。");

    const result = reorderChapterScenes(storage(), bookId, chapterNumber, orderedSceneIds);
    return c.json(result, result.ok ? 200 : 400);
  });

  app.post(`${base}/scenes/:sceneId/mounts`, async (c) => {
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    const storylineIdValue = typeof body?.storylineId === "string" ? body.storylineId : "";
    if (!storylineIdValue) return invalidQuery(c, "storylineId 必填。");
    const owned = checkMountBelongsToBook(storage(), c.req.param("bookId"), c.req.param("sceneId"), storylineIdValue);
    if (!owned.ok) return c.json(owned, 404);
    const role = body?.role === "supporting" ? "supporting" : "primary";
    const result = mountSceneToStoryline(storage(), c.req.param("sceneId"), storylineIdValue, role);
    return c.json(result, result.ok ? 200 : 400);
  });

  app.delete(`${base}/scenes/:sceneId/mounts/:storylineId`, (c) => {
    const owned = checkMountBelongsToBook(storage(), c.req.param("bookId"), c.req.param("sceneId"), c.req.param("storylineId"));
    if (!owned.ok) return c.json(owned, 404);
    const result = unmountSceneFromStoryline(storage(), c.req.param("sceneId"), c.req.param("storylineId"));
    return c.json(result, result.ok ? 200 : 404);
  });

  /**
   * 改主剧情线：因果画布上把场景拖到另一条泳道。storylineId 为 null 表示拖进「未挂线」，摘下全部挂载。
   * 摘旧主挂载与挂新主挂载在同一个事务里，不会出现场景一时两条主线、一时没有主线的中间态。
   */
  app.put(`${base}/scenes/:sceneId/primary-storyline`, async (c) => {
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || !("storylineId" in body) || (body.storylineId !== null && typeof body.storylineId !== "string")) {
      return invalidQuery(c, "storylineId 必填：给剧情线 id，或给 null 表示从所有剧情线上摘下。");
    }
    const storylineIdValue = body.storylineId as string | null;
    const owned = checkMountBelongsToBook(storage(), c.req.param("bookId"), c.req.param("sceneId"), storylineIdValue);
    if (!owned.ok) return c.json(owned, 404);
    return c.json(setScenePrimaryStoryline(storage(), c.req.param("sceneId"), storylineIdValue));
  });

  return app;
}
