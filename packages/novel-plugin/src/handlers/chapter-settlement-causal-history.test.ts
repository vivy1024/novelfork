/**
 * 结算时因果前驱解析只读一部分历史事件（伏笔事件 + 能被本批 causedBy 引用对上的事件）。
 * 这里证明：与读整本历史相比，inferHookCausalLinks / resolveCausedByRefs 的输出逐项相同。
 * 对照组就是改前的整本读取 SQL。
 */
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { inferHookCausalLinks, resolveCausedByRefs, type CausalEventRef } from "../engine/narrative-memory/causal-resolve.js";
import { ensureNarrativeMemorySchema } from "../engine/narrative-memory/storage.js";
import { settleConfirmedChapter } from "./chapter-settlement-service.js";

const BOOK = "book-1";
let storage: StorageDatabase;
let tempDir: string;

beforeEach(async () => {
  tempDir = join(tmpdir(), `novelfork-causal-history-${crypto.randomUUID()}`);
  await mkdir(tempDir, { recursive: true });
  storage = createStorageDatabase({ databasePath: join(tempDir, "novelfork.db") });
  ensureNarrativeMemorySchema(storage);
});

afterEach(async () => {
  storage.close();
  await rm(tempDir, { recursive: true, force: true });
});

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const EVENT_TYPES = ["character_state_changed", "relationship_changed", "location_changed", "hook_planted", "hook_progressed", "hook_triggered", "hook_resolved", "world_fact_introduced"];
const SUBJECTS = ["薛行之", "方工", "林舟", " 沈青 ", "沈\t青", "小瓶", "铜戒指", "旧城封锁", "药园"];

function seedHistory(chapters: number, seed: number) {
  const random = rng(seed);
  const insert = storage.sqlite.prepare(`
    INSERT INTO narrative_event (id, book_id, chapter_number, event_type, subject, predicate, object, evidence_text,
      confidence, source, status, risk_level, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, '证据', 0.9, 'settle', 'applied', 'low', ?)
  `);
  for (let chapter = 1; chapter <= chapters; chapter += 1) {
    for (let k = 0; k < 6; k += 1) {
      const type = EVENT_TYPES[Math.floor(random() * EVENT_TYPES.length)]!;
      const subject = SUBJECTS[Math.floor(random() * SUBJECTS.length)]!;
      // 同章同时刻多条：考验排序并列时是否仍与整本读取一致
      const createdAt = new Date(Date.UTC(2026, 0, 1, 0, 0, chapter, Math.floor(random() * 3))).toISOString();
      insert.run(`ev-${chapter}-${k}-${Math.floor(random() * 1000)}`, BOOK, chapter, type, subject, ["推进", "抵达", "结盟"][k % 3]!, `线索${chapter % 5}号很长的描述`, createdAt);
    }
  }
}

/** 改前的整本读取。 */
function fullHistory(chapterNumber: number): CausalEventRef[] {
  return storage.sqlite.prepare<CausalEventRef>(`
    SELECT id, chapter_number AS chapterNumber, event_type AS eventType, subject, predicate, object
    FROM narrative_event
    WHERE book_id = ? AND chapter_number <= ?
    ORDER BY chapter_number ASC, created_at ASC
  `).all(BOOK, chapterNumber);
}

