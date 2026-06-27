import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import { classifyNarrativeEventRisk, createNarrativeEvent, persistNarrativeEvents } from "./events.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-narrative-events-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  return createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Narrative events", () => {
  it("classifies low-risk dynamic events as applied", () => {
    const risk = classifyNarrativeEventRisk({ eventType: "location_changed", layer: "dynamic", confidence: 0.9 });

    expect(risk.riskLevel).toBe("low");
    expect(risk.status).toBe("applied");
  });

  it("keeps canon and world fact events pending", () => {
    expect(classifyNarrativeEventRisk({ eventType: "character_state_changed", layer: "canon", confidence: 0.95 })).toEqual(expect.objectContaining({ riskLevel: "high", status: "pending" }));
    expect(classifyNarrativeEventRisk({ eventType: "world_fact_introduced", layer: "dynamic", confidence: 0.95 })).toEqual(expect.objectContaining({ riskLevel: "high", status: "pending" }));
  });

  it("keeps low confidence and relationship changes pending", () => {
    expect(classifyNarrativeEventRisk({ eventType: "hook_resolved", layer: "dynamic", confidence: 0.4 }).status).toBe("pending");
    expect(classifyNarrativeEventRisk({ eventType: "relationship_changed", layer: "dynamic", confidence: 0.95 })).toEqual(expect.objectContaining({ riskLevel: "high", status: "pending" }));
  });

  it("creates events with evidence text, confidence and deterministic defaults", () => {
    const event = createNarrativeEvent({
      bookId: "book-1",
      chapterNumber: 12,
      eventType: "hook_progressed",
      subject: "小瓶伏笔",
      predicate: "推进",
      object: "韩立发现催熟能力",
      evidenceText: "韩立看见药草一夜成熟。",
      confidence: 0.88,
      layer: "dynamic",
      source: "settle",
      now: new Date("2026-06-22T00:00:00.000Z"),
    });

    expect(event.id).toContain("book-1:12:hook_progressed");
    expect(event.status).toBe("applied");
    expect(event.riskLevel).toBe("low");
    expect(event.evidenceText).toBe("韩立看见药草一夜成熟。");
    expect(event.confidence).toBe(0.88);
    expect(event.createdAt).toBe("2026-06-22T00:00:00.000Z");
  });

  it("persists narrative events into the event log", async () => {
    const storage = await createStorage();
    try {
      const events = persistNarrativeEvents(storage, [createNarrativeEvent({
        bookId: "book-1",
        chapterNumber: 12,
        eventType: "timeline_advanced",
        subject: "剧情",
        predicate: "推进到",
        object: "药园试探",
        evidenceText: "韩立回到药园。",
        confidence: 0.9,
        layer: "dynamic",
        source: "settle",
      })]);

      expect(events).toHaveLength(1);
      const row = storage.sqlite.prepare<{ count: number }>("SELECT COUNT(*) AS count FROM narrative_event WHERE book_id = ?").get("book-1");
      expect(row?.count).toBe(1);
    } finally {
      storage.close();
    }
  });
});
