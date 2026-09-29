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
  updateNarrativeEvent,
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
    subjectEntryId: input.subjectEntryId,
    objectEntryId: input.objectEntryId,
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
    subjectEntryId: input.subjectEntryId,
    objectEntryId: input.objectEntryId,
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

  it("upgrades an existing narrative_event table before creating identity indexes", async () => {
    const storage = await createStorage();
    try {
      storage.sqlite.exec(`
        CREATE TABLE narrative_event (
          id TEXT PRIMARY KEY,
          book_id TEXT NOT NULL,
          chapter_number INTEGER NOT NULL,
          event_type TEXT NOT NULL,
          subject TEXT NOT NULL,
          predicate TEXT NOT NULL,
          object TEXT NOT NULL,
          evidence_text TEXT NOT NULL,
          confidence REAL NOT NULL,
          source TEXT NOT NULL,
          status TEXT NOT NULL,
          risk_level TEXT NOT NULL,
          created_at TEXT NOT NULL,
          applied_at TEXT
        )
      `);

      ensureNarrativeMemorySchema(storage);

      const columns = storage.sqlite
        .prepare<{ name: string }>("PRAGMA table_info(narrative_event)")
        .all()
        .map((row) => row.name);
      expect(columns).toContain("subject_entry_id");
      expect(columns).toContain("object_entry_id");
      expect(columns).toContain("caused_by_json");

      const migrated = insertNarrativeEvent(storage, event({
        id: "legacy-e-1",
        subject: "韩立",
        predicate: "关联",
        object: "小瓶",
        subjectEntryId: "entry-character-hanli",
        objectEntryId: "entry-prop-vial",
      }));
      expect(migrated.subjectEntryId).toBe("entry-character-hanli");
      expect(migrated.objectEntryId).toBe("entry-prop-vial");

      const updated = updateNarrativeEventStatus(storage, {
        id: "legacy-e-1",
        status: "applied",
      });
      expect(updated?.subjectEntryId).toBe("entry-character-hanli");
      expect(updated?.objectEntryId).toBe("entry-prop-vial");
    } finally {
      storage.close();
    }
  });

  it("upgrades an existing narrative_fact table and round-trips identity entry ids", async () => {
    const storage = await createStorage();
    try {
      storage.sqlite.exec(`
        CREATE TABLE narrative_fact (
          id TEXT PRIMARY KEY,
          book_id TEXT NOT NULL,
          subject TEXT NOT NULL,
          predicate TEXT NOT NULL,
          object TEXT NOT NULL,
          category TEXT NOT NULL,
          layer TEXT NOT NULL,
          confidence REAL NOT NULL,
          source_type TEXT NOT NULL,
          source_id TEXT,
          source_chapter INTEGER,
          evidence_text TEXT,
          valid_from_chapter INTEGER,
          valid_until_chapter INTEGER,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);

      ensureNarrativeMemorySchema(storage);

      insertNarrativeFact(storage, fact({
        id: "legacy-f-1",
        subject: "韩立",
        predicate: "持有",
        object: "小瓶",
        subjectEntryId: "entry-character-hanli",
        objectEntryId: "entry-prop-vial",
      }));

      const queried = queryNarrativeFacts(storage, { bookId: "book-1", entities: ["韩立"] });
      expect(queried).toHaveLength(1);
      expect(queried[0]?.subjectEntryId).toBe("entry-character-hanli");
      expect(queried[0]?.objectEntryId).toBe("entry-prop-vial");

      const factColumns = storage.sqlite
        .prepare<{ name: string }>("PRAGMA table_info(narrative_fact)")
        .all()
        .map((row) => row.name);
      expect(factColumns).toContain("subject_entry_id");
      expect(factColumns).toContain("object_entry_id");
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

  it("supports limit=0 as an internal full-scan mode", async () => {
    const storage = await createStorage();
    try {
      ensureNarrativeMemorySchema(storage);
      for (let index = 0; index < 3; index += 1) {
        insertNarrativeFact(storage, fact({ id: `all-${index}`, subject: `人物-${index}`, predicate: "状态", object: "正常" }));
      }
      expect(queryNarrativeFacts(storage, { bookId: "book-1", limit: 0 })).toHaveLength(3);
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

  it("updates the complete event row only after schema validation", async () => {
    const storage = await createStorage();
    try {
      ensureNarrativeMemorySchema(storage);
      insertNarrativeEvent(storage, event({ id: "e-edit", subject: "韩立", predicate: "状态", object: "谨慎" }));

      const updated = updateNarrativeEvent(storage, event({
        id: "e-edit",
        subject: "韩立（伪装）",
        predicate: "心理状态",
        object: "更加谨慎",
        evidenceText: "收敛气息，继续隐忍。",
        source: "import",
        status: "applied",
        appliedAt: "2026-06-22T01:00:00.000Z",
      }));
      expect(updated).toMatchObject({ id: "e-edit", subject: "韩立（伪装）", predicate: "心理状态", object: "更加谨慎", evidenceText: "收敛气息，继续隐忍。", source: "import", status: "applied" });

      expect(() => updateNarrativeEvent(storage, event({ id: "e-edit", subject: "", predicate: "心理状态", object: "更加谨慎" }))).toThrow();
      const reread = storage.sqlite.prepare(`SELECT subject, predicate, object, source, status FROM narrative_event WHERE id = 'e-edit'`).get() as Record<string, unknown>;
      expect(reread).toMatchObject({ subject: "韩立（伪装）", source: "import", status: "applied" });
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
