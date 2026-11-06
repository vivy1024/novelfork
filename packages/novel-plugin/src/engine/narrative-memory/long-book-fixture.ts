/**
 * 长篇召回测试夹具：造一本只含经纬章摘要条目与卷纲条目的书（默认 300 章 / 6 卷）。
 *
 * 只在测试里用；不进生产路径。章摘要走 chapter-summaries 分类（权威源），
 * 卷纲走 outline 分类「卷纲」条目的 fields_json.volumes（权威源）。
 * updated_at 故意与章号逆序（旧章后更新），复现「按 updated_at 粗筛会挤掉近章」的问题。
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { createBookRepository } from "../jingwei/repositories/book-repo.js";
import { createStoryJingweiEntryRepository } from "../jingwei/repositories/entry-repo.js";
import { createStoryJingweiSectionRepository } from "../jingwei/repositories/section-repo.js";
import { upsertNarrativeFact } from "./facts.js";
import { chapterContentFingerprint, ensureSettlementLedgerSchema } from "./settlement-idempotency.js";
import { ensureNarrativeMemorySchema } from "./storage.js";
import { ensureStoryTimeSchema, replaceChapterStoryTimeAnchors } from "./story-time.js";

export const LONG_BOOK_ID = "book-long";
const baseTime = new Date("2026-06-22T00:00:00.000Z").getTime();

export interface LongBookHandle {
  readonly storage: StorageDatabase;
  /** 书籍目录（临时目录下）；seedLongBookChapterFiles 往这里写章节文件。 */
  readonly bookRoot: string;
  readonly cleanup: () => Promise<void>;
}

