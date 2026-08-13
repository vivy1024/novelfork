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
import { runConsistencyCheck } from "../engine/narrative-memory/consistency-detect.js";
import {
  correctNarrativeFact,
  createManualNarrativeFact,
  queryFactsByEntity,
  queryNarrativeFactHistory,
  retireNarrativeFact,
} from "../engine/narrative-memory/fact-mutations.js";
import { getLatestNarrativeRetrievalLog } from "../engine/narrative-memory/storage.js";
import {
  NarrativeEventStatusSchema,
  NarrativeFactLayerSchema,
  type NarrativeEvent,
  type NarrativeEventType,
} from "../engine/narrative-memory/types.js";
import type { NarrativeRetrievalLogRecord } from "../engine/narrative-memory/storage.js";

export interface NarrativeMemoryRouterOptions {
  readonly storage?: StorageDatabase;
  /** Resolve trusted absolute book root for config IO. */
  readonly resolveBookRoot?: (bookId: string) => string;
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
  };
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

function queryChapterRange(c: { req: { query(name: string): string | undefined } }): [number, number] | undefined {
  const from = queryInteger(c, "chapterFrom", "from");
  const to = queryInteger(c, "chapterTo", "to");
  if (from !== undefined && to !== undefined) return [from, to];
  const range = queryText(c, "chapterRange");
  if (!range) return undefined;
  const parts = range.split(",").map((item) => Number(item.trim()));
  if (parts.length < 2 || !parts.every((item) => Number.isSafeInteger(item))) return undefined;
  return [parts[0]!, parts[1]!];
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

  app.get(`${base}/events/pending`, async (c) => {
    const result = await handleMemoryEvents({
      bookId: c.req.param("bookId"),
      action: "list",
      limit: queryLimit(c),
    }, storage());
    if (!result.ok) return respondHandler(c, result);
    const events = Array.isArray(result.data.events) ? result.data.events as NarrativeEvent[] : [];
    return c.json({ events: events.map(pendingEventSummary), summary: result.summary });
  });

  app.post(`${base}/events`, async (c) => {
    const body = await readJson(c);
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
    const groups = queryFactsByEntity(storage(), {
      bookId,
      ...(asOfChapter !== undefined ? { asOfChapter } : {}),
      ...(categories?.length ? { categories } : {}),
      ...(queryLimit(c) !== undefined ? { limit: queryLimit(c) } : {}),
    });
    return c.json({ groups, total: groups.reduce((sum, group) => sum + group.facts.length, 0) });
  });

  // 某 slot 的完整变迁史（含已关闭值），按生效章节升序。
  app.get(`${base}/facts/:factId/history`, (c) => {
    const bookId = c.req.param("bookId");
    const items = queryNarrativeFactHistory(storage(), { bookId, factId: c.req.param("factId") });
    if (items.length === 0) return c.json({ error: "not-found", summary: "找不到该叙事事实。" }, 404);
    return c.json({ items });
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
    const result = await handleMemoryGraph({
      bookId: c.req.param("bookId"),
      view: view as MemoryGraphInput["view"],
      focusEntity: queryText(c, "focusEntity", "focus"),
      chapterRange: queryChapterRange(c),
    }, storage());
    return respondHandler(c, result);
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
      chapterRange: queryChapterRange(c),
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
    const result = await handleMemorySearch({
      bookId: c.req.param("bookId"),
      query: queryText(c, "query", "q") ?? "",
      kind: parseKind(kindValue),
      status: parseStatus(statusValue),
      limit: queryLimit(c),
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

  return app;
}
