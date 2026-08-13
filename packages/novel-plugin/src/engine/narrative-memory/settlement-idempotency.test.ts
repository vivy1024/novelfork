/**
 * 结算幂等键的行为契约。
 *
 * 这里锁的是 P5 的核心判断：幂等键是 (bookId, chapterNumber, 正文指纹)，
 * 所以「同章同内容」跳过、「同章改写后」重结算，两者不能混为一谈。
 */
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import {
  chapterContentFingerprint,
  countSettledEventStatuses,
  decideChapterSettlementIdempotency,
  isTerminalSettlementStatus,
  readChapterSettlementRecord,
  recordChapterSettlement,
} from "./settlement-idempotency.js";
import { ensureNarrativeMemorySchema, insertNarrativeEvent } from "./storage.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-settle-idem-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  ensureNarrativeMemorySchema(storage);
  return storage;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("章节正文指纹", () => {
  it("对 CRLF / LF 与首尾空白差异视为同一份正文", () => {
    // 同一份正文在 Windows/Unix 落盘的字节差异不是作者改写，不该触发重新抽取。
    expect(chapterContentFingerprint("第一行\r\n第二行")).toBe(chapterContentFingerprint("第一行\n第二行"));
    expect(chapterContentFingerprint("  正文  \n")).toBe(chapterContentFingerprint("正文"));
  });

  it("对内部空行与缩进变化视为不同正文", () => {
    // 网文的空行承载分段节奏，改了就是改了正文。
    expect(chapterContentFingerprint("第一行\n第二行")).not.toBe(chapterContentFingerprint("第一行\n\n第二行"));
  });

  it("正文内容变化即指纹变化", () => {
    expect(chapterContentFingerprint("韩立抵达药园")).not.toBe(chapterContentFingerprint("韩立抵达洞府"));
  });
});

describe("结算幂等判定", () => {
  it("从未结算过的章判定为首次结算", async () => {
    const storage = await createStorage();
    try {
      const decision = decideChapterSettlementIdempotency(storage, {
        bookId: "book-1",
        chapterNumber: 3,
        content: "韩立抵达药园。",
      });
      expect(decision.decision).toBe("settle");
      expect(decision.record).toBeUndefined();
    } finally {
      storage.close();
    }
  });

  it("同章同内容判定为跳过，并带回既有事件的当前状态分布", async () => {
    const storage = await createStorage();
    try {
      const content = "韩立抵达药园。";
      insertNarrativeEvent(storage, {
        id: "evt-applied",
        bookId: "book-1",
        chapterNumber: 3,
        eventType: "location_changed",
        subject: "韩立",
        predicate: "抵达",
        object: "药园",
        evidenceText: "韩立抵达药园。",
        confidence: 0.9,
        source: "settle",
        status: "applied",
        riskLevel: "low",
        createdAt: "2026-07-02T00:00:00.000Z",
        appliedAt: "2026-07-02T00:00:00.000Z",
      });
      insertNarrativeEvent(storage, {
        id: "evt-pending-high",
        bookId: "book-1",
        chapterNumber: 3,
        eventType: "world_fact_introduced",
        subject: "世界规则",
        predicate: "改变",
        object: "灵根可逆转",
        evidenceText: "韩立抵达药园。",
        confidence: 0.9,
        source: "settle",
        status: "pending",
        riskLevel: "high",
        createdAt: "2026-07-02T00:00:00.000Z",
      });

      recordChapterSettlement(storage, {
        bookId: "book-1",
        chapterNumber: 3,
        contentFingerprint: chapterContentFingerprint(content),
        eventIds: ["evt-applied", "evt-pending-high"],
        settledAt: "2026-07-02T00:00:00.000Z",
      });

      const decision = decideChapterSettlementIdempotency(storage, { bookId: "book-1", chapterNumber: 3, content });
      expect(decision.decision).toBe("skip");
      expect(decision.record?.settlementCount).toBe(1);
      expect(decision.existingEventCounts).toEqual({
        total: 2,
        applied: 1,
        pending: 1,
        rejected: 0,
        highRiskPending: 1,
      });
    } finally {
      storage.close();
    }
  });

  it("同章正文被改写后判定为重结算，并带上旧指纹", async () => {
    const storage = await createStorage();
    try {
      recordChapterSettlement(storage, {
        bookId: "book-1",
        chapterNumber: 3,
        contentFingerprint: chapterContentFingerprint("旧正文"),
        eventIds: [],
        settledAt: "2026-07-02T00:00:00.000Z",
      });

      const decision = decideChapterSettlementIdempotency(storage, {
        bookId: "book-1",
        chapterNumber: 3,
        content: "改写后的新正文",
      });
      expect(decision.decision).toBe("resettle");
      expect(decision.previousFingerprint).toBe(chapterContentFingerprint("旧正文"));
      expect(decision.forced).toBeUndefined();
    } finally {
      storage.close();
    }
  });

  it("force=true 在正文未变时也重结算，并标记为强制", async () => {
    const storage = await createStorage();
    try {
      const content = "韩立抵达药园。";
      recordChapterSettlement(storage, {
        bookId: "book-1",
        chapterNumber: 3,
        contentFingerprint: chapterContentFingerprint(content),
        eventIds: [],
        settledAt: "2026-07-02T00:00:00.000Z",
      });

      const decision = decideChapterSettlementIdempotency(storage, {
        bookId: "book-1",
        chapterNumber: 3,
        content,
        force: true,
      });
      expect(decision.decision).toBe("resettle");
      expect(decision.forced).toBe(true);
    } finally {
      storage.close();
    }
  });

  it("幂等键按书隔离：另一本书的同章号不受影响", async () => {
    const storage = await createStorage();
    try {
      const content = "同样的正文";
      recordChapterSettlement(storage, {
        bookId: "book-1",
        chapterNumber: 3,
        contentFingerprint: chapterContentFingerprint(content),
        eventIds: [],
        settledAt: "2026-07-02T00:00:00.000Z",
      });
      expect(decideChapterSettlementIdempotency(storage, { bookId: "book-2", chapterNumber: 3, content }).decision).toBe("settle");
    } finally {
      storage.close();
    }
  });
});