export async function createLongBookStorage(prefix = "novelfork-long-book"): Promise<LongBookHandle> {
  const dir = join(tmpdir(), `${prefix}-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
  const now = new Date(baseTime);
  await createBookRepository(storage).create({
    id: LONG_BOOK_ID,
    name: "长篇测试书",
    jingweiMode: "dynamic",
    currentChapter: 300,
    createdAt: now,
    updatedAt: now,
  });
  return {
    storage,
    bookRoot: join(dir, "book"),
    cleanup: async () => {
      try {
        storage.close();
      } catch {
        // already closed
      }
      await rm(dir, { recursive: true, force: true });
    },
  };
}

async function ensureSection(storage: StorageDatabase, id: string, key: string, name: string): Promise<void> {
  const existing = storage.sqlite.prepare(`SELECT id FROM story_jingwei_section WHERE id = ?`).get(id);
  if (existing) return;
  const now = new Date(baseTime);
  await createStoryJingweiSectionRepository(storage).create({
    id,
    bookId: LONG_BOOK_ID,
    key,
    name,
    description: "",
    icon: null,
    order: 1,
    enabled: true,
    showInSidebar: true,
    participatesInAi: true,
    defaultVisibility: "global",
    fieldsJson: [],
    builtinKind: key,
    sourceTemplate: null,
    createdAt: now,
    updatedAt: now,
  });
}

/** 第 N 章摘要正文：首句带章号标记，便于断言「哪一章的内容进了召回」。 */
export function longBookSummaryText(chapter: number): string {
  return `第${chapter}章要事：主角在第${chapter}章完成关键一步。此后局势继续发酵，各方势力暗中调整布局，细节铺陈若干。`;
}

/**
 * updatedOrder：
 *   - "old-first"（默认）旧章 updated_at 更晚，模拟「回头修改旧章摘要」后的分布；
 *   - "new-first" 新章 updated_at 更晚，模拟「顺写到 300 章后回头修第 120 章」。
 */
export async function seedChapterSummaries(
  storage: StorageDatabase,
  totalChapters: number,
  updatedOrder: "old-first" | "new-first" = "old-first",
): Promise<void> {
  await ensureSection(storage, "sec-summary", "chapter-summary", "章节摘要");
  const repo = createStoryJingweiEntryRepository(storage);
  for (let chapter = 1; chapter <= totalChapters; chapter += 1) {
    const offset = updatedOrder === "old-first" ? totalChapters - chapter : chapter;
    const updatedAt = new Date(baseTime + offset * 60_000);
    await repo.create({
      id: `sum-${chapter}`,
      bookId: LONG_BOOK_ID,
      sectionId: "sec-summary",
      title: `第${chapter}章`,
      contentMd: longBookSummaryText(chapter),
      summaryMd: longBookSummaryText(chapter),
      tags: [],
      aliases: [],
      customFields: {},
      relatedChapterNumbers: [chapter],
      relatedEntryIds: [],
      visibilityRule: { type: "nested" },
      participatesInAi: true,
      tokenBudget: null,
      priorityTier: "reference",
      importance: 40,
      summaryL0: "",
      createdAt: updatedAt,
      updatedAt,
      category: "chapter-summaries",
      fields: { chapterNumber: chapter, title: `章${chapter}`, summary: longBookSummaryText(chapter) },
    });
  }
}

export async function seedVolumeOutline(storage: StorageDatabase, volumeCount: number, chaptersPerVolume: number): Promise<void> {
  await ensureSection(storage, "sec-outline", "outline", "卷纲/大纲");
  const volumes = Array.from({ length: volumeCount }, (_, index) => ({
    id: `vol-${index + 1}`,
    title: `第${index + 1}卷`,
    chapterRange: { from: index * chaptersPerVolume + 1, to: (index + 1) * chaptersPerVolume },
    goal: `第${index + 1}卷目标`,
    status: "planned",
  }));
  const now = new Date(baseTime);
  await createStoryJingweiEntryRepository(storage).create({
    id: "outline-volumes",
    bookId: LONG_BOOK_ID,
    sectionId: "sec-outline",
    title: "卷纲",
    contentMd: "",
    summaryMd: "",
    tags: [],
    aliases: [],
    customFields: {},
    relatedChapterNumbers: [],
    relatedEntryIds: [],
    visibilityRule: { type: "global" },
    participatesInAi: true,
    tokenBudget: null,
    priorityTier: "reference",
    importance: 40,
    summaryL0: "",
    createdAt: now,
    updatedAt: now,
    category: "outline",
    fields: { volumes },
  });
}

/** 一本 300 章 / 6 卷（每卷 50 章）的书。 */
export async function seedLongBook(storage: StorageDatabase, updatedOrder: "old-first" | "new-first" = "old-first"): Promise<void> {
  await seedChapterSummaries(storage, 300, updatedOrder);
  await seedVolumeOutline(storage, 6, 50);
}

export interface LongBookHookSeed {
  readonly id: string;
  readonly title: string;
  readonly plantedChapter: number;
  readonly contentMd?: string;
  /** 经纬条目 fields_json 额外字段（triggerKeywords / targetRange / importance 等）；老条目不传。 */
  readonly fields?: Record<string, unknown>;
  readonly importance?: number;
}

/** 写入一批经纬伏笔条目（foreshadowing 分类，已确认、参与 AI）。 */
export async function seedForeshadowHooks(storage: StorageDatabase, hooks: readonly LongBookHookSeed[]): Promise<void> {
  await ensureSection(storage, "sec-hooks", "foreshadowing", "伏笔");
  const repo = createStoryJingweiEntryRepository(storage);
  const now = new Date(baseTime);
  for (const hook of hooks) {
    await repo.create({
      id: hook.id,
      bookId: LONG_BOOK_ID,
      sectionId: "sec-hooks",
      title: hook.title,
      contentMd: hook.contentMd ?? `${hook.title}：第${hook.plantedChapter}章埋下，尚未回收。`,
      summaryMd: null,
      tags: [],
      aliases: [],
      customFields: {},
      relatedChapterNumbers: [hook.plantedChapter],
      relatedEntryIds: [],
      visibilityRule: { type: "tracked" },
      participatesInAi: true,
      tokenBudget: null,
      priorityTier: "relevant",
      importance: hook.importance ?? 40,
      summaryL0: null,
      createdAt: now,
      updatedAt: now,
      category: "foreshadowing",
      fields: { status: "已埋设", plantedChapter: hook.plantedChapter, ...(hook.fields ?? {}) },
    });
  }
}

/** 200 条与任何本章都无关、早早埋下又没推进的长线伏笔（「旧账 k」）。 */
export function dormantFillerHooks(count = 200): LongBookHookSeed[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `filler-${String(index + 1).padStart(3, "0")}`,
    title: `旧账${index + 1}`,
    plantedChapter: 1 + (index % 100),
    contentMd: `旧账${index + 1}：一件早年的小事，暂未交代。`,
  }));
}

/** 第 N 章的默认正文：几段普通叙事（主角名到处都有，用来测「太常见的词不算证据」）。 */
export function longBookChapterProse(chapter: number): string {
  return [
    `主角在第${chapter}章继续赶路，山道湿滑，风里带着松脂的味道。`,
    `同行的人说起城里的传闻，主角只是听着，没有接话。夜里他们在破庙歇脚，火堆噼啪作响。`,
    `天亮后雾气未散，主角收拾行囊，把干粮分给同伴，又沿着溪水往下游走了一程。`,
  ].join("\n\n");
}

/**
 * 按「chapters/卷NN/NNNN_标题.md」写章节文件（每卷 50 章）。overrides 给特定章换正文。
 */
export async function seedLongBookChapterFiles(
  bookRoot: string,
  totalChapters: number,
  overrides: Readonly<Record<number, string>> = {},
): Promise<void> {
  for (let chapter = 1; chapter <= totalChapters; chapter += 1) {
    const volume = `卷${String(Math.ceil(chapter / 50)).padStart(2, "0")}`;
    const dir = join(bookRoot, "chapters", volume);
    await mkdir(dir, { recursive: true });
    const body = overrides[chapter] ?? longBookChapterProse(chapter);
    await writeFile(join(dir, `${String(chapter).padStart(4, "0")}_章${chapter}.md`), `# 第${chapter}章\n\n${body}\n`, "utf8");
  }
}

