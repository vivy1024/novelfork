import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import {
  ensureNarrativeMemorySchema,
  insertNarrativeEvent,
  insertNarrativeFact,
  insertRetrievalLog,
  listHighRiskPendingNarrativeEvents,
  queryNarrativeFacts,
  updateNarrativeEventStatus,
} from "./storage.js";
import type { NarrativeEvent, NarrativeFact, NarrativeRetrievalDiagnostics } from "./types.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-narrative-memory-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  return createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function fact(input: Partial<NarrativeFact> & Pick<NarrativeFact, "id" | "subject" | "predicate" | "object">): NarrativeFact {
  return {
    id: input.id,
    bookId: input.bookId ?? "book-1",
    subject: input.subject,
    predicate: input.predicate,
    object: input.object,
    category: input.category ?? "character_state",
    layer: input.layer ?? "dynamic",
    confidence: input.confidence ?? 0.9,
    sourceType: input.sourceType ?? "event",
    sourceId: input.sourceId,
    sourceChapter: input.sourceChapter,
    evidenceText: input.evidenceText,
    validFromChapter: input.validFromChapter,
    validUntilChapter: input.validUntilChapter,
    createdAt: input.createdAt ?? "2026-06-22T00:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-06-22T00:00:00.000Z",
  };
}

function event(input: Partial<NarrativeEvent> & Pick<NarrativeEvent, "id" | "subject" | "predicate" | "object">): NarrativeEvent {
  return {
    id: input.id,
    bookId: input.bookId ?? "book-1",
    chapterNumber: input.chapterNumber ?? 12,
    eventType: input.eventType ?? "character_state_changed",
    subject: input.subject,
    predicate: input.predicate,
    object: input.object,
    evidenceText: input.evidenceText ?? "韩立决定继续隐忍。",
    confidence: input.confidence ?? 0.88,
    source: input.source ?? "settle",
    status: input.status ?? "pending",
    riskLevel: input.riskLevel ?? "low",
    createdAt: input.createdAt ?? "2026-06-22T00:00:00.000Z",
    appliedAt: input.appliedAt,
  };
}

describe("Narrative Memory storage", () => {
  it("initializes schema idempotently on an empty database", async () => {
    const storage = await createStorage();
    try {
      ensureNarrativeMemorySchema(storage);
      ensureNarrativeMemorySchema(storage);

      const tableRows = storage.sqlite.prepare<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('narrative_fact', 'narrative_event', 'narrative_retrieval_log', 'narrative_context_vector', 'narrative_tag', 'narrative_card_tag', 'narrative_tag_edge') ORDER BY name`,
      ).all();
      expect(tableRows.map((row) => row.name)).toEqual([
        "narrative_card_tag",
        "narrative_context_vector",
        "narrative_event",
        "narrative_fact",
        "narrative_retrieval_log",
        "narrative_tag",
        "narrative_tag_edge",
      ]);
    } finally {
      storage.close();
    }
  });

  it("inserts and queries narrative facts with chapter visibility filtering", async () => {
    const storage = await createStorage();
    try {
      ensureNarrativeMemorySchema(storage);
      insertNarrativeFact(storage, fact({ id: "f-1", subject: "韩立", predicate: "持有", object: "小瓶", validFromChapter: 3 }));
      insertNarrativeFact(storage, fact({ id: "f-2", subject: "南宫婉", predicate: "知道", object: "小瓶", validFromChapter: 20 }));
      insertNarrativeFact(storage, fact({ id: "f-3", subject: "小瓶", predicate: "位于", object: "储物袋", validFromChapter: 2, validUntilChapter: 8 }));
      insertNarrativeFact(storage, fact({ id: "f-3b", subject: "韩立", predicate: "停留", object: "练气期", validFromChapter: 2, validUntilChapter: 11, confidence: 0.7 }));
      insertNarrativeFact(storage, fact({ id: "f-4", subject: "韩立", predicate: "获得", object: "筑基丹", validFromChapter: 12 }));
      insertNarrativeFact(storage, fact({ id: "f-5", subject: "小瓶", predicate: "暴露给", object: "墨大夫", sourceChapter: 12 }));

      const visible = queryNarrativeFacts(storage, { bookId: "book-1", entities: ["韩立", "小瓶"], currentChapter: 12 });
      expect(visible.map((item) => item.id)).toEqual(["f-1", "f-3b"]);
      expect(visible[0]?.subject).toBe("韩立");
    } finally {
      storage.close();
    }
  });

  it("inserts events and updates their reducer status", async () => {
    const storage = await createStorage();
    try {
      ensureNarrativeMemorySchema(storage);
      insertNarrativeEvent(storage, event({ id: "e-1", subject: "韩立", predicate: "状态", object: "更谨慎" }));

      const updated = updateNarrativeEventStatus(storage, {
        id: "e-1",
        status: "applied",
        appliedAt: "2026-06-22T01:00:00.000Z",
      });
      expect(updated?.status).toBe("applied");
      expect(updated?.appliedAt).toBe("2026-06-22T01:00:00.000Z");
    } finally {
      storage.close();
    }
  });

  it("queries high-risk pending events before applying generic pending limits", async () => {
    const storage = await createStorage();
    try {
      ensureNarrativeMemorySchema(storage);
      insertNarrativeEvent(storage, event({ id: "high-old", subject: "世界规则", predicate: "改变", object: "灵根可逆转", riskLevel: "high", createdAt: "2026-06-22T00:00:00.000Z" }));
      for (let index = 0; index < 55; index += 1) {
        insertNarrativeEvent(storage, event({
          id: `medium-${index}`,
          subject: "韩立",
          predicate: "状态",
          object: `谨慎-${index}`,
          riskLevel: "medium",
          createdAt: `2026-06-22T01:${String(index).padStart(2, "0")}:00.000Z`,
        }));
      }

      const highRisk = listHighRiskPendingNarrativeEvents(storage, { bookId: "book-1", limit: 50 });

      expect(highRisk.map((item) => item.id)).toEqual(["high-old"]);
    } finally {
      storage.close();
    }
  });

  it("stores retrieval diagnostics as JSON", async () => {
    const storage = await createStorage();
    try {
      ensureNarrativeMemorySchema(storage);
      const diagnostics: NarrativeRetrievalDiagnostics = {
        totalMs: 12,
        totalEstimatedTokens: 34,
        channelStats: [],
        injectedTokensByChannel: {},
        droppedCardIds: ["card-2"],
        degradedCards: [],
        warnings: ["facts channel empty"],
      };
      const record = insertRetrievalLog(storage, {
        id: "log-1",
        bookId: "book-1",
        chapterNumber: 12,
        purpose: "write_chapter",
        totalTokens: 34,
        diagnostics,
        createdAt: "2026-06-22T02:00:00.000Z",
      });

      expect(record.diagnostics.warnings).toEqual(["facts channel empty"]);
      const row = storage.sqlite.prepare<{ diagnosticsJson: string }>(`SELECT diagnostics_json AS diagnosticsJson FROM narrative_retrieval_log WHERE id = ?`).get("log-1");
      expect(JSON.parse(row?.diagnosticsJson ?? "{}").droppedCardIds).toEqual(["card-2"]);
    } finally {
      storage.close();
    }
  });
});
