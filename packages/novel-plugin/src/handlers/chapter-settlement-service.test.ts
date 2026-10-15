import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import { createBookRepository } from "../engine/jingwei/repositories/book-repo.js";
import { buildNarrativeContext } from "../engine/narrative-memory/build-narrative-context.js";
import { ensureNarrativeMemorySchema, queryNarrativeFacts } from "../engine/narrative-memory/storage.js";
import { createManualNarrativeFact } from "../engine/narrative-memory/fact-mutations.js";
import { readChapterSettlementRecord } from "../engine/narrative-memory/settlement-idempotency.js";
import { createRuntimeChapterEventExtractor } from "../engine/narrative-memory/chapter-event-extractor.js";
import { loadForeshadowStates } from "../engine/narrative-taxonomy/foreshadow-states.js";
import { upsertLedgerEntry } from "./jingwei-ledger-store.js";
import { settleConfirmedChapter } from "./chapter-settlement-service.js";
import { handleChapterDiscardRange } from "./chapter-discard-range.js";

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

/** 伏笔的权威是经纬条目：结算事件只作推进证据，阶段由条目 + 事件派生。 */
async function createForeshadowStorage(): Promise<StorageDatabase> {
  const storage = await createSummaryStorage();
  upsertLedgerEntry(storage, {
    bookId: "book-1",
    category: "foreshadowing",
    title: "小瓶",
    contentMd: "瓶中绿液",
    fields: { status: "已埋设" },
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

  it("writes explicit hook causes and derives the foreshadow phase from settlement events", async () => {
    const storage = await createForeshadowStorage();
    try {
      const plantedContent = "他发现瓶中绿液能催熟药草。";
      await settleConfirmedChapter({
        bookId: "book-1",
        chapterNumber: 3,
        content: plantedContent,
      }, {
        storage,
        llmExtractor: async () => [{
          eventType: "hook_planted",
          subject: "小瓶",
          predicate: "埋设",
          object: "瓶中绿液能催熟药草",
          evidenceText: plantedContent,
          confidence: 0.9,
          source: "settle",
        }],
      });

      const progressedContent = "药园试验开始，绿液催熟药草。";
      const result = await settleConfirmedChapter({
        bookId: "book-1",
        chapterNumber: 8,
        content: progressedContent,
      }, {
        storage,
        llmExtractor: async () => [{
          eventType: "hook_progressed",
          subject: "小瓶",
          predicate: "推进",
          object: "药园试验",
          evidenceText: progressedContent,
          confidence: 0.9,
          source: "settle",
          causedBy: ["小瓶"],
        }],
      });

      expect(result.status).toBe("completed");
      const progressed = storage.sqlite.prepare<{ causedByJson: string | null }>(
        `SELECT caused_by_json AS causedByJson FROM narrative_event WHERE event_type = 'hook_progressed' LIMIT 1`,
      ).get();
      expect(progressed?.causedByJson).toContain("chapter-settle");
      expect(loadForeshadowStates(storage, "book-1")).toEqual([
        expect.objectContaining({ label: "小瓶", phase: "reinforced", setupChapter: 3 }),
      ]);
    } finally {
      storage.close();
    }
  });

  it("derives CFPG triggered when the trigger condition event appears", async () => {
    const storage = await createForeshadowStorage();
    try {
      const plantedContent = "他发现瓶中绿液能催熟药草。";
      await settleConfirmedChapter({
        bookId: "book-1",
        chapterNumber: 3,
        content: plantedContent,
      }, {
        storage,
        llmExtractor: async () => [{
          eventType: "hook_planted",
          subject: "小瓶",
          predicate: "埋设",
          object: "瓶中绿液能催熟药草",
          evidenceText: plantedContent,
          confidence: 0.9,
          source: "settle",
        }],
      });

      const triggeredContent = "药园试验开始，绿液催熟药草。";
      const result = await settleConfirmedChapter({
        bookId: "book-1",
        chapterNumber: 8,
        content: triggeredContent,
      }, {
        storage,
        llmExtractor: async () => [{
          eventType: "hook_triggered",
          subject: "小瓶",
          predicate: "触发",
          object: "药园试验开始",
          evidenceText: triggeredContent,
          confidence: 0.9,
          source: "settle",
          causedBy: ["小瓶"],
        }],
      });

      expect(result.status).toBe("completed");
      expect(loadForeshadowStates(storage, "book-1")).toEqual([
        expect.objectContaining({
          label: "小瓶",
          phase: "triggered",
          triggerChapter: 8,
          triggerCondition: "药园试验开始",
        }),
      ]);
      const scores = storage.sqlite.prepare<{ featureId: string; numericValue: number }>(`
        SELECT feature_id AS featureId, numeric_value AS numericValue
        FROM narrative_structure_score
        WHERE book_id = 'book-1' AND chapter_number = 8
        ORDER BY feature_id
      `).all();
      expect(scores.map((row) => row.featureId)).toEqual(["EVT_CAU_002", "EVT_TML_001", "PLT_MOR_002", "PLT_TRG_001"]);
      expect(scores.find((row) => row.featureId === "EVT_CAU_002")?.numericValue).toBe(1);
      expect(scores.find((row) => row.featureId === "PLT_TRG_001")?.numericValue).toBe(1);
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

  it("改写掉某段情节后，旧正文派生的事实不再保持 open，不进入写作上下文（T-14①）", async () => {
    const storage = await createStorage();
    try {
      await settle(storage);
      const beforeRewrite = storage.sqlite
        .prepare<{ count: number }>("SELECT COUNT(*) AS count FROM narrative_fact WHERE object = ? AND valid_until_chapter IS NULL")
        .get("药园")?.count;
      expect(beforeRewrite).toBe(1);

      // 改写：这段「韩立抵达药园」被删掉，正文不再支持它。抽取结果为空，没有同槽位的新值替代它。
      const resettled = await settle(storage, { content: "韩立在山间独坐，良久未语。" });
      expect(resettled.status).toBe("completed");
      expect(resettled.idempotency).toMatchObject({ outcome: "resettled" });

      const stillOpen = storage.sqlite
        .prepare<{ count: number }>("SELECT COUNT(*) AS count FROM narrative_fact WHERE object = ? AND valid_until_chapter IS NULL")
        .get("药园")?.count;
      expect(stillOpen).toBe(0);

      // 关键：断言写作上下文真正看见的结果。写第 13 章时（currentChapter=13）旧事实不得出现。
      const visibleToNextChapter = queryNarrativeFacts(storage, {
        bookId: "book-1",
        currentChapter: 13,
        limit: 0,
      }).filter((fact) => fact.object === "药园");
      expect(visibleToNextChapter).toHaveLength(0);
    } finally {
      storage.close();
    }
  });

  it("作废旧机器派生时不误伤作者手动录入的事实（T-14①边界）", async () => {
    const storage = await createStorage();
    try {
      await settle(storage);
      // 作者手动录入一条与机器派生无关槽位的事实：它是权威值，不由结算产生，不得被作废。
      const manual = createManualNarrativeFact(storage, {
        bookId: "book-1",
        subject: "韩立",
        predicate: "身份",
        object: "散修",
        category: "character_state",
        validFromChapter: 12,
      });
      expect(manual.ok).toBe(true);

      // 改写掉机器派生的情节（抽取为空，没有同槽位新值）。
      const resettled = await settle(storage, { content: "韩立在山间独坐，良久未语。" });
      expect(resettled.status).toBe("completed");

      // 手动事实仍然 open，且写第 13 章时仍然可见。
      const manualOpen = storage.sqlite
        .prepare<{ count: number }>("SELECT COUNT(*) AS count FROM narrative_fact WHERE source_type = 'manual' AND object = ? AND valid_until_chapter IS NULL")
        .get("散修")?.count;
      expect(manualOpen).toBe(1);
      const visibleToNextChapter = queryNarrativeFacts(storage, {
        bookId: "book-1",
        currentChapter: 13,
        limit: 0,
      }).filter((fact) => fact.object === "散修");
      expect(visibleToNextChapter).toHaveLength(1);
    } finally {
      storage.close();
    }
  });
it("即使 manual 事实的 source_id 与旧台账事件碰撞，作废也只针对机器来源（T-14①防线）", async () => {
  const storage = await createStorage();
  try {
    await settle(storage);
    // 取得第一次结算写下的机器事件 id，并让一条 manual 事实的 source_id 与之碰撞。
    const machineEventId = storage.sqlite
      .prepare<{ id: string }>("SELECT id FROM narrative_event WHERE book_id = 'book-1' AND source = 'settle' LIMIT 1")
      .get()!.id;
    const manual = createManualNarrativeFact(storage, {
      bookId: "book-1",
      subject: "韩立",
      predicate: "身份",
      object: "散修",
      category: "character_state",
      validFromChapter: 12,
    });
    expect(manual.ok).toBe(true);
    storage.sqlite
      .prepare("UPDATE narrative_fact SET source_id = ? WHERE book_id = 'book-1' AND source_type = 'manual' AND object = ?")
      .run(machineEventId, "散修");

    // 改写掉机器派生：旧台账的 eventIds 包含 machineEventId，它会进入作废的候选集合。
    await settle(storage, { content: "韩立在山间独坐，良久未语。" });

    // 防线：manual 事实即使 source_id 碰撞，仍必须保持 open。
    const manualOpen = storage.sqlite
      .prepare<{ count: number }>("SELECT COUNT(*) AS count FROM narrative_fact WHERE source_type = 'manual' AND object = ? AND valid_until_chapter IS NULL")
      .get("散修")?.count;
    expect(manualOpen).toBe(1);
  } finally {
    storage.close();
  }
});

  describe("改写重结算只作废机器自动产生、作者没裁决过的旧事实（T-14①③）", () => {
    const LOCATION_DRAFT = {
      eventType: "location_changed",
      subject: "韩立",
      predicate: "抵达",
      object: "药园",
      evidenceText: "韩立抵达药园。",
      confidence: 0.92,
      source: "settle",
    };
    const WORLD_RULE_DRAFT = {
      eventType: "world_fact_introduced",
      subject: "世界规则",
      predicate: "改变",
      object: "灵根可被后天逆转",
      evidenceText: "韩立亲眼确认灵根可被后天逆转。",
      confidence: 0.92,
      source: "settle",
    };

    function openFactCount(storage: StorageDatabase, object: string): number {
      return storage.sqlite
        .prepare<{ count: number }>("SELECT COUNT(*) AS count FROM narrative_fact WHERE object = ? AND valid_until_chapter IS NULL")
        .get(object)?.count ?? 0;
    }

    it("作者批准过的旧事件，改写后其事实仍有效；同章机器自动应用的旧事实照常作废", async () => {
      const storage = await createStorage();
      try {
        const first = await settleConfirmedChapter({
          bookId: "book-1",
          chapterNumber: 12,
          content: "韩立抵达药园。\n韩立亲眼确认灵根可被后天逆转。",
          confirmedAt: "2026-07-02T00:00:00.000Z",
        }, { storage, llmExtractor: async () => [LOCATION_DRAFT, WORLD_RULE_DRAFT] });
        expect(first.status).toBe("completed");

        // 作者在面板里批准这条高风险待审事件（走真实批准路径），它的事实才写进记忆。
        const pendingId = storage.sqlite
          .prepare<{ id: string }>("SELECT id FROM narrative_event WHERE status = 'pending' LIMIT 1")
          .get()?.id;
        expect(pendingId).toBeTruthy();
        const { handleMemoryEvents } = await import("./lore-memory-boundary-handlers.js");
        const approved = await handleMemoryEvents({ bookId: "book-1", action: "approve", eventId: pendingId! }, storage);
        expect(approved.ok).toBe(true);
        expect(openFactCount(storage, "灵根可被后天逆转")).toBe(1);
        expect(openFactCount(storage, "药园")).toBe(1);

        // 改写：两段情节都不再被抽到。
        const resettled = await settleConfirmedChapter({
          bookId: "book-1",
          chapterNumber: 12,
          content: "韩立在山间独坐，良久未语。",
          confirmedAt: "2026-07-02T01:00:00.000Z",
        }, { storage, llmExtractor: async () => [] });
        expect(resettled.status).toBe("completed");

        // 作者批准过的事实是作者的裁决，改写重结算不得作废它。
        expect(openFactCount(storage, "灵根可被后天逆转"), "author-approved fact was retired by resettlement").toBe(1);
        // 机器自动应用、作者没碰过的旧事实照常作废。
        expect(openFactCount(storage, "药园")).toBe(0);
      } finally {
        storage.close();
      }
    });

    it("作废机器事实 G 后，被 G 关闭的旧值 F 重新打开，槽位不留空洞", async () => {
      const storage = await createStorage();
      try {
        await settleConfirmedChapter({
          bookId: "book-1",
          chapterNumber: 10,
          content: "【地点】韩立抵达洞府",
          confirmedAt: "2026-07-01T00:00:00.000Z",
        }, { storage, llmExtractor: markerExtractor("【地点】韩立抵达洞府") });
        await settle(storage);
        // 前置：第 12 章的「药园」关闭了第 10 章的「洞府」。
        expect(openFactCount(storage, "洞府")).toBe(0);
        expect(openFactCount(storage, "药园")).toBe(1);

        // 改写第 12 章：去药园这段被删掉，没有同槽位的新值。
        const resettled = await settle(storage, { content: "韩立在山间独坐，良久未语。" });
        expect(resettled.status).toBe("completed");

        expect(openFactCount(storage, "药园")).toBe(0);
        expect(openFactCount(storage, "洞府"), "predecessor closed by the retired fact must reopen").toBe(1);
        const visible = queryNarrativeFacts(storage, { bookId: "book-1", currentChapter: 13, limit: 0 })
          .filter((fact) => fact.subject === "韩立" && fact.predicate === "抵达")
          .map((fact) => fact.object);
        expect(visible).toEqual(["洞府"]);
      } finally {
        storage.close();
      }
    });

    it("被作者手动作废的旧值不会因为作废机器事实而复位", async () => {
      const storage = await createStorage();
      try {
        await settleConfirmedChapter({
          bookId: "book-1",
          chapterNumber: 10,
          content: "【地点】韩立抵达洞府",
          confirmedAt: "2026-07-01T00:00:00.000Z",
        }, { storage, llmExtractor: markerExtractor("【地点】韩立抵达洞府") });
        const caveFactId = storage.sqlite
          .prepare<{ id: string }>("SELECT id FROM narrative_fact WHERE object = '洞府'")
          .get()!.id;
        const { retireNarrativeFact } = await import("../engine/narrative-memory/fact-mutations.js");
        expect(retireNarrativeFact(storage, { bookId: "book-1", factId: caveFactId }).ok).toBe(true);

        await settle(storage);
        await settle(storage, { content: "韩立在山间独坐，良久未语。" });

        expect(openFactCount(storage, "洞府"), "author-retired fact must stay retired").toBe(0);
      } finally {
        storage.close();
      }
    });

    it("上一次结算来自旧版本、没有留下机器应用记录时，旧事实保留不动并如实告警", async () => {
      const storage = await createStorage();
      try {
        await settle(storage);
        // 模拟旧版本留下的证据链：没有机器应用记录这一项。
        const row = storage.sqlite
          .prepare<{ artifact_json: string }>("SELECT artifact_json FROM narrative_settlement_artifact WHERE chapter_number = 12")
          .get()!;
        const legacy = JSON.parse(row.artifact_json) as Record<string, unknown>;
        delete legacy.machineAppliedEventIds;
        storage.sqlite
          .prepare("UPDATE narrative_settlement_artifact SET artifact_json = ? WHERE chapter_number = 12")
          .run(JSON.stringify(legacy));

        const resettled = await settle(storage, { content: "韩立在山间独坐，良久未语。" });
        expect(resettled.status).toBe("completed");
        expect(openFactCount(storage, "药园")).toBe(1);
        expect(resettled.warnings.join("\n")).toMatch(/无法确认/u);
      } finally {
        storage.close();
      }
    });
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

  it("真实结算一章后删除该章，按章分区的记忆无孤儿残留（T-14②端到端）", async () => {
    const storage = await createSummaryStorage();
    const bookRoot = join(tmpdir(), `novelfork-t14-e2e-${crypto.randomUUID()}`);
    await mkdir(join(bookRoot, "chapters"), { recursive: true });
    tempDirs.push(bookRoot);
    try {
      // 真实结算第 12 章，不手工插入任何记忆行。
      const settled = await settleConfirmedChapter({
        bookId: "book-1",
        chapterNumber: 12,
        title: "药园试探",
        content: "【地点】韩立抵达药园",
        confirmedAt: "2026-07-02T00:00:00.000Z",
      }, { storage, llmExtractor: markerExtractor("【地点】韩立抵达药园") });
      expect(settled.status).toBe("completed");

      const countWhere = (sql: string) => storage.sqlite.prepare<{ count: number }>(sql).get()?.count ?? 0;
      // 前置：真实结算确实在四张按章表里留下了第 12 章的行，否则测试无意义。
      expect(countWhere("SELECT COUNT(*) AS count FROM narrative_chapter_settlement WHERE chapter_number = 12")).toBe(1);
      expect(countWhere("SELECT COUNT(*) AS count FROM narrative_settlement_artifact WHERE chapter_number = 12")).toBeGreaterThan(0);
      expect(countWhere("SELECT COUNT(*) AS count FROM narrative_event WHERE chapter_number = 12")).toBeGreaterThan(0);
      expect(countWhere("SELECT COUNT(*) AS count FROM narrative_fact WHERE source_chapter = 12")).toBeGreaterThan(0);

      const result = await handleChapterDiscardRange({
        bookId: "book-1",
        bookRoot,
        fromChapter: 12,
        toChapter: 12,
        confirm: true,
        storage,
      });
      expect(result.ok).toBe(true);

      // 删章后：按章分区的记忆表都不再有第 12 章的行。
      expect(countWhere("SELECT COUNT(*) AS count FROM narrative_chapter_settlement WHERE chapter_number = 12")).toBe(0);
      expect(countWhere("SELECT COUNT(*) AS count FROM narrative_settlement_artifact WHERE chapter_number = 12")).toBe(0);
      expect(countWhere("SELECT COUNT(*) AS count FROM narrative_chapter_mention WHERE chapter_number = 12")).toBe(0);
      expect(countWhere("SELECT COUNT(*) AS count FROM narrative_event WHERE chapter_number = 12")).toBe(0);
      expect(countWhere("SELECT COUNT(*) AS count FROM narrative_fact WHERE source_chapter = 12")).toBe(0);
    } finally {
      storage.close();
    }
  });

  it("删章后实体索引派生表（状态流水 / 关系边 / 事件参与者）不再含被删章内容（T-14④）", async () => {
    const storage = await createSummaryStorage();
    const bookRoot = join(tmpdir(), `novelfork-t14-entity-${crypto.randomUUID()}`);
    await mkdir(join(bookRoot, "chapters"), { recursive: true });
    tempDirs.push(bookRoot);
    try {
      for (const [category, title] of [["characters", "韩立"], ["characters", "厉飞雨"], ["locations", "药园"]] as const) {
        upsertLedgerEntry(storage, { bookId: "book-1", category, title, contentMd: title });
      }
      const settled = await settleConfirmedChapter({
        bookId: "book-1",
        chapterNumber: 12,
        content: "韩立抵达药园。\n韩立第一次把秘密交给厉飞雨保管。",
        confirmedAt: "2026-07-02T00:00:00.000Z",
      }, {
        storage,
        llmExtractor: async () => [
          { eventType: "location_changed", subject: "韩立", predicate: "抵达", object: "药园", evidenceText: "韩立抵达药园。", confidence: 0.92, source: "settle" },
          { eventType: "relationship_changed", subject: "韩立", predicate: "信任", object: "厉飞雨", evidenceText: "韩立第一次把秘密交给厉飞雨保管。", confidence: 0.92, source: "settle" },
        ],
      });
      expect(settled.status).toBe("completed");

      const countOf = (table: string) => storage.sqlite
        .prepare<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table} WHERE book_id = 'book-1'`)
        .get()?.count ?? 0;
      // 前置：结算后的整本重建确实写出了这三张派生表，否则测试无意义。
      expect(countOf("narrative_state_change")).toBeGreaterThan(0);
      expect(countOf("narrative_relation")).toBeGreaterThan(0);
      expect(countOf("narrative_event_participant")).toBeGreaterThan(0);

      const result = await handleChapterDiscardRange({ bookId: "book-1", bookRoot, fromChapter: 12, toChapter: 12, confirm: true, storage });
      expect(result.ok).toBe(true);

      expect({
        stateChanges: countOf("narrative_state_change"),
        relations: countOf("narrative_relation"),
        participants: countOf("narrative_event_participant"),
      }).toEqual({ stateChanges: 0, relations: 0, participants: 0 });
    } finally {
      storage.close();
    }
  });

  it("改写掉的情节不进入组装后的写作上下文（T-14①上下文级端到端）", async () => {
    const storage = await createSummaryStorage();
    try {
      // 第 12 章原正文：含「韩立抵达药园」，结算后该事实 open。
      await settleConfirmedChapter({
        bookId: "book-1",
        chapterNumber: 12,
        title: "药园试探",
        content: "【地点】韩立抵达药园",
        confirmedAt: "2026-07-02T00:00:00.000Z",
      }, { storage, llmExtractor: markerExtractor("【地点】韩立抵达药园") });

      const assemble = () => buildNarrativeContext({
        storage,
        bookId: "book-1",
        purpose: "write_chapter",
        chapterNumber: 13,
        entities: ["韩立"],
        maxTokens: 2000,
      });
      const cardText = (context: Awaited<ReturnType<typeof buildNarrativeContext>>) =>
        context.cards.map((card) => card.content).join("\n");

      // 对照（证明断言有鉴别力）：改写之前，旧元组确实会被召回进写作上下文。
      expect(cardText(await assemble())).toContain("韩立 抵达 药园");

      // 改写：删掉这段情节，正文不再支持它。抽取为空，没有同槽位新值替代。
      const resettled = await settleConfirmedChapter({
        bookId: "book-1",
        chapterNumber: 12,
        title: "药园试探",
        content: "韩立在山间独坐，良久未语。",
        confirmedAt: "2026-07-02T01:00:00.000Z",
      }, { storage, llmExtractor: markerExtractor("韩立在山间独坐，良久未语。") });
      expect(resettled.status).toBe("completed");
      expect(resettled.idempotency).toMatchObject({ outcome: "resettled" });

      // 被测行为：改写之后，同样的组装不再召回被改写掉的元组。
      expect(cardText(await assemble())).not.toContain("韩立 抵达 药园");
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

  it("模型输出被截断时如实说明原因，不记结算、不锁死同一正文", async () => {
    const storage = await createStorage();
    try {
      const result = await settleConfirmedChapter(
        { bookId: "book-1", chapterNumber: 7, content: "韩立抵达药园。" },
        { storage, llmExtractor: createRuntimeChapterEventExtractor(async () => ({ text: '{"events":[{"eventType":"location_changed"' })) },
      );

      expect(result).toMatchObject({ status: "failed", error: "settlement-extraction-failed" });
      expect(result.explanation?.whatHappened).toContain("截断");
      expect(result.explanation?.suggestedAction).toContain("重试");
      expect(readChapterSettlementRecord(storage, { bookId: "book-1", chapterNumber: 7 })).toBeUndefined();
    } finally {
      storage.close();
    }
  });
});
