import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import { createNarrativeEvent, persistNarrativeEvents } from "./events.js";
import { applyNarrativeEvents } from "./reducer.js";
import type { NarrativeEvent } from "./types.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-narrative-reducer-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  return createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function event(input: Partial<NarrativeEvent> & Pick<NarrativeEvent, "id" | "eventType" | "subject" | "predicate" | "object" | "status" | "riskLevel">): NarrativeEvent {
  return {
    id: input.id,
    bookId: input.bookId ?? "book-1",
    chapterNumber: input.chapterNumber ?? 12,
    eventType: input.eventType,
    subject: input.subject,
    predicate: input.predicate,
    object: input.object,
    evidenceText: input.evidenceText ?? "证据文本",
    confidence: input.confidence ?? 0.9,
    source: input.source ?? "settle",
    status: input.status,
    riskLevel: input.riskLevel,
    createdAt: input.createdAt ?? "2026-06-22T00:00:00.000Z",
    appliedAt: input.appliedAt,
  };
}

describe("NarrativeEvent reducer", () => {
  it("applies low-risk events into narrative facts", async () => {
    const storage = await createStorage();
    try {
      const [created] = persistNarrativeEvents(storage, [createNarrativeEvent({
        bookId: "book-1",
        chapterNumber: 12,
        eventType: "location_changed",
        subject: "韩立",
        predicate: "抵达",
        object: "药园",
        evidenceText: "韩立抵达药园。",
        confidence: 0.9,
        layer: "dynamic",
        source: "settle",
      })]);

      const result = applyNarrativeEvents(storage, "book-1", [created!]);

      expect(result.appliedEventIds).toEqual([created!.id]);
      expect(result.pendingEventIds).toEqual([]);
      const factRows = storage.sqlite.prepare<{ count: number }>("SELECT COUNT(*) AS count FROM narrative_fact WHERE subject = ? AND object = ?").get("韩立", "药园");
      expect(factRows?.count).toBe(1);
    } finally {
      storage.close();
    }
  });

  it("keeps world facts and canon events pending without writing facts", async () => {
    const storage = await createStorage();
    try {
      const pending = event({ id: "event-world", eventType: "world_fact_introduced", subject: "小瓶", predicate: "能够", object: "催熟药草", status: "pending", riskLevel: "high" });
      persistNarrativeEvents(storage, [pending]);

      const result = applyNarrativeEvents(storage, "book-1", [pending]);

      expect(result.pendingEventIds).toEqual(["event-world"]);
      expect(result.appliedEventIds).toEqual([]);
      const factRows = storage.sqlite.prepare<{ count: number }>("SELECT COUNT(*) AS count FROM narrative_fact").get();
      expect(factRows?.count).toBe(0);
    } finally {
      storage.close();
    }
  });

  it("dedupes repeated same-chapter events into one fact", async () => {
    const storage = await createStorage();
    try {
      const events = [
        event({ id: "event-a", eventType: "timeline_advanced", subject: "剧情", predicate: "推进到", object: "药园试探", status: "applied", riskLevel: "low" }),
        event({ id: "event-b", eventType: "timeline_advanced", subject: "剧情", predicate: "推进到", object: "药园试探", status: "applied", riskLevel: "low" }),
      ];
      persistNarrativeEvents(storage, events);

      const result = applyNarrativeEvents(storage, "book-1", events);
      const second = applyNarrativeEvents(storage, "book-1", events);

      expect(result.appliedEventIds).toEqual(["event-a"]);
      expect(result.skippedEventIds).toContain("event-b");
      expect(second.skippedEventIds).toEqual(expect.arrayContaining(["event-a", "event-b"]));
      const factRows = storage.sqlite.prepare<{ count: number }>("SELECT COUNT(*) AS count FROM narrative_fact").get();
      expect(factRows?.count).toBe(1);
    } finally {
      storage.close();
    }
  });

  it("captures reducer errors instead of throwing", async () => {
    const storage = await createStorage();
    try {
      const bad = event({ id: "event-other-book", bookId: "other-book", eventType: "location_changed", subject: "韩立", predicate: "抵达", object: "药园", status: "applied", riskLevel: "low" });
      const result = applyNarrativeEvents(storage, "book-1", [bad]);

      expect(result.failedEvents).toEqual([{ id: "event-other-book", error: "event bookId other-book does not match reducer bookId book-1" }]);
      expect(result.appliedEventIds).toEqual([]);
    } finally {
      storage.close();
    }
  });
});
