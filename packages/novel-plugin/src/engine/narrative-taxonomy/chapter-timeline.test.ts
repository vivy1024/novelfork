import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createBookRepository } from "../jingwei/repositories/book-repo.js";
import { chapterContentFingerprint, ensureSettlementLedgerSchema } from "../narrative-memory/settlement-idempotency.js";
import { ensureNarrativeMemorySchema, replaceChapterMentions } from "../narrative-memory/storage.js";
import { chapterRelativePath, writeChapterIndex } from "../writing-resource/chapter-layout.js";
import { buildChapterTimeline, CHAPTER_TIMELINE_CAST_LIMIT } from "./chapter-timeline.js";

let storage: StorageDatabase;
let bookRoot: string;
let tempDir: string;

const chapterOne = "雨落在旧站台上。她把信封放进外套。";
const chapterTwo = "天亮之前，他终于走进了那座城。";
const chapterTwoEdited = `${chapterTwo}城头有人喊他的名字。`;

async function seedChapterIndex() {
  const entries = [
    { number: 1, title: "雨夜", fileName: chapterRelativePath("卷01", 1, "雨夜"), wordCount: 3200, updatedAt: "2026-09-28T00:00:00.000Z", contentHash: chapterContentFingerprint(chapterOne) },
    { number: 2, title: "入城", fileName: chapterRelativePath("卷01", 2, "入城"), wordCount: 3560, updatedAt: "2026-09-29T00:00:00.000Z", contentHash: chapterContentFingerprint(chapterTwoEdited) },
    { number: 3, title: "空章", fileName: chapterRelativePath("卷01", 3, "空章"), wordCount: 1200, updatedAt: "2026-09-30T00:00:00.000Z", contentHash: chapterContentFingerprint("还没结算的章。") },
  ];
  await writeChapterIndex(bookRoot, entries);
}

function recordSettlement(chapterNumber: number, content: string) {
  ensureSettlementLedgerSchema(storage);
  storage.sqlite.prepare(`
    INSERT INTO narrative_chapter_settlement (book_id, chapter_number, content_fingerprint, settled_at, settlement_count, event_ids_json)
    VALUES ('book-1', ?, ?, '2026-09-28T00:00:00.000Z', 1, '[]')
  `).run(chapterNumber, chapterContentFingerprint(content));
}

function insertSummary(options: { id: string; chapterNumber: number; summary: string; status: string; updatedAt: number }) {
  storage.sqlite.prepare(`
    INSERT INTO story_jingwei_section
      (id, book_id, key, name, description, "order", enabled, show_in_sidebar,
       participates_in_ai, default_visibility, fields_json, builtin_kind, source_template,
       created_at, updated_at, deleted_at)
    VALUES ('chapter-summaries:book-1', 'book-1', 'chapter-summaries', '章节摘要', '测试', 90, 1, 0,
            1, 'nested', '[]', 'chapter-summaries', NULL, 1755000000000, 1755000000000, NULL)
    ON CONFLICT (id) DO NOTHING
  `).run();
  storage.sqlite.prepare(`
    INSERT INTO story_jingwei_entry
      (id, book_id, section_id, title, content_md, tags_json, aliases_json, custom_fields_json,
       related_chapter_numbers_json, related_entry_ids_json, visibility_rule_json, participates_in_ai,
       category, fields_json, sort_order, lifecycle, layer, importance, source, revision_history,
       conflict_status, status, version, created_at, updated_at)
    VALUES
      (?, 'book-1', 'chapter-summaries:book-1', ?, ?, '[]', '[]', '{}', ?, '[]',
       '{"type":"nested"}', 1, 'chapter-summaries', ?, ?, 'active', 'dynamic', 70, 'auto-settle',
       '[]', 'none', ?, 1, ?, ?)
  `).run(
    options.id,
    `第${options.chapterNumber}章`,
    options.summary,
    JSON.stringify([options.chapterNumber]),
    JSON.stringify({ chapterNumber: options.chapterNumber, summary: options.summary }),
    options.chapterNumber,
    options.status,
    options.updatedAt,
    options.updatedAt,
  );
}

function insertEvent(id: string, chapterNumber: number, eventType: string, status: string) {
  ensureNarrativeMemorySchema(storage);
  storage.sqlite.prepare(`
    INSERT INTO narrative_event
      (id, book_id, chapter_number, event_type, subject, predicate, object, evidence_text,
       confidence, source, status, risk_level, created_at, applied_at)
    VALUES (?, 'book-1', ?, ?, '测试主体', '发生', '测试对象', '证据', 0.9, 'settle', ?, 'low',
            '2026-09-28T00:00:00.000Z', '2026-09-28T00:00:00.000Z')
  `).run(id, chapterNumber, eventType, status);
}

beforeEach(async () => {
  tempDir = join(tmpdir(), `novelfork-chapter-timeline-${crypto.randomUUID()}`);
  bookRoot = join(tempDir, "book-1");
  await mkdir(bookRoot, { recursive: true });
  await writeFile(join(bookRoot, "book.json"), JSON.stringify({ id: "book-1", title: "走势" }), "utf8");
  storage = createStorageDatabase({ databasePath: join(tempDir, "novelfork.db") });
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
  // 经纬条目表对 book 有外键：分区/条目落库前先把书落位。
  await createBookRepository(storage).create({
    id: "book-1",
    name: "走势",
    jingweiMode: "dynamic",
    currentChapter: 0,
    createdAt: new Date("2026-09-28T00:00:00.000Z"),
    updatedAt: new Date("2026-09-28T00:00:00.000Z"),
  });
});

