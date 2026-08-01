import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import { buildNarrativeContext } from "../engine/narrative-memory/build-narrative-context.js";
import { settleConfirmedChapter } from "./chapter-settlement-service.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-chapter-settlement-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  return createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("chapter settlement service", () => {
  it("skips empty confirmed chapter content without writing events or facts", async () => {
    const storage = await createStorage();
    try {
      const result = await settleConfirmedChapter({ bookId: "book-1", chapterNumber: 12, content: "   " }, { storage });

      expect(result).toMatchObject({ status: "skipped", extracted: 0, autoApplied: 0, pending: 0 });
      expect(storage.sqlite.prepare<{ count: number }>("SELECT COUNT(*) AS count FROM narrative_event").get()?.count ?? 0).toBe(0);
      expect(storage.sqlite.prepare<{ count: number }>("SELECT COUNT(*) AS count FROM narrative_fact").get()?.count ?? 0).toBe(0);
    } finally {
      storage.close();
    }
  });

  it("auto-applies low-risk extracted events into narrative facts", async () => {
    const storage = await createStorage();
    try {
      const result = await settleConfirmedChapter({
        bookId: "book-1",
        chapterNumber: 12,
        title: "药园试探",
        content: "【地点】韩立抵达药园",
        confirmedAt: "2026-07-02T00:00:00.000Z",
      }, { storage });

      expect(result).toMatchObject({ status: "completed", extracted: 1, autoApplied: 1, pending: 0, highRiskPending: 0 });
      expect(storage.sqlite.prepare<{ count: number }>("SELECT COUNT(*) AS count FROM narrative_fact WHERE subject = ? AND object = ?").get("韩立", "药园")?.count).toBe(1);
      expect(storage.sqlite.prepare<{ status: string; riskLevel: string }>("SELECT status, risk_level AS riskLevel FROM narrative_event LIMIT 1").get()).toEqual({ status: "applied", riskLevel: "low" });
    } finally {
      storage.close();
    }
  });

  it("keeps medium and high risk events pending while applying low risk events", async () => {
    const storage = await createStorage();
    try {
      const result = await settleConfirmedChapter({
        bookId: "book-1",
        chapterNumber: 13,
        content: "【地点】韩立抵达药园\n韩立亲眼确认灵根可被后天逆转。\n韩立第一次把秘密交给厉飞雨保管。",
      }, {
        storage,
        llmExtractor: async () => [{
          eventType: "world_fact_introduced",
          subject: "世界规则",
          predicate: "改变",
          object: "灵根可被后天逆转",
          evidenceText: "韩立亲眼确认灵根可被后天逆转。",
          confidence: 0.92,
          source: "settle",
        }, {
          eventType: "relationship_changed",
          subject: "韩立",
          predicate: "信任",
          object: "厉飞雨",
          evidenceText: "韩立第一次把秘密交给厉飞雨保管。",
          confidence: 0.86,
          source: "settle",
        }],
      });

      expect(result).toMatchObject({ status: "completed", extracted: 3, autoApplied: 2, pending: 1, highRiskPending: 1 });
      expect(storage.sqlite.prepare<{ count: number }>("SELECT COUNT(*) AS count FROM narrative_fact").get()?.count).toBe(2);
      expect(storage.sqlite.prepare<{ count: number }>("SELECT COUNT(*) AS count FROM narrative_event WHERE status = 'pending'").get()?.count).toBe(1);
    } finally {
      storage.close();
    }
  });

  it("makes auto-applied facts available to the next memory.read context", async () => {
    const storage = await createStorage();
    try {
      await settleConfirmedChapter({
        bookId: "book-1",
        chapterNumber: 12,
        title: "药园试探",
        content: "【地点】韩立抵达药园",
      }, { storage });

      const context = await buildNarrativeContext({
        storage,
        bookId: "book-1",
        purpose: "write_chapter",
        chapterNumber: 13,
        sceneText: "韩立在药园继续试探小瓶。",
        entities: ["韩立", "药园"],
        maxTokens: 2000,
      });

      expect(context.sections.facts).toContain("韩立");
      expect(context.sections.facts).toContain("药园");
    } finally {
      storage.close();
    }
  });
});
