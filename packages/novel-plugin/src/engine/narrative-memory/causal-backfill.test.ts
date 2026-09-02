import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import { backfillHookCausalLinks } from "./causal-backfill.js";
import { ensureNarrativeMemorySchema, insertNarrativeEvent } from "./storage.js";
import type { NarrativeEvent } from "./types.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-causal-backfill-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  return createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function event(input: Partial<NarrativeEvent> & Pick<NarrativeEvent, "id" | "eventType" | "subject" | "object" | "chapterNumber">): NarrativeEvent {
  return {
    id: input.id,
    bookId: input.bookId ?? "book-1",
    chapterNumber: input.chapterNumber,
    eventType: input.eventType,
    subject: input.subject,
    predicate: input.predicate ?? "状态",
    object: input.object,
    evidenceText: input.evidenceText ?? "证据",
    confidence: input.confidence ?? 0.9,
    source: input.source ?? "settle",
    status: input.status ?? "applied",
    riskLevel: input.riskLevel ?? "low",
    createdAt: input.createdAt ?? "2026-06-22T00:00:00.000Z",
    appliedAt: input.appliedAt ?? "2026-06-22T00:00:00.000Z",
    ...(input.causedBy ? { causedBy: input.causedBy } : {}),
  };
}

describe("backfillHookCausalLinks", () => {
  it("fills empty caused_by_json on planted → progressed → resolved", async () => {
    const storage = await createStorage();
    try {
      ensureNarrativeMemorySchema(storage);
      insertNarrativeEvent(storage, event({
        id: "e-plant",
        eventType: "hook_planted",
        subject: "小瓶",
        predicate: "埋设",
        object: "绿液催熟",
        chapterNumber: 3,
      }));
      insertNarrativeEvent(storage, event({
        id: "e-progress",
        eventType: "hook_progressed",
        subject: "小瓶",
        predicate: "推进",
        object: "药园试验",
        chapterNumber: 8,
      }));
      insertNarrativeEvent(storage, event({
        id: "e-resolve",
        eventType: "hook_resolved",
        subject: "小瓶",
        predicate: "揭晓",
        object: "瓶中绿液来历",
        chapterNumber: 12,
      }));

      const first = backfillHookCausalLinks(storage, "book-1");
      expect(first).toEqual({ scanned: 3, linked: 2, skippedExisting: 0 });
      const progressed = storage.sqlite.prepare<{ causedByJson: string | null }>(
        `SELECT caused_by_json AS causedByJson FROM narrative_event WHERE id = 'e-progress'`,
      ).get();
      const resolved = storage.sqlite.prepare<{ causedByJson: string | null }>(
        `SELECT caused_by_json AS causedByJson FROM narrative_event WHERE id = 'e-resolve'`,
      ).get();
      expect(progressed?.causedByJson).toBe(JSON.stringify(["e-plant"]));
      expect(resolved?.causedByJson).toBe(JSON.stringify(["e-progress"]));

      const second = backfillHookCausalLinks(storage, "book-1");
      expect(second).toEqual({ scanned: 3, linked: 0, skippedExisting: 2 });
    } finally {
      storage.close();
    }
  });

  it("does not overwrite an existing caused_by_json", async () => {
    const storage = await createStorage();
    try {
      ensureNarrativeMemorySchema(storage);
      insertNarrativeEvent(storage, event({
        id: "e-plant",
        eventType: "hook_planted",
        subject: "小瓶",
        predicate: "埋设",
        object: "绿液催熟",
        chapterNumber: 3,
      }));
      insertNarrativeEvent(storage, event({
        id: "e-progress",
        eventType: "hook_progressed",
        subject: "小瓶",
        predicate: "推进",
        object: "药园试验",
        chapterNumber: 8,
        causedBy: ["keep-me"],
      }));

      const result = backfillHookCausalLinks(storage, "book-1");
      expect(result.skippedExisting).toBe(1);
      expect(result.linked).toBe(0);
      const row = storage.sqlite.prepare<{ causedByJson: string | null }>(
        `SELECT caused_by_json AS causedByJson FROM narrative_event WHERE id = 'e-progress'`,
      ).get();
      expect(row?.causedByJson).toBe(JSON.stringify(["keep-me"]));
    } finally {
      storage.close();
    }
  });

  it("adds caused_by_json to a legacy table that lacked the column", async () => {
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
      storage.sqlite.prepare(`
        INSERT INTO narrative_event (
          id, book_id, chapter_number, event_type, subject, predicate, object,
          evidence_text, confidence, source, status, risk_level, created_at, applied_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "e-plant", "book-1", 3, "hook_planted", "小瓶", "埋设", "绿液催熟",
        "证据", 0.9, "settle", "applied", "low", "2026-06-22T00:00:00.000Z", "2026-06-22T00:00:00.000Z",
      );
      storage.sqlite.prepare(`
        INSERT INTO narrative_event (
          id, book_id, chapter_number, event_type, subject, predicate, object,
          evidence_text, confidence, source, status, risk_level, created_at, applied_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "e-progress", "book-1", 8, "hook_progressed", "小瓶", "推进", "药园试验",
        "证据", 0.9, "settle", "applied", "low", "2026-06-22T00:00:00.000Z", "2026-06-22T00:00:00.000Z",
      );

      const result = backfillHookCausalLinks(storage, "book-1");
      expect(result.linked).toBe(1);
      const columns = storage.sqlite.prepare<{ name: string }>("PRAGMA table_info(narrative_event)").all().map((row) => row.name);
      expect(columns).toContain("caused_by_json");
      const row = storage.sqlite.prepare<{ causedByJson: string | null }>(
        `SELECT caused_by_json AS causedByJson FROM narrative_event WHERE id = 'e-progress'`,
      ).get();
      expect(row?.causedByJson).toBe(JSON.stringify(["e-plant"]));
    } finally {
      storage.close();
    }
  });
});
