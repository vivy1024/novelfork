import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import { createBookRepository } from "../engine/jingwei/repositories/book-repo.js";
import { buildNarrativeContext } from "../engine/narrative-memory/build-narrative-context.js";
import { ensureNarrativeMemorySchema } from "../engine/narrative-memory/storage.js";
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

async function createSummaryStorage(): Promise<StorageDatabase> {
  const storage = await createStorage();
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
  await createBookRepository(storage).create({
    id: "book-1",
    name: "测试书",
    jingweiMode: "dynamic",
    currentChapter: 20,
    createdAt: new Date("2026-06-22T00:00:00.000Z"),
    updatedAt: new Date("2026-06-22T00:00:00.000Z"),
  });
  return storage;
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

  it("事实写入失败时整体回滚，不登记结算台账", async () => {
    const storage = await createStorage();
    try {
      ensureNarrativeMemorySchema(storage);
      storage.sqlite.exec(`
        CREATE TRIGGER fail_narrative_fact_insert
        BEFORE INSERT ON narrative_fact
        BEGIN
          SELECT RAISE(FAIL, 'simulated-fact-write-error');
        END;
      `);

      const result = await settleConfirmedChapter({
        bookId: "book-1",
        chapterNumber: 12,
        content: "【地点】韩立抵达药园",
      }, {
        storage,
        llmExtractor: async () => [{
          eventType: "location_changed",
          subject: "韩立",
          predicate: "抵达",
          object: "药园",
          evidenceText: "【地点】韩立抵达药园",
          confidence: 0.9,
          source: "settle",
        }],
      });

      expect(result.status).toBe("failed");
      expect(result.error).toBe("settlement-commit-failed");
      expect(result.explanation?.whatHappened).toContain("整体回滚");
      expect(storage.sqlite.prepare<{ count: number }>("SELECT COUNT(*) AS count FROM narrative_event").get()?.count).toBe(0);
      expect(storage.sqlite.prepare<{ count: number }>("SELECT COUNT(*) AS count FROM narrative_fact").get()?.count).toBe(0);
      expect(readChapterSettlementRecord(storage, { bookId: "book-1", chapterNumber: 12 })).toBeUndefined();
      expect(storage.sqlite.prepare<{ count: number }>("SELECT COUNT(*) AS count FROM narrative_settlement_artifact").get()?.count).toBe(0);
    } finally {
      storage.close();
    }
  });

  it("结算成功后递增书级 stateRevision，过期 expectedStateRevision 冲突回滚", async () => {
    const storage = await createSummaryStorage();
    try {
      const content = "【地点】韩立抵达药园";
      const first = await settleConfirmedChapter({
        bookId: "book-1",
        chapterNumber: 12,
        content,
        expectedStateRevision: 0,
      }, { storage, llmExtractor: markerExtractor(content) });

      expect(first.status).toBe("completed");
      expect(first.stateRevision).toBe(1);
      expect(first.stateFingerprint).toMatch(/^[0-9a-f]{64}$/u);
      expect(storage.sqlite.prepare<{ state_revision: number }>("SELECT state_revision FROM book WHERE id = ?").get("book-1")?.state_revision).toBe(1);

      const conflict = await settleConfirmedChapter({
        bookId: "book-1",
        chapterNumber: 13,
        content: "【地点】韩立抵达后山",
        expectedStateRevision: 0,
      }, { storage, llmExtractor: markerExtractor("【地点】韩立抵达后山") });

      expect(conflict.status).toBe("failed");
      expect(conflict.error).toBe("state-revision-conflict");
      expect(conflict.explanation?.whatHappened).toContain("记忆没写上");
      expect(conflict.explanation?.suggestedAction).toContain("再结算一次");
      expect(storage.sqlite.prepare<{ count: number }>("SELECT COUNT(*) AS count FROM narrative_event WHERE chapter_number = 13").get()?.count).toBe(0);
      expect(storage.sqlite.prepare<{ state_revision: number }>("SELECT state_revision FROM book WHERE id = ?").get("book-1")?.state_revision).toBe(1);
    } finally {
      storage.close();
    }
  });

  it("结算后自动生成章摘要与张力分（T1 双调用解耦），重结算幂等且携带前章基线", async () => {
    const storage = await createSummaryStorage();
    try {
      const content = "【地点】韩立抵达药园";
      const responses = [
        '{"summary":"韩立初到药园查探小瓶，暂未发现异常。"}',
        '{"plot_tension":72,"emotional_tension":70,"pacing_tension":66}',
        '{"summary":"韩立在药园确认小瓶仍在，暂时没有新的冲突。"}',
        '{"plot_tension":40,"emotional_tension":38,"pacing_tension":41}',
        '{"summary":"重结算后的新摘要。"}',
        '{"plot_tension":50,"emotional_tension":45,"pacing_tension":47}',
      ];
      const prompts: string[] = [];
      const kernelGenerateText = async (request: { messages: ReadonlyArray<{ role: string; content: string }> }) => {
        prompts.push(request.messages.map((message) => message.content).join("\n"));
        return { text: responses.shift() ?? "" };
      };

      // 先结算第 11 章（产生 7.0 基线），再结算第 12 章。
      await settleConfirmedChapter({ bookId: "book-1", chapterNumber: 11, title: "边界封锁", content }, { storage, llmExtractor: markerExtractor(content), kernelGenerateText });
      await settleConfirmedChapter({ bookId: "book-1", chapterNumber: 12, title: "药园试探", content }, { storage, llmExtractor: markerExtractor(content), kernelGenerateText });

      // 摘要与评分是两次独立调用；摘要契约不再包含张力字段。
      expect(prompts[0]).toContain("章节摘要器");
      expect(prompts[0]).not.toContain("tension");
      expect(prompts[1]).toContain("张力评分器");
      expect(prompts[1]).toContain("反中庸铁律");
      expect(prompts[1]).not.toContain("前章综合张力"); // 第 11 章无更早基线

      let rows = storage.sqlite.prepare<{ count: number }>(
        "SELECT COUNT(*) AS count FROM story_jingwei_entry WHERE book_id = ? AND category = 'chapter-summaries' AND deleted_at IS NULL",
      ).get("book-1");
      expect(rows?.count).toBe(2);

      // 第 12 章评分 prompt 携带第 11 章基线：7.0×10 = 70/100。
      expect(prompts[3]).toContain("前章综合张力 70/100");

      const byChapter = (chapter: number) => {
        const rowsAll = storage.sqlite.prepare<{ fields_json: string; content_md: string }>(
          "SELECT fields_json, content_md FROM story_jingwei_entry WHERE book_id = ? AND category = 'chapter-summaries' AND deleted_at IS NULL",
        ).all("book-1");
        return rowsAll.map((row) => ({ fields: JSON.parse(row.fields_json ?? "{}") as Record<string, unknown>, content: row.content_md }))
          .find((item) => item.fields.chapterNumber === chapter);
      };

      // 加权 0.4*72+0.3*70+0.3*66 = 69.6 → 7.0
      expect(byChapter(11)?.fields.tension_score).toBe(7);
      expect(byChapter(11)?.fields.tension_dims).toMatchObject({ plot: 72, emotional: 70, pacing: 66 });
      // 加权 0.4*40+0.3*38+0.3*41 = 39.5 → 4.0
      expect(byChapter(12)?.fields.tension_score).toBe(4);

      // 强制重结算：幂等更新同一条目，且基线仍指向上一次评出的 70/100。
      const second = await settleConfirmedChapter({
        bookId: "book-1",
        chapterNumber: 12,
        title: "药园试探",
        content,
        force: true,
      }, { storage, llmExtractor: markerExtractor(content), kernelGenerateText });

      expect(second.status).toBe("completed");
      rows = storage.sqlite.prepare<{ count: number }>(
        "SELECT COUNT(*) AS count FROM story_jingwei_entry WHERE book_id = ? AND category = 'chapter-summaries' AND deleted_at IS NULL",
      ).get("book-1");
      expect(rows?.count).toBe(2);
      const reSettled = byChapter(12);
      expect(reSettled?.content).toContain("重结算后的新摘要");
      // 加权 0.4*50+0.3*45+0.3*47 = 47.6 → 4.8
      expect(reSettled?.fields.tension_score).toBe(4.8);
    } finally {
      storage.close();
    }
  });

  it("T1: 评分响应彻底不可解析时持久化 -1 哨兵并告警，摘要不丢", async () => {
    const storage = await createSummaryStorage();
    try {
      const content = "【地点】韩立抵达药园";
      const result = await settleConfirmedChapter({
        bookId: "book-1",
        chapterNumber: 12,
        title: "药园试探",
        content,
      }, {
        storage,
        llmExtractor: markerExtractor(content),
        kernelGenerateText: async (request) => {
          const prompt = request.messages.map((message) => message.content).join("\n");
          if (prompt.includes("张力评分器")) return { text: "模型这次拒答了，没有任何 JSON。" };
          return { text: '{"summary":"韩立抵达药园查探小瓶。"}' };
        },
      });

      expect(result.status).toBe("completed");
      expect(result.warnings.some((warning) => warning.includes("标记未评估"))).toBe(true);
      const row = storage.sqlite.prepare<{ summary_md: string | null; fields_json: string }>(
        "SELECT summary_md, fields_json FROM story_jingwei_entry WHERE book_id = ? AND category = 'chapter-summaries' AND deleted_at IS NULL",
      ).get("book-1");
      expect(row?.summary_md).toContain("韩立抵达药园");
      expect(JSON.parse(row?.fields_json ?? "{}").tension_score).toBe(-1);
    } finally {
      storage.close();
    }
  });

  it("T1: 数值字段被写成评语时容错取首个数字，单维度缺失按权重归一", async () => {
    const storage = await createSummaryStorage();
    try {
      const content = "【地点】韩立抵达药园";
      await settleConfirmedChapter({
        bookId: "book-1",
        chapterNumber: 12,
        content,
      }, {
        storage,
        llmExtractor: markerExtractor(content),
        kernelGenerateText: async (request) => {
          const prompt = request.messages.map((message) => message.content).join("\n");
          if (prompt.includes("张力评分器")) {
            // plot 带评语取 72；emotional 字段整体缺失 → 只剩两维，权重 0.4/0.7 归一。
            return { text: '前置解释 {"plot_tension":"约72分","pacing_tension":50} 后缀' };
          }
          return { text: '{"summary":"韩立抵达药园查探小瓶。"}' };
        },
      });

      const row = storage.sqlite.prepare<{ fields_json: string }>(
        "SELECT fields_json FROM story_jingwei_entry WHERE book_id = ? AND category = 'chapter-summaries' AND deleted_at IS NULL",
      ).get("book-1");
      const fields = JSON.parse(row?.fields_json ?? "{}") as { tension_score?: number; tension_dims?: { plot: number; emotional: number; pacing: number } };
      // 归一：72*(0.4/0.7) + 50*(0.3/0.7) = 41.14 + 21.43 = 62.57 → 6.3 → 综合 6.3？round1(6.257…)=6.3
      expect(fields.tension_score).toBeCloseTo(6.3, 5);
      expect(fields.tension_dims).toMatchObject({ plot: 72, emotional: 50, pacing: 50 });
    } finally {
      storage.close();
    }
  });

  it("自动摘要 LLM 失败只产生 warning，不阻断已完成结算", async () => {
    const storage = await createSummaryStorage();
    try {
      const content = "【地点】韩立抵达药园";
      const result = await settleConfirmedChapter({
        bookId: "book-1",
        chapterNumber: 12,
        content,
      }, {
        storage,
        llmExtractor: markerExtractor(content),
        kernelGenerateText: async () => { throw new Error("summary unavailable"); },
      });

      expect(result.status).toBe("completed");
      expect(result.warnings.some((warning) => warning.includes("自动摘要生成失败"))).toBe(true);
      expect(storage.sqlite.prepare<{ count: number }>(
        "SELECT COUNT(*) AS count FROM story_jingwei_entry WHERE category = 'chapter-summaries'",
      ).get()?.count).toBe(0);
    } finally {
      storage.close();
    }
  });

  it("T7: 旧版『第N章摘要：X』条目被原地更新，不再另建新条造成双轨", async () => {
    const storage = await createSummaryStorage();
    try {
      // 分区行先落位，满足条目表对 section_id 的外键约束。
      storage.sqlite.prepare(`
        INSERT INTO story_jingwei_section
          (id, book_id, key, name, description, "order", enabled, show_in_sidebar,
           participates_in_ai, default_visibility, fields_json, builtin_kind, source_template,
           created_at, updated_at, deleted_at)
        VALUES ('chapter-summaries:book-1', 'book-1', 'chapter-summaries', '章节摘要', '测试', 90, 1, 0,
                1, 'nested', '[]', 'chapter-summaries', NULL, 1755000000000, 1755000000000, NULL)
      `).run();
      // 模拟存量：agent-write 时代产生的旧标题摘要（无 chapterNumber 字段）。
      storage.sqlite.prepare(`
        INSERT INTO story_jingwei_entry
          (id, book_id, section_id, title, content_md, tags_json, aliases_json, custom_fields_json,
           related_chapter_numbers_json, related_entry_ids_json, visibility_rule_json, participates_in_ai,
           category, fields_json, sort_order, lifecycle, layer, importance, source, revision_history,
           conflict_status, status, version, created_at, updated_at)
        VALUES
          ('legacy-summary-12', 'book-1', 'chapter-summaries:book-1', '第12章摘要：药园试探',
           '韩立抵达药园的旧版人工摘要。', '[]', '[]', '{}', '[]', '[]', '{"type":"nested"}', 1,
           'chapter-summaries', '{}', 12, 'active', 'dynamic', 70, 'agent-write', '[]',
           'none', 'confirmed', 1, 1755000000000, 1755000000000)
      `).run();

      const content = "【地点】韩立抵达药园";
      const result = await settleConfirmedChapter({
        bookId: "book-1",
        chapterNumber: 12,
        title: "药园试探",
        content,
      }, {
        storage,
        llmExtractor: markerExtractor(content),
        kernelGenerateText: async (request) => {
          const prompt = request.messages.map((message) => message.content).join("\n");
          if (prompt.includes("张力评分器")) return { text: '{"plot_tension":60,"emotional_tension":55,"pacing_tension":58}' };
          return { text: '{"summary":"韩立抵达药园查探小瓶。"}' };
        },
      });

      expect(result.status).toBe("completed");
      // 关键断言：没有另建新条目，旧条目被原地收编为权威摘要。
      const rows = storage.sqlite.prepare<{ count: number }>(
        "SELECT COUNT(*) AS count FROM story_jingwei_entry WHERE book_id = ? AND category = 'chapter-summaries' AND deleted_at IS NULL",
      ).get("book-1");
      expect(rows?.count).toBe(1);
      const row = storage.sqlite.prepare<{ id: string; title: string; source: string; fields_json: string }>(
        "SELECT id, title, source, fields_json FROM story_jingwei_entry WHERE book_id = ? AND category = 'chapter-summaries' AND deleted_at IS NULL",
      ).get("book-1");
      expect(row?.id).toBe("legacy-summary-12");
      expect(row?.title).toBe("第12章");
      expect(row?.source).toBe("auto-settle");
      // 加权 0.4*60+0.3*55+0.3*58 = 57.9 → 5.8
      expect(JSON.parse(row?.fields_json ?? "{}")).toMatchObject({ chapterNumber: 12, tension_score: 5.8 });
    } finally {
      storage.close();
    }
  });

  it("T7: 同章新旧两条并存时，结算自愈去重只留权威一条", async () => {
    const storage = await createSummaryStorage();
    try {
      const stableId = "summary:book-1:13";
      storage.sqlite.prepare(`
        INSERT INTO story_jingwei_section
          (id, book_id, key, name, description, "order", enabled, show_in_sidebar,
           participates_in_ai, default_visibility, fields_json, builtin_kind, source_template,
           created_at, updated_at, deleted_at)
        VALUES ('chapter-summaries:book-1', 'book-1', 'chapter-summaries', '章节摘要', '测试', 90, 1, 0,
                1, 'nested', '[]', 'chapter-summaries', NULL, 1755000000000, 1755000000000, NULL)
      `).run();
      // 并存双轨：stable-id 权威条 + 旧版标题条。
      for (const [id, title] of [[stableId, "第13章"], ["legacy-summary-13", "第13章摘要：协议裂变"]] as const) {
        storage.sqlite.prepare(`
          INSERT INTO story_jingwei_entry
            (id, book_id, section_id, title, content_md, tags_json, aliases_json, custom_fields_json,
             related_chapter_numbers_json, related_entry_ids_json, visibility_rule_json, participates_in_ai,
             category, fields_json, sort_order, lifecycle, layer, importance, source, revision_history,
             conflict_status, status, version, created_at, updated_at)
          VALUES
            (?, 'book-1', 'chapter-summaries:book-1', ?, '内容占位。', '[]', '[]', '{}', '[13]', '[]',
             '{"type":"nested"}', 1, 'chapter-summaries', '{}', 13, 'active', 'dynamic', 70, 'auto-settle',
             '[]', 'none', 'confirmed', 1, 1755000000000, 1755000000000)
        `).run(id, title);
      }

      const content = "【地点】韩立抵达药园";
      const result = await settleConfirmedChapter({
        bookId: "book-1",
        chapterNumber: 13,
        title: "谐振感知",
        content,
      }, {
        storage,
        llmExtractor: markerExtractor(content),
        kernelGenerateText: async () => ({ text: '{"summary":"韩立抵达药园再探。","tensionScore":5}' }),
      });

      expect(result.status).toBe("completed");
      const rows = storage.sqlite.prepare<{ count: number }>(
        "SELECT COUNT(*) AS count FROM story_jingwei_entry WHERE book_id = ? AND category = 'chapter-summaries' AND deleted_at IS NULL",
      ).get("book-1");
      expect(rows?.count).toBe(1);
      const survivor = storage.sqlite.prepare<{ id: string; deleted_id: string | null }>(
        "SELECT id, (SELECT deleted_at IS NOT NULL FROM story_jingwei_entry WHERE id = 'legacy-summary-13') AS deletedId FROM story_jingwei_entry WHERE id = ?",
      ).get(stableId);
      expect(survivor?.id).toBe(stableId);
      expect(Boolean(survivor?.deletedId)).toBe(true);
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
      expect(result.explanation?.whatHappened).toContain("记忆没抽出来");
      expect(result.explanation?.suggestedAction).toContain("再结算这一章");
      expect(readChapterSettlementRecord(storage, { bookId: "book-1", chapterNumber: 7 })).toBeUndefined();
    } finally {
      storage.close();
    }
  });
});
