import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import { buildNarrativeContext } from "../engine/narrative-memory/build-narrative-context.js";
import { createManualNarrativeFact } from "../engine/narrative-memory/fact-mutations.js";
import { readChapterSettlementRecord } from "../engine/narrative-memory/settlement-idempotency.js";
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

/**
 * 模拟 LLM 抽取器：把测试正文里的【地点】标记翻译成事件草案。
 * 结算只接受 LLM 抽取（不再有规则兜底），测试用这个 mock 表达「LLM 抽到了什么」。
 */
function markerExtractor(content: string) {
  return async () => {
    const drafts: Array<Record<string, unknown>> = [];
    for (const line of content.split("\n")) {
      const match = line.trim().match(/^【地点】(.+?)(?:抵达|来到|进入|到达)(.+)$/u);
      if (match) {
        drafts.push({
          eventType: "location_changed",
          subject: match[1]!.trim(),
          predicate: "抵达",
          object: match[2]!.trim(),
          evidenceText: line.trim(),
          confidence: 0.88,
          source: "settle",
        });
      }
    }
    return drafts;
  };
}

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
      const content = "【地点】韩立抵达药园";
      const result = await settleConfirmedChapter({
        bookId: "book-1",
        chapterNumber: 12,
        title: "药园试探",
        content,
        confirmedAt: "2026-07-02T00:00:00.000Z",
      }, { storage, llmExtractor: markerExtractor(content) });

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
      const content = "韩立抵达药园。\n韩立亲眼确认灵根可被后天逆转。\n韩立第一次把秘密交给厉飞雨保管。";
      const result = await settleConfirmedChapter({
        bookId: "book-1",
        chapterNumber: 13,
        content,
      }, {
        storage,
        llmExtractor: async () => [{
          eventType: "location_changed",
          subject: "韩立",
          predicate: "抵达",
          object: "药园",
          evidenceText: "韩立抵达药园。",
          confidence: 0.92,
          source: "settle",
        }, {
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
      const content = "【地点】韩立抵达药园";
      await settleConfirmedChapter({
        bookId: "book-1",
        chapterNumber: 12,
        title: "药园试探",
        content,
      }, { storage, llmExtractor: markerExtractor(content) });

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

/**
 * P5 结算幂等。
 *
 * 幂等键是 (bookId, chapterNumber, 正文内容指纹)：
 * 「同章同内容」必须跳过，「同章已改写」必须重新结算。只按章号做不到这个区分。
 */
describe("章后结算幂等", () => {
  const CONTENT = "【地点】韩立抵达药园";

  async function settle(storage: StorageDatabase, overrides: Partial<Parameters<typeof settleConfirmedChapter>[0]> = {}) {
    const content = overrides.content ?? CONTENT;
    return settleConfirmedChapter({
      bookId: "book-1",
      chapterNumber: 12,
      title: "药园试探",
      content,
      confirmedAt: "2026-07-02T00:00:00.000Z",
      ...overrides,
    }, { storage, llmExtractor: markerExtractor(content) });
  }

  function factCount(storage: StorageDatabase): number {
    return storage.sqlite.prepare<{ count: number }>("SELECT COUNT(*) AS count FROM narrative_fact").get()?.count ?? 0;
  }

  function eventCount(storage: StorageDatabase): number {
    return storage.sqlite.prepare<{ count: number }>("SELECT COUNT(*) AS count FROM narrative_event").get()?.count ?? 0;
  }

  it("同一章同一份正文重复结算不重复写入，且明确告知已结算过", async () => {
    const storage = await createStorage();
    try {
      const first = await settle(storage);
      expect(first.status).toBe("completed");
      expect(first.idempotency).toMatchObject({ outcome: "first", settlementCount: 1 });
      const factsAfterFirst = factCount(storage);
      const eventsAfterFirst = eventCount(storage);
      expect(factsAfterFirst).toBeGreaterThan(0);

      const second = await settle(storage);

      // 跳过：不是错误，也不是静默的假成功。
      expect(second.status).toBe("skipped");
      expect(second.skipReason).toBe("already-settled");
      expect(second.idempotency).toMatchObject({ outcome: "skipped-duplicate" });
      expect(second.extracted).toBe(0);
      expect(second.autoApplied).toBe(0);

      // 没有任何重复写入。
      expect(factCount(storage)).toBe(factsAfterFirst);
      expect(eventCount(storage)).toBe(eventsAfterFirst);

      // 告警必须带 explanation 三段式。
      expect(second.explanation?.whatHappened).toBeTruthy();
      expect(second.explanation?.whyItMatters).toBeTruthy();
      expect(second.explanation?.suggestedAction).toBeTruthy();
    } finally {
      storage.close();
    }
  });

  it("第三次、第四次重复结算同样跳过，结算次数不虚增", async () => {
    const storage = await createStorage();
    try {
      await settle(storage);
      await settle(storage);
      const third = await settle(storage);
      expect(third.skipReason).toBe("already-settled");
      // 只有真正跑完抽取的结算才登记台账，跳过的不累加。
      expect(readChapterSettlementRecord(storage, { bookId: "book-1", chapterNumber: 12 })?.settlementCount).toBe(1);
    } finally {
      storage.close();
    }
  });

  it("章节被改写后重新结算生效，不被当成重复而跳过", async () => {
    const storage = await createStorage();
    try {
      await settle(storage);

      const resettled = await settle(storage, { content: "【地点】韩立抵达洞府" });

      expect(resettled.status).toBe("completed");
      expect(resettled.idempotency).toMatchObject({ outcome: "resettled", settlementCount: 2 });
      expect(resettled.idempotency?.previousContentFingerprint).toBeTruthy();
      expect(resettled.extracted).toBeGreaterThan(0);
      // 改写后的新事实进入台账。
      expect(storage.sqlite.prepare<{ count: number }>("SELECT COUNT(*) AS count FROM narrative_fact WHERE object = ?").get("洞府")?.count).toBe(1);
      // 重结算也带解释，说明为什么这次没被幂等挡住。
      expect(resettled.explanation?.whatHappened).toContain("改写");
    } finally {
      storage.close();
    }
  });

  it("仅换行符差异不算改写，仍然跳过", async () => {
    const storage = await createStorage();
    try {
      await settle(storage);
      const second = await settle(storage, { content: `${CONTENT}\r\n` });
      expect(second.skipReason).toBe("already-settled");
    } finally {
      storage.close();
    }
  });

  it("force=true 在正文未变时强制重结算，并标记为强制", async () => {
    const storage = await createStorage();
    try {
      await settle(storage);
      const forced = await settle(storage, { force: true });
      expect(forced.status).toBe("completed");
      expect(forced.idempotency).toMatchObject({ outcome: "resettled", forced: true, settlementCount: 2 });
    } finally {
      storage.close();
    }
  });

  it("作者手动纠正过的槽位不会被重结算冲掉（P1 manual 优先级仍然成立）", async () => {
    const storage = await createStorage();
    try {
      await settle(storage);

      // 作者纠正：韩立其实在洞府，不在药园。manual fact 是权威值。
      const manual = createManualNarrativeFact(storage, {
        bookId: "book-1",
        subject: "韩立",
        predicate: "抵达",
        object: "洞府",
        category: "location",
        validFromChapter: 12,
      });
      expect(manual.ok).toBe(true);

      // 正文改写后重结算，抽取器抽出一条此前没结算过的冲突新值。
      const resettled = await settle(storage, { content: "【地点】韩立抵达丹房\n随后折返。" });
      expect(resettled.status).toBe("completed");

      // manual 值仍然是 open 的权威值，没有被机器结算覆盖。
      expect(
        storage.sqlite
          .prepare<{ count: number }>("SELECT COUNT(*) AS count FROM narrative_fact WHERE source_type = 'manual' AND object = ? AND valid_until_chapter IS NULL")
          .get("洞府")?.count,
      ).toBe(1);

      // 与 manual 槽位冲突的新机器事件被降级为 pending 等作者确认，没有直接写成事实。
      expect(
        storage.sqlite
          .prepare<{ count: number }>("SELECT COUNT(*) AS count FROM narrative_event WHERE status = 'pending' AND object = ?")
          .get("丹房")?.count,
      ).toBe(1);
      expect(
        storage.sqlite
          .prepare<{ count: number }>("SELECT COUNT(*) AS count FROM narrative_fact WHERE object = ? AND source_type = 'event'")
          .get("丹房")?.count,
      ).toBe(0);
    } finally {
      storage.close();
    }
  });

  it("重结算不会让此前已应用的机器事件再走一遍写入路径", async () => {
    const storage = await createStorage();
    try {
      await settle(storage);
      // 作者纠正掉机器结论。
      createManualNarrativeFact(storage, {
        bookId: "book-1",
        subject: "韩立",
        predicate: "抵达",
        object: "洞府",
        category: "location",
        validFromChapter: 12,
      });

      // 改写后重结算，抽取器又抽出同一条「韩立抵达药园」（同 tuple，同事件 id）。
      const resettled = await settle(storage, { content: `${CONTENT}\n韩立随后折返洞府。` });
      expect(resettled.status).toBe("completed");
      // 该事件已是 applied 终态，被保护而未重新归约，因此不会把作者的纠正覆盖回去。
      expect(resettled.idempotency?.authorDecidedPreserved).toBeGreaterThan(0);
      expect(
        storage.sqlite
          .prepare<{ count: number }>("SELECT COUNT(*) AS count FROM narrative_fact WHERE source_type = 'manual' AND object = ? AND valid_until_chapter IS NULL")
          .get("洞府")?.count,
      ).toBe(1);
    } finally {
      storage.close();
    }
  });

  it("重复结算不产生重复待审条目", async () => {
    const storage = await createStorage();
    try {
      const llmExtractor = async () => [{
        eventType: "world_fact_introduced",
        subject: "世界规则",
        predicate: "改变",
        object: "灵根可被后天逆转",
        evidenceText: "韩立亲眼确认灵根可被后天逆转。",
        confidence: 0.92,
        source: "settle",
      }];
      const content = "【地点】韩立抵达药园\n韩立亲眼确认灵根可被后天逆转。";

      const first = await settleConfirmedChapter(
        { bookId: "book-1", chapterNumber: 20, content },
        { storage, llmExtractor },
      );
      expect(first.highRiskPending).toBe(1);
      const pendingAfterFirst = storage.sqlite
        .prepare<{ count: number }>("SELECT COUNT(*) AS count FROM narrative_event WHERE status = 'pending'")
        .get()?.count ?? 0;
      expect(pendingAfterFirst).toBe(1);

      // 同内容重复结算（agent 重试 / 管线后又手动补一次）。
      await settleConfirmedChapter({ bookId: "book-1", chapterNumber: 20, content }, { storage, llmExtractor });
      // force 重结算：抽取真的又跑了一遍，但待审队列不能翻倍。
      await settleConfirmedChapter({ bookId: "book-1", chapterNumber: 20, content, force: true }, { storage, llmExtractor });

      expect(
        storage.sqlite.prepare<{ count: number }>("SELECT COUNT(*) AS count FROM narrative_event WHERE status = 'pending'").get()?.count,
      ).toBe(1);
    } finally {
      storage.close();
    }
  });

  it("作者已驳回的事件不会被重结算塞回待审", async () => {
    const storage = await createStorage();
    try {
      const llmExtractor = async () => [{
        eventType: "world_fact_introduced",
        subject: "世界规则",
        predicate: "改变",
        object: "灵根可被后天逆转",
        evidenceText: "韩立亲眼确认灵根可被后天逆转。",
        confidence: 0.92,
        source: "settle",
      }];
      const content = "【地点】韩立抵达药园\n韩立亲眼确认灵根可被后天逆转。";

      await settleConfirmedChapter({ bookId: "book-1", chapterNumber: 20, content }, { storage, llmExtractor });

      // 作者驳回这条高风险事件。
      const eventId = storage.sqlite
        .prepare<{ id: string }>("SELECT id FROM narrative_event WHERE status = 'pending' LIMIT 1")
        .get()?.id;
      expect(eventId).toBeTruthy();
      storage.sqlite.prepare("UPDATE narrative_event SET status = 'rejected' WHERE id = ?").run(eventId);

      // 正文改写后重结算，抽取器又抽出同一条。
      const resettled = await settleConfirmedChapter(
        { bookId: "book-1", chapterNumber: 20, content: `${content}\n韩立随后离开。` },
        { storage, llmExtractor },
      );
      expect(resettled.status).toBe("completed");
      expect(resettled.idempotency?.authorDecidedPreserved).toBeGreaterThan(0);

      // 驳回是终态：没有回到 pending。
      expect(
        storage.sqlite.prepare<{ status: string }>("SELECT status FROM narrative_event WHERE id = ?").get(eventId)?.status,
      ).toBe("rejected");
      expect(
        storage.sqlite.prepare<{ count: number }>("SELECT COUNT(*) AS count FROM narrative_event WHERE status = 'pending'").get()?.count,
      ).toBe(0);
    } finally {
      storage.close();
    }
  });

  it("作者已批准的事件不会被重结算重新处理", async () => {
    const storage = await createStorage();
    try {
      await settle(storage);
      const appliedId = storage.sqlite
        .prepare<{ id: string }>("SELECT id FROM narrative_event WHERE status = 'applied' LIMIT 1")
        .get()?.id;
      expect(appliedId).toBeTruthy();

      const resettled = await settle(storage, { content: `${CONTENT}\n韩立在药园停留了一日。` });
      expect(resettled.status).toBe("completed");
      expect(resettled.idempotency?.authorDecidedPreserved).toBeGreaterThan(0);
      expect(
        storage.sqlite.prepare<{ status: string }>("SELECT status FROM narrative_event WHERE id = ?").get(appliedId)?.status,
      ).toBe("applied");
    } finally {
      storage.close();
    }
  });

  it("空正文与关闭配置的跳过带各自的 skipReason，不与幂等跳过混淆", async () => {
    const storage = await createStorage();
    try {
      const empty = await settleConfirmedChapter({ bookId: "book-1", chapterNumber: 5, content: "   " }, { storage });
      expect(empty.skipReason).toBe("empty-content");
      expect(empty.idempotency).toBeUndefined();
      // 空正文不登记台账，否则后续补上正文会被误判成「已结算」。
      expect(readChapterSettlementRecord(storage, { bookId: "book-1", chapterNumber: 5 })).toBeUndefined();
    } finally {
      storage.close();
    }
  });

  /**
   * 抽取只走 LLM：没有抽取器时必须失败而不是静默成功。
   * 失败不能登记结算台账，否则幂等门会把漏抽的章锁死成「已结算」。
   */
  it("fails without an LLM extractor and never records the settlement", async () => {
    const storage = await createStorage();
    try {
      const result = await settleConfirmedChapter(
        { bookId: "book-1", chapterNumber: 6, content: "韩立抵达药园。" },
        { storage },
      );

      expect(result).toMatchObject({ status: "failed", error: "settlement-extractor-unavailable" });
      expect(result.explanation?.suggestedAction).toBeTruthy();
      expect(storage.sqlite.prepare<{ count: number }>("SELECT COUNT(*) AS count FROM narrative_event").get()?.count).toBe(0);
      expect(storage.sqlite.prepare<{ count: number }>("SELECT COUNT(*) AS count FROM narrative_fact").get()?.count).toBe(0);
      expect(readChapterSettlementRecord(storage, { bookId: "book-1", chapterNumber: 6 })).toBeUndefined();

      // 失败保持可重试：注入抽取器后再跑同一章，正常完成。
      const retried = await settleConfirmedChapter(
        { bookId: "book-1", chapterNumber: 6, content: "韩立抵达药园。" },
        {
          storage,
          llmExtractor: async () => [{
            eventType: "location_changed",
            subject: "韩立",
            predicate: "抵达",
            object: "药园",
            evidenceText: "韩立抵达药园。",
            confidence: 0.9,
            source: "settle",
          }],
        },
      );
      expect(retried.status).toBe("completed");
    } finally {
      storage.close();
    }
  });

  it("fails when the LLM extractor throws, without recording the settlement", async () => {
    const storage = await createStorage();
    try {
      const result = await settleConfirmedChapter(
        { bookId: "book-1", chapterNumber: 7, content: "韩立抵达药园。" },
        {
          storage,
          llmExtractor: async () => {
            throw new Error("LLM unavailable");
          },
        },
      );

      expect(result).toMatchObject({ status: "failed", error: "settlement-extraction-failed" });
      expect(result.explanation?.whatHappened).toContain("LLM unavailable");
      expect(readChapterSettlementRecord(storage, { bookId: "book-1", chapterNumber: 7 })).toBeUndefined();
    } finally {
      storage.close();
    }
  });
});