describe("结算因果历史：只读需要的行，结果与整本读取一致", () => {
  it("随机历史 + 多种 causedBy 写法（id / 主体 / 主体|谓词 / 序号 / 带空白）", async () => {
    seedHistory(60, 7);
    const all = fullHistory(61);
    const random = rng(99);
    const pickRef = () => {
      const roll = random();
      if (roll < 0.2) return all[Math.floor(random() * all.length)]!.id;
      if (roll < 0.45) return SUBJECTS[Math.floor(random() * SUBJECTS.length)]!;
      if (roll < 0.65) return `${SUBJECTS[Math.floor(random() * SUBJECTS.length)]!.trim()}|推进`;
      if (roll < 0.8) return String(Math.floor(random() * 3));
      return "  沈青  ";
    };

    // 抓住结算实际读出的历史：替换 prepare，拦截那一条查询的结果
    for (let round = 0; round < 25; round += 1) {
      const chapterNumber = 61 + round;
      const drafts = Array.from({ length: 3 }, (_, index) => ({
        eventType: EVENT_TYPES[(round + index) % EVENT_TYPES.length]!,
        subject: SUBJECTS[(round * 3 + index) % SUBJECTS.length]!.trim() || "薛行之",
        predicate: "推进",
        object: `本章第${index}件事`,
        evidenceText: "证据",
        confidence: 0.9,
        source: "settle",
        causedBy: Array.from({ length: 1 + Math.floor(random() * 3) }, pickRef),
      }));

      const reference = fullHistory(chapterNumber);
      let captured: CausalEventRef[] | undefined;
      const originalPrepare = storage.sqlite.prepare.bind(storage.sqlite);
      storage.sqlite.prepare = ((sql: string) => {
        const statement = originalPrepare(sql);
        if (!/FROM narrative_event\s+WHERE book_id = \? AND chapter_number <= \?/u.test(sql) || !/event_type IN/u.test(sql)) return statement;
        return new Proxy(statement, {
          get(target, property, receiver) {
            if (property !== "all") return Reflect.get(target, property, receiver);
            return (...args: unknown[]) => {
              const rows = (target.all as (...a: unknown[]) => CausalEventRef[])(...args);
              captured = rows;
              return rows;
            };
          },
        });
      }) as typeof storage.sqlite.prepare;
      try {
        // 正文必须包含证据原文，否则草案在抽取阶段就被丢弃，causedBy 根本到不了历史读取
        const result = await settleConfirmedChapter({ bookId: BOOK, chapterNumber, content: `第${chapterNumber}章\n证据` }, {
          storage,
          llmExtractor: async () => drafts,
        });
        expect(result.status).toBe("completed");
        expect(result.extracted, `第${chapterNumber}章草案应全部进入结算`).toBe(drafts.length);
      } finally {
        storage.sqlite.prepare = originalPrepare;
      }
      expect(captured, `第${chapterNumber}章应走缩窄查询`).toBeDefined();
      expect(captured!.length).toBeLessThanOrEqual(reference.length);

      // 用同一份本批草案，分别以「整本历史」与「缩窄历史」跑两个解析函数，结果必须相同
      const provisional = drafts.map((draft, index) => ({ id: `cur-${chapterNumber}-${index}`, chapterNumber, eventType: draft.eventType, subject: draft.subject, predicate: draft.predicate, object: draft.object }));
      const linksFull = inferHookCausalLinks([...reference, ...provisional]);
      const linksNarrow = inferHookCausalLinks([...captured!, ...provisional]);
      expect([...linksNarrow].sort(), `第${chapterNumber}章 hook 链`).toEqual([...linksFull].sort());
      for (const [index, draft] of drafts.entries()) {
        const args = { refs: draft.causedBy, current: provisional[index]!, batch: provisional };
        expect(resolveCausedByRefs({ ...args, history: captured! }), `第${chapterNumber}章草案${index} causedBy=${JSON.stringify(draft.causedBy)}`)
          .toEqual(resolveCausedByRefs({ ...args, history: reference }));
      }
    }
  }, 60_000);

  it("历史主体带空白（\" 沈青 \"、\"沈\\u3000青\"）且不是伏笔事件时，按折叠后的主体仍能被引用命中", async () => {
    const insert = storage.sqlite.prepare(`
      INSERT INTO narrative_event (id, book_id, chapter_number, event_type, subject, predicate, object, evidence_text,
        confidence, source, status, risk_level, created_at)
      VALUES (?, ?, ?, ?, ?, '抵达', '药园', '证据', 0.9, 'settle', 'applied', 'low', ?)
    `);
    insert.run("ev-ws-1", BOOK, 3, "location_changed", " 沈青 ", "2026-01-01T00:00:03.000Z");
    insert.run("ev-ws-2", BOOK, 4, "relationship_changed", "林\u3000舟", "2026-01-01T00:00:04.000Z");
    insert.run("ev-plain", BOOK, 2, "location_changed", "沈青", "2026-01-01T00:00:02.000Z");
    const result = await settleConfirmedChapter({ bookId: BOOK, chapterNumber: 5, content: "第5章\n证据" }, {
      storage,
      llmExtractor: async () => [
        { eventType: "location_changed", subject: "沈青", predicate: "离开", object: "药园", evidenceText: "证据", confidence: 0.9, source: "settle", causedBy: ["沈青"] },
        { eventType: "location_changed", subject: "方工", predicate: "离开", object: "药园", evidenceText: "证据", confidence: 0.9, source: "settle", causedBy: ["林 舟|抵达"] },
      ],
    });
    expect(result.status).toBe("completed");
    const byPredicate = new Map(result.events.map((event) => [event.subject, event.causedBy ?? []]));
    // 「沈青」的最近前驱是第 4 章之前最晚的那条：第 3 章主体带空白的 ev-ws-1，而不是第 2 章的 ev-plain
    expect(byPredicate.get("沈青")).toEqual(["ev-ws-1"]);
    expect(byPredicate.get("方工")).toEqual(["ev-ws-2"]);
  });

  it("本批没有 causedBy 时只读伏笔事件", async () => {
    seedHistory(30, 3);
    const reference = fullHistory(31);
    const hookCount = reference.filter((row) => row.eventType.startsWith("hook_")).length;
    expect(hookCount).toBeGreaterThan(0);
    expect(hookCount).toBeLessThan(reference.length);
    let captured: unknown[] | undefined;
    const originalPrepare = storage.sqlite.prepare.bind(storage.sqlite);
    storage.sqlite.prepare = ((sql: string) => {
      const statement = originalPrepare(sql);
      if (!/event_type IN/u.test(sql) || !/chapter_number <= \?/u.test(sql)) return statement;
      return new Proxy(statement, {
        get(target, property, receiver) {
          if (property !== "all") return Reflect.get(target, property, receiver);
          return (...args: unknown[]) => (captured = (target.all as (...a: unknown[]) => unknown[])(...args));
        },
      });
    }) as typeof storage.sqlite.prepare;
    try {
      await settleConfirmedChapter({ bookId: BOOK, chapterNumber: 31, content: "第31章" }, {
        storage,
        llmExtractor: async () => [{ eventType: "location_changed", subject: "薛行之", predicate: "抵达", object: "药园", evidenceText: "证据", confidence: 0.9, source: "settle" }],
      });
    } finally {
      storage.sqlite.prepare = originalPrepare;
    }
    expect(captured).toHaveLength(hookCount);
  });
});