// ---------------------------------------------------------------- 规模化合成书（百万字基准 / 300 章回归）

/** 合成书的人物与地点池（名字互不包含，便于检索断言）。 */
const SCALE_SURNAMES = ["慕容", "司马", "欧阳", "上官", "东方", "南宫", "诸葛", "令狐", "皇甫", "独孤"];
const SCALE_GIVEN = ["青云", "落雪", "长风", "听潮", "照夜", "寒江"];
export const SCALE_CHARACTERS = SCALE_SURNAMES.flatMap((surname) => SCALE_GIVEN.map((given) => `${surname}${given}`));
export const SCALE_LOCATIONS = ["临", "安", "平", "永", "宁", "广"].flatMap((head) => ["川", "陵", "州", "阳", "泽"].map((tail) => `${head}${tail}城`));
/** 第 N 章独有的线索词（纯数字段两侧是标点，分词后能按词组命中）。 */
export function scaleClue(chapter: number): string {
  return `信物${chapter}`;
}

/** 第 N 章合成正文：约 targetChars 字，按章轮换人物与地点，并带少量可检索的独特词。 */
export function scaleChapterProse(chapter: number, targetChars = 1000): string {
  const a = SCALE_CHARACTERS[chapter % SCALE_CHARACTERS.length]!;
  const b = SCALE_CHARACTERS[(chapter * 7 + 3) % SCALE_CHARACTERS.length]!;
  const place = SCALE_LOCATIONS[chapter % SCALE_LOCATIONS.length]!;
  const paragraphs = [
    `${a}在第${chapter}章来到${place}，城门下人来人往，叫卖声此起彼伏。他把斗笠压低，沿着青石街慢慢走。`,
    `${b}早在茶楼等候，见他进来只点了点头。两人说起旧事，窗外雨声渐密，檐角的铜铃被风吹得叮当作响。`,
    `夜里${a}独自翻看那卷残谱，第${chapter}页的批注写着“${scaleClue(chapter)}”藏于井底，他记下这句，没有声张。`,
  ];
  const parts: string[] = [];
  let length = 0;
  let round = 0;
  while (length < targetChars) {
    const paragraph = `${paragraphs[round % paragraphs.length]!}${round >= paragraphs.length ? `（续${round}）` : ""}`;
    parts.push(paragraph);
    length += paragraph.length;
    round += 1;
  }
  return parts.join("\n\n");
}