describe("结算台账", () => {
  it("重结算累加次数并覆盖指纹，同一章只有一行", async () => {
    const storage = await createStorage();
    try {
      const first = recordChapterSettlement(storage, {
        bookId: "book-1",
        chapterNumber: 3,
        contentFingerprint: chapterContentFingerprint("v1"),
        eventIds: ["a"],
        settledAt: "2026-07-02T00:00:00.000Z",
      });
      expect(first.settlementCount).toBe(1);

      const second = recordChapterSettlement(storage, {
        bookId: "book-1",
        chapterNumber: 3,
        contentFingerprint: chapterContentFingerprint("v2"),
        eventIds: ["a", "b"],
        settledAt: "2026-07-03T00:00:00.000Z",
        previousRecord: first,
      });
      expect(second.settlementCount).toBe(2);

      const rows = storage.sqlite
        .prepare<{ count: number }>("SELECT COUNT(*) AS count FROM narrative_chapter_settlement WHERE book_id = ? AND chapter_number = ?")
        .get("book-1", 3);
      expect(rows?.count).toBe(1);

      const record = readChapterSettlementRecord(storage, { bookId: "book-1", chapterNumber: 3 });
      expect(record?.contentFingerprint).toBe(chapterContentFingerprint("v2"));
      expect(record?.eventIds).toEqual(["a", "b"]);
    } finally {
      storage.close();
    }
  });

  it("状态计数从 narrative_event 现算，作者改判后自动反映", async () => {
    const storage = await createStorage();
    try {
      insertNarrativeEvent(storage, {
        id: "evt-1",
        bookId: "book-1",
        chapterNumber: 3,
        eventType: "location_changed",
        subject: "韩立",
        predicate: "抵达",
        object: "药园",
        evidenceText: "证据",
        confidence: 0.9,
        source: "settle",
        status: "pending",
        riskLevel: "low",
        createdAt: "2026-07-02T00:00:00.000Z",
      });
      expect(countSettledEventStatuses(storage, { bookId: "book-1", eventIds: ["evt-1"] }).pending).toBe(1);

      storage.sqlite.prepare("UPDATE narrative_event SET status = 'rejected' WHERE id = ?").run("evt-1");
      const after = countSettledEventStatuses(storage, { bookId: "book-1", eventIds: ["evt-1"] });
      expect(after).toMatchObject({ pending: 0, rejected: 1 });
    } finally {
      storage.close();
    }
  });
});

describe("作者裁决终态", () => {
  it("applied / rejected 是终态，pending 不是", () => {
    expect(isTerminalSettlementStatus("applied")).toBe(true);
    expect(isTerminalSettlementStatus("rejected")).toBe(true);
    expect(isTerminalSettlementStatus("pending")).toBe(false);
  });
});