afterEach(async () => {
  storage.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe("buildChapterTimeline", () => {
  it("按章聚合摘要（已确认优先于待审）、applied 事件计数、出场人物与过期标记", async () => {
    await seedChapterIndex();
    // 第 1 章结算后正文没动 → 新鲜；第 2 章结算的是旧正文 → 摘要过期；第 3 章未结算。
    recordSettlement(1, chapterOne);
    recordSettlement(2, chapterTwo);

    insertSummary({ id: "summary-1-pending", chapterNumber: 1, summary: "待审的第1章摘要。", status: "needs-review", updatedAt: 100 });
    insertSummary({ id: "summary-1-confirmed", chapterNumber: 1, summary: "已确认的雨夜摘要。", status: "confirmed", updatedAt: 90 });
    insertSummary({ id: "summary-2-confirmed", chapterNumber: 2, summary: "已确认的入城摘要。", status: "confirmed", updatedAt: 80 });

    insertEvent("e1", 1, "hook_planted", "applied");
    insertEvent("e2", 1, "location_changed", "applied");
    insertEvent("e3", 1, "hook_resolved", "pending"); // 待审不计数
    insertEvent("e4", 2, "hook_planted", "applied");
    insertEvent("e5", 2, "hook_resolved", "applied");
    insertEvent("e6", 2, "character_state_changed", "applied");

    // 第 1 章 8 个人物，position 决定顺序；截断到前 6 个。
    replaceChapterMentions(storage, "book-1", 1, Array.from({ length: 8 }, (_, index) => ({
      name: `人物${index + 1}`,
      entryId: index === 0 ? "entry-a" : undefined,
      position: index + 1,
      source: "dictionary" as const,
    })));
    replaceChapterMentions(storage, "book-1", 2, [
      { name: "林舟", entryId: "entry-linzhou", position: 5, source: "dictionary" as const },
      { name: "阿棠", position: 2, source: "dictionary" as const },
    ]);

    const timeline = await buildChapterTimeline(storage, "book-1", bookRoot);

    expect(timeline.settledThrough).toBe(2);
    expect(timeline.chapters).toHaveLength(3);

    const [first, second, third] = timeline.chapters;
    expect(first).toMatchObject({
      number: 1, title: "雨夜", volume: "卷01", chars: 3200,
      summary: "已确认的雨夜摘要。", summaryStale: false,
      eventCount: 2, plantedHooks: 1, recoveredHooks: 0,
      moreCast: 2,
    });
    expect(first?.cast).toHaveLength(CHAPTER_TIMELINE_CAST_LIMIT);
    expect(first?.cast[0]).toEqual({ name: "人物1", entryId: "entry-a" });

    expect(second).toMatchObject({
      number: 2, summary: "已确认的入城摘要。", summaryStale: true,
      eventCount: 3, plantedHooks: 1, recoveredHooks: 1, moreCast: 0,
    });
    // cast 按 position 升序，不按插入顺序。
    expect(second?.cast.map((member) => member.name)).toEqual(["阿棠", "林舟"]);

    expect(third).toMatchObject({
      number: 3, summary: null, summaryStale: false,
      eventCount: 0, plantedHooks: 0, recoveredHooks: 0, moreCast: 0,
    });
    expect(third?.cast).toEqual([]);
  });

  it("只有待审摘要时照样返回摘要文本", async () => {
    await seedChapterIndex();
    insertSummary({ id: "summary-1-pending", chapterNumber: 1, summary: "等作者确认的第1章摘要。", status: "needs-review", updatedAt: 100 });

    const timeline = await buildChapterTimeline(storage, "book-1", bookRoot);
    expect(timeline.chapters[0]?.summary).toBe("等作者确认的第1章摘要。");
    expect(timeline.settledThrough).toBeNull();
  });

  it("早期结算写进摘要的「# 第N章摘要」标题被剥掉，只留正文", async () => {
    await seedChapterIndex();
    insertSummary({ id: "summary-heading", chapterNumber: 2, summary: "# 第2章摘要：界面跃迁\n\n薛行之发现灵场监测界面背后的秘密。", status: "confirmed", updatedAt: 100 });

    const timeline = await buildChapterTimeline(storage, "book-1", bookRoot);
    expect(timeline.chapters[1]?.summary).toBe("薛行之发现灵场监测界面背后的秘密。");
    expect(timeline.chapters[1]?.summary).not.toContain("#");
  });

  it("没有章节索引或完全没有记忆数据时返回空骨架，不抛异常", async () => {
    const timeline = await buildChapterTimeline(storage, "book-1", bookRoot);
    expect(timeline).toEqual({ chapters: [], settledThrough: null });

    await seedChapterIndex();
    const sparse = await buildChapterTimeline(storage, "book-1", bookRoot);
    expect(sparse.chapters).toHaveLength(3);
    expect(sparse.chapters.every((chapter) => chapter.summary === null
      && chapter.eventCount === 0
      && chapter.cast.length === 0
      && !chapter.summaryStale)).toBe(true);
  });
});
