import { Hono } from "hono";
import { getStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core";

import {
  getLatestNarrativeRetrievalLog,
  listPendingNarrativeEvents,
  queryNarrativeFacts,
} from "../engine/narrative-memory/storage.js";
import type { NarrativeEvent } from "../engine/narrative-memory/types.js";
import type { NarrativeRetrievalLogRecord } from "../engine/narrative-memory/storage.js";

export interface NarrativeMemoryRouterOptions {
  readonly storage?: StorageDatabase;
}

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

export function createNarrativeMemoryRouter(options: NarrativeMemoryRouterOptions = {}): Hono {
  const app = new Hono();

  app.get("/api/books/:bookId/narrative-memory/diagnostics/latest", (c) => {
    const bookId = c.req.param("bookId");
    const log = getLatestNarrativeRetrievalLog(storageFor(options), bookId);
    if (!log) return c.json({ error: "Narrative retrieval log not found" }, 404);
    return c.json({ log, summary: diagnosticsSummary(log) });
  });

  app.get("/api/books/:bookId/narrative-memory/events/pending", (c) => {
    const bookId = c.req.param("bookId");
    const limit = Number(c.req.query("limit") ?? "50");
    const events = listPendingNarrativeEvents(storageFor(options), { bookId, limit: Number.isFinite(limit) ? limit : 50 });
    return c.json({ events: events.map(pendingEventSummary) });
  });

  app.get("/api/books/:bookId/narrative-memory/facts", (c) => {
    const bookId = c.req.param("bookId");
    const facts = queryNarrativeFacts(storageFor(options), { bookId, limit: 500 });
    return c.json({ facts });
  });

  return app;
}
