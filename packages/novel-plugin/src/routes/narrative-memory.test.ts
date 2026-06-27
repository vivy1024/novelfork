import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import { createNarrativeMemoryRouter } from "./narrative-memory.js";
import { insertNarrativeEvent, insertRetrievalLog } from "../engine/narrative-memory/storage.js";
import type { NarrativeEvent, NarrativeRetrievalDiagnostics } from "../engine/narrative-memory/types.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-narrative-memory-route-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  return createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function event(input: Partial<NarrativeEvent> & Pick<NarrativeEvent, "id" | "subject" | "predicate" | "object">): NarrativeEvent {
  return {
    id: input.id,
    bookId: input.bookId ?? "book-1",
    chapterNumber: input.chapterNumber ?? 12,
    eventType: input.eventType ?? "world_fact_introduced",
    subject: input.subject,
    predicate: input.predicate,
    object: input.object,
    evidenceText: input.evidenceText ?? "证据文本",
    confidence: input.confidence ?? 0.8,
    source: input.source ?? "settle",
    status: input.status ?? "pending",
    riskLevel: input.riskLevel ?? "high",
    createdAt: input.createdAt ?? "2026-06-22T00:00:00.000Z",
    appliedAt: input.appliedAt,
  };
}

describe("narrative memory observability router", () => {
  it("returns latest retrieval diagnostics and pending events", async () => {
    const storage = await createStorage();
    try {
      const diagnostics: NarrativeRetrievalDiagnostics = {
        totalMs: 12,
        totalEstimatedTokens: 88,
        channelStats: [{ channel: "semantic", status: "ok", latencyMs: 3, candidateCount: 2, returnedCount: 1, estimatedTokens: 20, metadata: { hitCount: 1 } }],
        injectedTokensByChannel: { semantic: 20 },
        droppedCardIds: ["drop-1"],
        degradedCards: [{ id: "card-1", from: "full", to: "brief" }],
        warnings: ["semantic channel found no hits"],
        wave: { logicDepth: 0.5, entropy: 0.5, activatedTags: ["tag:a"], rerankAlpha: 0.25, fallbackLevel: "L0" },
      };
      insertRetrievalLog(storage, { id: "log-1", bookId: "book-1", chapterNumber: 12, purpose: "write_chapter", totalTokens: 88, diagnostics, createdAt: "2026-06-22T00:00:00.000Z" });
      insertNarrativeEvent(storage, event({ id: "event-1", subject: "韩立", predicate: "发现", object: "小瓶秘密" }));

      const app = createNarrativeMemoryRouter({ storage });
      const diagResponse = await app.request("http://localhost/api/books/book-1/narrative-memory/diagnostics/latest");
      expect(diagResponse.status).toBe(200);
      const diagPayload = await diagResponse.json() as any;
      expect(diagPayload.log.diagnostics.wave.activatedTags).toEqual(["tag:a"]);
      expect(diagPayload.summary.channels[0]).toEqual(expect.objectContaining({ channel: "semantic", status: "ok" }));
      expect(diagPayload.summary.droppedCount).toBe(1);

      const pendingResponse = await app.request("http://localhost/api/books/book-1/narrative-memory/events/pending");
      expect(pendingResponse.status).toBe(200);
      const pendingPayload = await pendingResponse.json() as any;
      expect(pendingPayload.events.map((item: any) => item.id)).toEqual(["event-1"]);
      expect(pendingPayload.events[0]).toEqual(expect.objectContaining({
        eventType: "world_fact_introduced",
        entity: "韩立",
        confidence: 0.8,
        risk: "high",
        evidence: "证据文本",
        chapterNumber: 12,
      }));
    } finally {
      storage.close();
    }
  });
});
