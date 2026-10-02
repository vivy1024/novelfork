import { join } from "node:path";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { buildContextIndexCard, renderContextIndexCard, summarizeContextIndexCard } from "./context-index-card.js";
import { insertRetrievalLog } from "./storage.js";
import type { NarrativeRetrievalDiagnostics } from "./types.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = mkdtempSync(join(tmpdir(), "novelfork-context-index-card-"));
  tempDirs.push(dir);
  const storage = await createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
  return storage;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function diagnostics(partial: Partial<NarrativeRetrievalDiagnostics>): NarrativeRetrievalDiagnostics {
  return {
    totalMs: 12,
    totalEstimatedTokens: 9000,
    channelStats: [],
    injectedTokensByChannel: {},
    droppedCardIds: [],
    degradedCards: [],
    warnings: [],
    ...partial,
  };
}

function insert(storage: StorageDatabase, overrides: { id: string; createdAt?: string; chapterNumber?: number; diagnostics?: Partial<NarrativeRetrievalDiagnostics> }) {
  insertRetrievalLog(storage, {
    id: overrides.id,
    bookId: "book-1",
    ...(overrides.chapterNumber ? { chapterNumber: overrides.chapterNumber } : {}),
    purpose: "write_chapter",
    totalTokens: 9000,
    diagnostics: diagnostics(overrides.diagnostics ?? {}),
    ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
  });
}

describe("buildContextIndexCard", () => {
  it("没有写作召回日志时不生成卡片", async () => {
    const storage = await createStorage();
    try {
      expect(buildContextIndexCard(storage, "book-1")).toBeNull();
    } finally {
      storage.close();
    }
  });

  it("把最近一次写作注入折算成索引卡：通道、裁剪账与重取指引", async () => {
    const storage = await createStorage();
    try {
      insert(storage, {
        id: "log-abcdef123456",
        chapterNumber: 45,
        diagnostics: {
          channelStats: [
            { channel: "hard", status: "ok", latencyMs: 3, candidateCount: 5, returnedCount: 5, estimatedTokens: 2000 },
            { channel: "style", status: "ok", latencyMs: 2, candidateCount: 9, returnedCount: 4, estimatedTokens: 800 },
            { channel: "knowledge", status: "ok", latencyMs: 1, candidateCount: 2, returnedCount: 2, estimatedTokens: 300 },
          ],
          injectedTokensByChannel: { hard: 1500, style: 800, knowledge: 0 },
          droppedCardIds: ["card-x"],
          degradedCards: [{ id: "card-y", from: "full", to: "normal" }],
          trimReasons: [
            { id: "trim-1", reason: "超出通道预算", channel: "style", kind: "token-budget" },
            { id: "trim-2", reason: "超出通道预算", channel: "style", kind: "token-budget" },
          ],
        },
      });
      const card = buildContextIndexCard(storage, "book-1");
      expect(card).not.toBeNull();
      expect(card).toContain("第 45 章");
      expect(card).toContain("log-abcd");
      expect(card).toContain("hard 1500");
      expect(card).toContain("style 800");
      // knowledge 注入为 0：不该列进卡片
      expect(card).not.toContain("knowledge 0");
      expect(card).toContain("降档 1");
      expect(card).toContain("整段裁剪 1");
      expect(card).toContain("预算/条数剪裁 2");
      expect(card).toContain('memory_read(channels=["style"])');
      expect(card).toContain('memory_read(channels=["state","knowledge"])');
      expect(card).toContain("lore_read");
      expect(card).toContain("chapter_read");
      expect(card).toContain("别凭摘要猜");
      expect(card).toContain("【资料索引卡");
    } finally {
      storage.close();
    }
  });

  it("多条日志只取最新的一次", async () => {
    const storage = await createStorage();
    try {
      insert(storage, { id: "old-000000000001", chapterNumber: 10, createdAt: "2026-09-01T00:00:00.000Z" });
      insert(storage, { id: "new-ffffffffffff", chapterNumber: 60, createdAt: "2026-10-01T00:00:00.000Z" });
      const summary = summarizeContextIndexCard(storage, "book-1");
      expect(summary?.logId).toBe("new-ffffffffffff");
      expect(summary?.chapterNumber).toBe(60);
    } finally {
      storage.close();
    }
  });

  it("无裁剪时明确写出来，不编造数字", async () => {
    const storage = await createStorage();
    try {
      insert(storage, { id: "clean-0000000001", chapterNumber: 3 });
      const summary = summarizeContextIndexCard(storage, "book-1");
      expect(summary?.droppedCount).toBe(0);
      const card = renderContextIndexCard(summary!);
      expect(card).toContain("无降档与裁剪");
    } finally {
      storage.close();
    }
  });
});