export interface ScaleBookOptions {
  readonly chapters: number;
  /** 每章正文字数（默认 1000；百万字基准用 1000 章 × 1000 字）。 */
  readonly charsPerChapter?: number;
  readonly chaptersPerVolume?: number;
  /** 每章事实 / 事件条数（默认 6）。 */
  readonly factsPerChapter?: number;
  /** 伏笔条数（默认 chapters / 4）。 */
  readonly hooks?: number;
  /** 写章节文件（段落检索、对账需要）；默认 true。 */
  readonly writeFiles?: boolean;
}

export interface ScaleBookSeedStats {
  readonly chapters: number;
  readonly totalChars: number;
  readonly facts: number;
  readonly events: number;
  readonly hooks: number;
  readonly entities: number;
  readonly seedMs: number;
}

/**
 * 规模化合成书：章节文件 + 经纬（章摘要 / 卷纲 / 人物 / 地点 / 伏笔）+ 已应用事件与事实 + 出场 + 结算台账 + 时间锚。
 * 事件 / 事实 / 台账直接批量写 SQL（一个事务），只为造数据快；读取路径走被测的真实代码。
 */
export async function seedScaleBook(handle: LongBookHandle, options: ScaleBookOptions): Promise<ScaleBookSeedStats> {
  const started = performance.now();
  const { storage, bookRoot } = handle;
  const chapters = options.chapters;
  const perVolume = options.chaptersPerVolume ?? 50;
  const factsPerChapter = options.factsPerChapter ?? 6;
  const hookCount = options.hooks ?? Math.floor(chapters / 4);
  const chars = options.charsPerChapter ?? 1000;

  storage.sqlite.prepare(`UPDATE book SET current_chapter = ? WHERE id = ?`).run(chapters, LONG_BOOK_ID);
  await seedChapterSummaries(storage, chapters, "new-first");
  await seedVolumeOutline(storage, Math.ceil(chapters / perVolume), perVolume);
  await seedForeshadowHooks(storage, Array.from({ length: hookCount }, (_, index) => ({
    id: `scale-hook-${index + 1}`,
    title: scaleClue(index * 4 + 1),
    plantedChapter: index * 4 + 1,
    fields: { triggerKeywords: [scaleClue(index * 4 + 1)] },
  })));
  await ensureSection(storage, "sec-characters", "characters", "人物");
  await ensureSection(storage, "sec-locations", "locations", "地点");
  const repo = createStoryJingweiEntryRepository(storage);
  const now = new Date(baseTime);
  const entityEntries = [
    ...SCALE_CHARACTERS.map((name, index) => ({ id: `scale-char-${index + 1}`, sectionId: "sec-characters", title: name, category: "characters" })),
    ...SCALE_LOCATIONS.map((name, index) => ({ id: `scale-loc-${index + 1}`, sectionId: "sec-locations", title: name, category: "locations" })),
  ];
  for (const entry of entityEntries) {
    await repo.create({
      id: entry.id, bookId: LONG_BOOK_ID, sectionId: entry.sectionId, title: entry.title, contentMd: entry.title, summaryMd: null,
      tags: [], aliases: [], customFields: {}, relatedChapterNumbers: [], relatedEntryIds: [], visibilityRule: { type: "tracked" },
      participatesInAi: true, tokenBudget: null, priorityTier: "relevant", importance: 50, summaryL0: null,
      createdAt: now, updatedAt: now, category: entry.category, fields: {},
    });
  }
  const charId = (name: string) => `scale-char-${SCALE_CHARACTERS.indexOf(name) + 1}`;
  const locId = (name: string) => `scale-loc-${SCALE_LOCATIONS.indexOf(name) + 1}`;

  ensureNarrativeMemorySchema(storage);
  ensureSettlementLedgerSchema(storage);
  const insertEvent = storage.sqlite.prepare(`
    INSERT INTO narrative_event (id, book_id, chapter_number, event_type, subject, predicate, object, evidence_text, confidence, source, status, risk_level, subject_entry_id, object_entry_id, created_at, applied_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0.9, 'settle', 'applied', 'low', ?, ?, ?, ?)
  `);
  const insertMention = storage.sqlite.prepare(`
    INSERT OR IGNORE INTO narrative_chapter_mention (book_id, chapter_number, position, entity_name, entry_id, source) VALUES (?, ?, ?, ?, ?, 'llm')
  `);
  const insertLedger = storage.sqlite.prepare(`
    INSERT OR REPLACE INTO narrative_chapter_settlement (book_id, chapter_number, content_fingerprint, settled_at, settlement_count, event_ids_json)
    VALUES (?, ?, ?, '2026-10-01T00:00:00.000Z', 1, ?)
  `);
  let facts = 0;
  let events = 0;
  const bodies = new Map<number, string>();
  storage.sqlite.transaction(() => {
    for (let chapter = 1; chapter <= chapters; chapter += 1) {
      const body = scaleChapterProse(chapter, chars);
      bodies.set(chapter, body);
      const at = new Date(baseTime + chapter * 60_000).toISOString();
      const a = SCALE_CHARACTERS[chapter % SCALE_CHARACTERS.length]!;
      const b = SCALE_CHARACTERS[(chapter * 7 + 3) % SCALE_CHARACTERS.length]!;
      const place = SCALE_LOCATIONS[chapter % SCALE_LOCATIONS.length]!;
      const ids: string[] = [];
      for (let k = 0; k < factsPerChapter; k += 1) {
        const id = `scale-ev-${chapter}-${k}`;
        ids.push(id);
        const kind = k % 3;
        if (kind === 0) insertEvent.run(id, LONG_BOOK_ID, chapter, "location_changed", a, "所在", place, `${a}在第${chapter}章来到${place}`, charId(a), locId(place), at, at);
        else if (kind === 1) insertEvent.run(id, LONG_BOOK_ID, chapter, "relationship_changed", a, `第${k}次会面`, b, `${b}早在茶楼等候`, charId(a), charId(b), at, at);
        else insertEvent.run(id, LONG_BOOK_ID, chapter, "character_state_changed", b, "境界", `第${Math.floor(chapter / 20) + 1}重`, `${b}早在茶楼等候`, charId(b), null, at, at);
        events += 1;
        // 事实：同槽位新值关闭旧值（valid_until），模拟真实台账的开闭分布
        const category = kind === 0 ? "location" : kind === 1 ? "relationship" : "character_state";
        const subject = kind === 2 ? b : a;
        const predicate = kind === 0 ? "所在" : kind === 1 ? `第${k}次会面` : "境界";
        const object = kind === 0 ? place : kind === 1 ? b : `第${Math.floor(chapter / 20) + 1}重`;
        upsertNarrativeFact(storage, {
          id: `scale-fact-${chapter}-${k}`, bookId: LONG_BOOK_ID, subject, predicate, object, category, layer: "dynamic", confidence: 0.9,
          sourceType: "event", sourceId: id, sourceChapter: chapter, validFromChapter: chapter,
          ...(chapter < chapters - 30 && kind !== 1 ? { validUntilChapter: chapter + 1 } : {}),
          evidenceText: `第${chapter}章`, createdAt: at, updatedAt: at,
          ...(kind === 2 ? { subjectEntryId: charId(b) } : { subjectEntryId: charId(a) }),
        });
        facts += 1;
      }
      [a, b, place].forEach((name, position) => insertMention.run(LONG_BOOK_ID, chapter, position, name, name === place ? locId(place) : charId(name)));
      insertLedger.run(LONG_BOOK_ID, chapter, chapterContentFingerprint(`# 第${chapter}章\n\n${body}\n`), JSON.stringify(ids));
    }
  })();
  ensureStoryTimeSchema(storage);
  storage.sqlite.transaction(() => {
    for (let chapter = 1; chapter <= chapters; chapter += 1) {
      replaceChapterStoryTimeAnchors(storage, LONG_BOOK_ID, chapter, chapter % 10 === 0
        ? [{ kind: "deadline", expression: "三日后决战", evidenceText: "三日后", confidence: 0.8, offsetDays: 3, event: `决战${chapter}` }]
        : [{ kind: "relative", expression: "次日", evidenceText: "次日", confidence: 0.9, offsetDays: 1 }]);
    }
  })();

  if (options.writeFiles !== false) {
    await seedLongBookChapterFiles(bookRoot, chapters, Object.fromEntries(bodies));
  }
  let totalChars = 0;
  for (const body of bodies.values()) totalChars += body.length;
  return { chapters, totalChars, facts, events, hooks: hookCount, entities: entityEntries.length, seedMs: Math.round(performance.now() - started) };
}

