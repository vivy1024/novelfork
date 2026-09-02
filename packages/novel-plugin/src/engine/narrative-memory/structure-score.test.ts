import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import { applyForeshadowEvents, ensureNarrativeMemorySchema, insertNarrativeEvent } from "./storage.js";
import {
  listStructureScores,
  scoreAndPersistNarrativeStructure,
  scoreNarrativeStructure,
} from "./structure-score.js";
import type { NarrativeEvent } from "./types.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-structure-score-${crypto.randomUUID()}`);
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

describe("scoreNarrativeStructure", () => {
  it("scores causal coverage, dangling hooks and triggered unpaid ratio", () => {
    const rows = scoreNarrativeStructure({
      bookId: "book-1",
      chapterNumber: 20,
      now: 1,
      events: [
        { id: "e1", chapterNumber: 20, eventType: "hook_triggered", causedBy: ["e0"] },
        { id: "e2", chapterNumber: 20, eventType: "location_changed" },
        { id: "e3", chapterNumber: 20, eventType: "timeline_advanced" },
      ],
      foreshadows: [
        { status: "triggered", setupChapter: 3 },
        { status: "planted", setupChapter: 18 },
        { status: "paid_off", setupChapter: 2 },
      ],
    });
    const byId = Object.fromEntries(rows.map((row) => [row.featureId, row]));
    expect(byId.EVT_CAU_002?.numericValue).toBe(0.3333);
    expect(byId.PLT_MOR_002?.numericValue).toBe(0.5);
    expect(byId.PLT_TRG_001?.numericValue).toBe(0.5);
    expect(byId.EVT_TML_001?.numericValue).toBe(1);
  });
});

describe("scoreAndPersistNarrativeStructure", () => {
  it("writes chapter scores after events and foreshadows exist", async () => {
    const storage = await createStorage();
    try {
      ensureNarrativeMemorySchema(storage);
      insertNarrativeEvent(storage, event({
        id: "e-plant",
        eventType: "hook_planted",
        subject: "小瓶",
        predicate: "埋设",
        object: "绿液",
        chapterNumber: 3,
      }));
      insertNarrativeEvent(storage, event({
        id: "e-trigger",
        eventType: "hook_triggered",
        subject: "小瓶",
        predicate: "触发",
        object: "药园试验开始",
        chapterNumber: 8,
        causedBy: ["e-plant"],
      }));
      applyForeshadowEvents(storage, "book-1", [
        event({
          id: "e-plant",
          eventType: "hook_planted",
          subject: "小瓶",
          predicate: "埋设",
          object: "绿液",
          chapterNumber: 3,
        }),
        event({
          id: "e-trigger",
          eventType: "hook_triggered",
          subject: "小瓶",
          predicate: "触发",
          object: "药园试验开始",
          chapterNumber: 8,
          causedBy: ["e-plant"],
        }),
      ]);

      const written = scoreAndPersistNarrativeStructure(storage, "book-1", 8, 1);
      expect(written).toHaveLength(4);
      const stored = listStructureScores(storage, "book-1", 8);
      expect(stored.map((row) => row.featureId).sort()).toEqual(["EVT_CAU_002", "EVT_TML_001", "PLT_MOR_002", "PLT_TRG_001"]);
      expect(stored.find((row) => row.featureId === "EVT_CAU_002")?.numericValue).toBe(1);
      expect(stored.find((row) => row.featureId === "PLT_TRG_001")?.numericValue).toBe(1);
    } finally {
      storage.close();
    }
  });
});
