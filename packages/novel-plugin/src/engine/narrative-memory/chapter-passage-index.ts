/**
 * 章节原文段落索引：让写作召回与叙述者能搜到「摘要和经纬都没记下」的正文细节
 * （第 47 章出现过的一件旧物、一句誓言）。
 *
 * 设计取舍：
 * - 章节文件是正文唯一权威源。这里只存「第几章、第几段、在正文里的码点偏移、整章 sha256」，
 *   以及 contentless FTS5 倒排索引（只有 bigram 词元，不存原文）。命中后按偏移回读章节文件出片段，
 *   因此库里不会多一份全文副本；读回时 sha256 对不上就当场重建该章索引、丢弃该命中。
 * - 分词：FTS5 默认 unicode61 把整段中文当一个词，trigram 漏掉 2 字人名，沿用经纬检索的
 *   bigram 方案（jingwei/search/grams.ts）：文档按字滑窗切 bigram，查询词转 phrase。
 *   bigram phrase 在标点边界有假阳性，调用方回读原文后再做字面校验。
 * - 与 narrative_* 家族一致走运行时 ensure schema，不进产品库迁移（纯派生索引，丢了可整本重建）。
 * - 偏移按码点计，与 chapter.read 的 offset / limit 同一口径，可直接拿去分段读原文。
 */

import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { isCjkChar, toGrams } from "../jingwei/search/grams.js";
import { listChapterFiles, type ChapterFileEntry } from "../writing-resource/chapter-layout.js";
import { proseSha256 } from "../writing-resource/prose-digest.js";

/** 段落窗口：凑够下限才收窗，不超过上限；超长段落按硬切长度切开并留少量重叠。 */
export const PASSAGE_MIN_CHARS = 300;
export const PASSAGE_MAX_CHARS = 600;
const PASSAGE_HARD_SPLIT_CHARS = 500;
const PASSAGE_SPLIT_OVERLAP_CHARS = 60;
/** 收窗后下一窗以上一窗末段开头（重叠一段），仅当末段足够短。 */
const PASSAGE_OVERLAP_PARAGRAPH_MAX = 120;

/** 新鲜度检查时并发 stat 的批大小。 */
const STAT_BATCH = 64;

const ensuredStorages = new WeakSet<object>();

export function ensureChapterPassageSchema(storage: StorageDatabase): void {
  if (ensuredStorages.has(storage.sqlite)) return;
  storage.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS narrative_chapter_passage_doc (
      book_id TEXT NOT NULL,
      chapter_number INTEGER NOT NULL,
      file_name TEXT,
      content_sha256 TEXT NOT NULL,
      file_size INTEGER,
      file_mtime_ms INTEGER,
      passage_count INTEGER NOT NULL,
      indexed_at TEXT NOT NULL,
      PRIMARY KEY (book_id, chapter_number)
    );

    CREATE TABLE IF NOT EXISTS narrative_chapter_passage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id TEXT NOT NULL,
      chapter_number INTEGER NOT NULL,
      ordinal INTEGER NOT NULL,
      start_offset INTEGER NOT NULL,
      end_offset INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_narrative_chapter_passage_book_chapter
      ON narrative_chapter_passage(book_id, chapter_number);

    -- contentless：只留倒排索引，不存原文；rowid = narrative_chapter_passage.id。
    -- book_key 是书 id 的哈希单词元，用来在 MATCH 里按书限定（bm25 权重 0）。
    CREATE VIRTUAL TABLE IF NOT EXISTS narrative_chapter_passage_fts USING fts5(
      book_key, grams,
      content='',
      contentless_delete=1
    );
  `);
  ensuredStorages.add(storage.sqlite);
}

/** 书 id → FTS 里的单个词元（字母数字），不同书不会因分词撞在一起。 */
export function passageBookKey(bookId: string): string {
  return `b${createHash("sha256").update(bookId, "utf8").digest("hex").slice(0, 24)}`;
}

export interface PassageSpan {
  /** 起止码点偏移，[start, end)。 */
  readonly start: number;
  readonly end: number;
}

function isBlank(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\r" || ch === "\u3000" || ch === "\uFEFF";
}

/** 按行切出非空段落（码点偏移），跳过开头的 frontmatter。 */
function paragraphSpans(codePoints: readonly string[]): PassageSpan[] {
  const lines: PassageSpan[] = [];
  let lineStart = 0;
  for (let index = 0; index <= codePoints.length; index += 1) {
    if (index === codePoints.length || codePoints[index] === "\n") {
      lines.push({ start: lineStart, end: index });
      lineStart = index + 1;
    }
  }
  const lineText = (span: PassageSpan) => codePoints.slice(span.start, span.end).join("").trim();
  let first = 0;
  if (lines.length > 0 && lineText(lines[0]!) === "---") {
    const close = lines.findIndex((line, index) => index > 0 && lineText(line) === "---");
    if (close > 0) first = close + 1;
  }
  const spans: PassageSpan[] = [];
  for (const line of lines.slice(first)) {
    let start = line.start;
    let end = line.end;
    while (start < end && isBlank(codePoints[start]!)) start += 1;
    while (end > start && isBlank(codePoints[end - 1]!)) end -= 1;
    if (end > start) spans.push({ start, end });
  }
  return spans;
}

/** 把一章正文切成段落窗口（约 300–600 字，相邻窗口少量重叠）。 */
export function splitChapterIntoPassages(content: string): PassageSpan[] {
  const codePoints = Array.from(content);
  const paragraphs = paragraphSpans(codePoints);
  const length = (span: PassageSpan) => span.end - span.start;
  const windows: PassageSpan[] = [];
  let index = 0;
  while (index < paragraphs.length) {
    const paragraph = paragraphs[index]!;
    if (length(paragraph) > PASSAGE_MAX_CHARS) {
      let start = paragraph.start;
      while (start < paragraph.end) {
        const end = Math.min(paragraph.end, start + PASSAGE_HARD_SPLIT_CHARS);
        windows.push({ start, end });
        if (end >= paragraph.end) break;
        start = end - PASSAGE_SPLIT_OVERLAP_CHARS;
      }
      index += 1;
      continue;
    }
    const start = paragraph.start;
    let end = paragraph.end;
    let next = index + 1;
    while (
      next < paragraphs.length
      && end - start < PASSAGE_MIN_CHARS
      && length(paragraphs[next]!) <= PASSAGE_MAX_CHARS
      && paragraphs[next]!.end - start <= PASSAGE_MAX_CHARS
    ) {
      end = paragraphs[next]!.end;
      next += 1;
    }
    windows.push({ start, end });
    const last = paragraphs[next - 1]!;
    const following = paragraphs[next];
    const overlap = next - index > 1
      && following !== undefined
      && length(last) <= PASSAGE_OVERLAP_PARAGRAPH_MAX
      && following.end - last.start <= PASSAGE_MAX_CHARS;
    index = overlap ? next - 1 : next;
  }
  return windows;
}

export function sliceCodePoints(content: string | readonly string[], start: number, end: number): string {
  const codePoints = typeof content === "string" ? Array.from(content) : content;
  return codePoints.slice(start, end).join("");
}

export interface IndexChapterPassagesOptions {
  readonly fileName?: string;
  readonly fileSize?: number;
  readonly fileMtimeMs?: number;
  readonly now?: Date;
}

function deleteChapterRows(storage: StorageDatabase, bookId: string, chapterNumber: number): number {
  const ids = storage.sqlite
    .prepare(`SELECT id FROM narrative_chapter_passage WHERE book_id = ? AND chapter_number = ?`)
    .all(bookId, chapterNumber) as Array<{ id: number }>;
  const removeFts = storage.sqlite.prepare(`DELETE FROM narrative_chapter_passage_fts WHERE rowid = ?`);
  for (const row of ids) removeFts.run(row.id);
  storage.sqlite.prepare(`DELETE FROM narrative_chapter_passage WHERE book_id = ? AND chapter_number = ?`).run(bookId, chapterNumber);
  return ids.length;
}

/** （重）建一章的段落索引；同一事务内先删后建，重复调用幂等。返回段数。 */
export function indexChapterPassages(
  storage: StorageDatabase,
  bookId: string,
  chapterNumber: number,
  content: string,
  options: IndexChapterPassagesOptions = {},
): number {
  ensureChapterPassageSchema(storage);
  const codePoints = Array.from(content);
  const spans = splitChapterIntoPassages(content);
  const bookKey = passageBookKey(bookId);
  const run = storage.sqlite.transaction(() => {
    deleteChapterRows(storage, bookId, chapterNumber);
    const insertPassage = storage.sqlite.prepare(`
      INSERT INTO narrative_chapter_passage (book_id, chapter_number, ordinal, start_offset, end_offset)
      VALUES (?, ?, ?, ?, ?)
    `);
    const insertFts = storage.sqlite.prepare(`INSERT INTO narrative_chapter_passage_fts (rowid, book_key, grams) VALUES (?, ?, ?)`);
    let count = 0;
    spans.forEach((span, ordinal) => {
      const grams = toGrams(codePoints.slice(span.start, span.end).join(""));
      if (!grams) return;
      const result = insertPassage.run(bookId, chapterNumber, ordinal, span.start, span.end);
      insertFts.run(Number(result.lastInsertRowid), bookKey, grams);
      count += 1;
    });
    storage.sqlite.prepare(`
      INSERT INTO narrative_chapter_passage_doc
        (book_id, chapter_number, file_name, content_sha256, file_size, file_mtime_ms, passage_count, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(book_id, chapter_number) DO UPDATE SET
        file_name = excluded.file_name,
        content_sha256 = excluded.content_sha256,
        file_size = excluded.file_size,
        file_mtime_ms = excluded.file_mtime_ms,
        passage_count = excluded.passage_count,
        indexed_at = excluded.indexed_at
    `).run(
      bookId,
      chapterNumber,
      options.fileName ?? null,
      proseSha256(content),
      options.fileSize ?? null,
      options.fileMtimeMs ?? null,
      count,
      (options.now ?? new Date()).toISOString(),
    );
    return count;
  });
  return run();
}

/**
 * 删章级联用：删掉范围内各章的段落索引，返回删掉的段数。
 * 不自开事务，由调用方放进自己的删章事务里（失败随删章一起回滚）。
 */
export function deleteChapterPassagesInRange(storage: StorageDatabase, bookId: string, fromChapter: number, toChapter: number): number {
  ensureChapterPassageSchema(storage);
  const chapters = storage.sqlite
    .prepare(`SELECT DISTINCT chapter_number AS chapterNumber FROM narrative_chapter_passage WHERE book_id = ? AND chapter_number BETWEEN ? AND ?`)
    .all(bookId, fromChapter, toChapter) as Array<{ chapterNumber: number }>;
  let removed = 0;
  for (const { chapterNumber } of chapters) removed += deleteChapterRows(storage, bookId, chapterNumber);
  storage.sqlite.prepare(`DELETE FROM narrative_chapter_passage_doc WHERE book_id = ? AND chapter_number BETWEEN ? AND ?`).run(bookId, fromChapter, toChapter);
  return removed;
}

interface PassageDocRow {
  chapterNumber: number;
  fileName: string | null;
  contentSha256: string;
  fileSize: number | null;
  fileMtimeMs: number | null;
}

function loadDocs(storage: StorageDatabase, bookId: string): Map<number, PassageDocRow> {
  const rows = storage.sqlite.prepare(`
    SELECT chapter_number AS chapterNumber, file_name AS fileName, content_sha256 AS contentSha256,
           file_size AS fileSize, file_mtime_ms AS fileMtimeMs
    FROM narrative_chapter_passage_doc WHERE book_id = ?
  `).all(bookId) as PassageDocRow[];
  return new Map(rows.map((row) => [row.chapterNumber, row]));
}

export interface PassageIndexFreshness {
  /** 磁盘上的章节数（同章号多个文件只算第一个）。 */
  readonly totalChapters: number;
  /** 本次检查前就已最新的章数。 */
  readonly upToDate: number;
  /** 本次（或 dryRun 下将要）重建索引的章号。 */
  readonly reindexed: readonly number[];
  /** 文件已不存在、本次（或将要）删掉索引的章号。 */
  readonly removed: readonly number[];
  /** 超出本次时间预算、尚未检查的章号；下次检索会接着补。 */
  readonly pending: readonly number[];
  readonly dryRun: boolean;
  readonly elapsedMs: number;
}

export interface EnsurePassageIndexOptions {
  /** 本次最多花多少毫秒补索引（缺省 1500）；超出的章留到下次。 */
  readonly budgetMs?: number;
  /** 只报告，不写库。 */
  readonly dryRun?: boolean;
}

export interface FreshPassageIndex extends PassageIndexFreshness {
  /** 章号 → 当前章节文件（检索命中后据此回读原文）。 */
  readonly files: ReadonlyMap<number, ChapterFileEntry>;
}

/**
 * 检索前的一致性检查与增量补建：
 * - 文件大小与修改时间都没变 → 视为最新（不读文件）；
 * - 有变化 → 读文件算 sha256，变了才重建该章，没变只刷新大小与时间；
 * - 索引里有、磁盘上已没有的章 → 删掉索引（删章、改章号、外部删除都兜得住）。
 * 首次检索时相当于整本回填，受 budgetMs 约束分批完成。
 */
export async function ensureBookPassageIndexFresh(
  storage: StorageDatabase,
  bookId: string,
  bookRoot: string,
  options: EnsurePassageIndexOptions = {},
): Promise<FreshPassageIndex> {
  const startedAt = performance.now();
  const budgetMs = options.budgetMs ?? 1500;
  const dryRun = options.dryRun === true;
  ensureChapterPassageSchema(storage);
  const listed = await listChapterFiles(bookRoot);
  const files = new Map<number, ChapterFileEntry>();
  for (const file of listed) if (!files.has(file.number)) files.set(file.number, file);
  const docs = loadDocs(storage, bookId);

  const removed = [...docs.keys()].filter((chapter) => !files.has(chapter)).sort((a, b) => a - b);
  if (!dryRun && removed.length > 0) {
    const run = storage.sqlite.transaction(() => {
      for (const chapter of removed) {
        deleteChapterRows(storage, bookId, chapter);
        storage.sqlite.prepare(`DELETE FROM narrative_chapter_passage_doc WHERE book_id = ? AND chapter_number = ?`).run(bookId, chapter);
      }
    });
    run();
  }

  let upToDate = 0;
  const reindexed: number[] = [];
  const pending: number[] = [];
  const ordered = [...files.values()].sort((a, b) => a.number - b.number);
  // stat 按批并发：逐章 await 时 1000 章光等 stat 就约 100ms，每次写前召回都要付一遍。
  const statInfo = new Map<number, Stats | null>();
  for (let offset = 0; offset < ordered.length; offset += STAT_BATCH) {
    if (performance.now() - startedAt > budgetMs) break;
    const batch = ordered.slice(offset, offset + STAT_BATCH);
    const infos = await Promise.all(batch.map((file) => stat(join(bookRoot, file.relativePath)).catch(() => null)));
    batch.forEach((file, index) => statInfo.set(file.number, infos[index] ?? null));
  }
  for (const file of ordered) {
    if (!statInfo.has(file.number) || performance.now() - startedAt > budgetMs) {
      pending.push(file.number);
      continue;
    }
    const path = join(bookRoot, file.relativePath);
    const info = statInfo.get(file.number);
    if (!info) continue;
    const size = info.size;
    const mtimeMs = Math.floor(info.mtimeMs);
    const doc = docs.get(file.number);
    if (doc && doc.fileSize === size && doc.fileMtimeMs === mtimeMs && doc.fileName === file.chapterRelativePath) {
      upToDate += 1;
      continue;
    }
    const content = await readFile(path, "utf8").catch(() => null);
    if (content === null) continue;
    if (doc && doc.contentSha256 === proseSha256(content)) {
      upToDate += 1;
      if (!dryRun) {
        storage.sqlite.prepare(`
          UPDATE narrative_chapter_passage_doc SET file_name = ?, file_size = ?, file_mtime_ms = ?
          WHERE book_id = ? AND chapter_number = ?
        `).run(file.chapterRelativePath, size, mtimeMs, bookId, file.number);
      }
      continue;
    }
    reindexed.push(file.number);
    if (!dryRun) {
      indexChapterPassages(storage, bookId, file.number, content, { fileName: file.chapterRelativePath, fileSize: size, fileMtimeMs: mtimeMs });
    }
  }

  return {
    totalChapters: files.size,
    upToDate,
    reindexed,
    removed,
    pending,
    dryRun,
    elapsedMs: Math.round(performance.now() - startedAt),
    files,
  };
}

// ─── 检索 ────────────────────────────────────────────────────────────────

/** 只当作功能字、组成的 bigram 区分度很低的常见字（按 bigram 召回时滤掉含这些字的词元）。 */
const LOW_SIGNAL_CHARS = new Set(Array.from("的了是在和与他她它们这那一个不就也都而及着过把被让给对从向说道又要会能没有我你上下中来去里到"));

function escapePhrase(grams: string): string {
  return `"${grams.replace(/"/gu, '""')}"`;
}

export interface PassageQueryTerm {
  readonly term: string;
  readonly phrase: string;
}

/** 查询词 → FTS phrase；单个汉字没有 bigram 可查，归入 ignored。 */
export function passageQueryTerms(terms: readonly string[]): { readonly terms: readonly PassageQueryTerm[]; readonly ignored: readonly string[] } {
  const seen = new Set<string>();
  const out: PassageQueryTerm[] = [];
  const ignored: string[] = [];
  for (const raw of terms) {
    const term = raw.trim();
    if (!term || seen.has(term)) continue;
    seen.add(term);
    const codePoints = Array.from(term);
    if (codePoints.length === 1 && isCjkChar(term)) {
      ignored.push(term);
      continue;
    }
    const grams = toGrams(term);
    if (!grams) {
      ignored.push(term);
      continue;
    }
    out.push({ term, phrase: escapePhrase(grams) });
  }
  return { terms: out, ignored };
}

/** 自由文本（蓝图、章纲）→ 有区分度的 bigram phrase（OR 召回用，bm25 的 IDF 负责把罕见词排前）。 */
export function passageBigramPhrases(text: string, cap = 48): string[] {
  const seen = new Set<string>();
  const phrases: string[] = [];
  for (const gram of toGrams(text).split(" ")) {
    const chars = Array.from(gram);
    if (chars.length !== 2 || !chars.every(isCjkChar) || chars.some((ch) => LOW_SIGNAL_CHARS.has(ch))) continue;
    if (seen.has(gram)) continue;
    seen.add(gram);
    phrases.push(escapePhrase(gram));
    if (phrases.length >= cap) break;
  }
  return phrases;
}

export interface PassageCandidate {
  readonly passageId: number;
  readonly chapterNumber: number;
  readonly startOffset: number;
  readonly endOffset: number;
  /** bm25 取正，越大越相关。 */
  readonly score: number;
}

export interface SearchPassageCandidatesInput {
  readonly bookId: string;
  /** phrase 列表；mode=all 时全部要命中，any 时任一命中。 */
  readonly phrases: readonly string[];
  readonly mode: "all" | "any";
  readonly fromChapter?: number;
  readonly toChapter?: number;
  readonly limit: number;
}

export function searchPassageCandidates(storage: StorageDatabase, input: SearchPassageCandidatesInput): PassageCandidate[] {
  if (input.phrases.length === 0 || input.limit <= 0) return [];
  ensureChapterPassageSchema(storage);
  const joined = input.phrases.join(input.mode === "all" ? " AND " : " OR ");
  const expr = `book_key : ${escapePhrase(passageBookKey(input.bookId))} AND grams : (${joined})`;
  const rows = storage.sqlite.prepare(`
    SELECT p.id AS passageId, p.chapter_number AS chapterNumber, p.start_offset AS startOffset, p.end_offset AS endOffset,
           bm25(narrative_chapter_passage_fts, 0.0, 1.0) * -1 AS score
    FROM narrative_chapter_passage_fts
    -- CROSS JOIN 固定 FTS 在外层：先 MATCH 出命中行，再按 rowid 回段落表。
    -- 普通 JOIN 时规划器会把段落表放外层（按书 + 章号区间走索引），对每一行再跑一遍 MATCH，
    -- 1000 章（4000 段）一次检索约 230ms，且随段落数线性涨；固定顺序后与段落总数基本无关。
    CROSS JOIN narrative_chapter_passage p ON p.id = narrative_chapter_passage_fts.rowid
    WHERE narrative_chapter_passage_fts MATCH ?
      AND p.book_id = ?
      AND p.chapter_number BETWEEN ? AND ?
    ORDER BY score DESC, p.chapter_number ASC, p.ordinal ASC
    LIMIT ?
  `).all(
    expr,
    input.bookId,
    input.fromChapter ?? 1,
    input.toChapter ?? Number.MAX_SAFE_INTEGER,
    input.limit,
  ) as PassageCandidate[];
  return rows;
}

export interface PassageText extends PassageCandidate {
  readonly text: string;
  readonly fileName: string;
}

/**
 * 按偏移回读命中段落的原文（每章只读一次文件）。读到的正文与索引时的 sha256 不一致时，
 * 当场按新正文重建该章索引并丢弃这些命中（偏移已不可信），staleChapters 里返回章号。
 */
export async function readPassageTexts(
  storage: StorageDatabase,
  bookId: string,
  bookRoot: string,
  candidates: readonly PassageCandidate[],
  files: ReadonlyMap<number, ChapterFileEntry>,
): Promise<{ readonly passages: PassageText[]; readonly staleChapters: number[] }> {
  const byChapter = new Map<number, PassageCandidate[]>();
  for (const candidate of candidates) {
    const list = byChapter.get(candidate.chapterNumber) ?? [];
    list.push(candidate);
    byChapter.set(candidate.chapterNumber, list);
  }
  const docs = loadDocs(storage, bookId);
  const texts = new Map<number, PassageText>();
  const staleChapters: number[] = [];
  for (const [chapterNumber, list] of byChapter) {
    const file = files.get(chapterNumber);
    if (!file) continue;
    const content = await readFile(join(bookRoot, file.relativePath), "utf8").catch(() => null);
    if (content === null) continue;
    if (docs.get(chapterNumber)?.contentSha256 !== proseSha256(content)) {
      staleChapters.push(chapterNumber);
      try {
        indexChapterPassages(storage, bookId, chapterNumber, content, { fileName: file.chapterRelativePath });
      } catch {
        // 重建失败只影响下次检索，本次照样丢弃这些命中。
      }
      continue;
    }
    const codePoints = Array.from(content);
    for (const candidate of list) {
      texts.set(candidate.passageId, {
        ...candidate,
        text: codePoints.slice(candidate.startOffset, candidate.endOffset).join(""),
        fileName: file.chapterRelativePath,
      });
    }
  }
  const passages = candidates.map((candidate) => texts.get(candidate.passageId)).filter((item): item is PassageText => Boolean(item));
  return { passages, staleChapters };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** 字面包含（英文不区分大小写）。 */
export function passageContains(text: string, term: string): boolean {
  return text.toLowerCase().includes(term.toLowerCase());
}

export interface PassageSnippet {
  /** 片段，命中词用【】标出。 */
  readonly snippet: string;
  /** 片段在章内的码点偏移（未加标记前），可直接作为 chapter.read 的 offset / limit。 */
  readonly offset: number;
  readonly length: number;
}

/**
 * 以第一个命中词为中心截一段不超过 maxChars 的片段，命中词加【】。
 * passageOffset 是段落在章内的起点，用于换算片段的章内偏移。
 */
export function buildPassageSnippet(text: string, passageOffset: number, hitTerms: readonly string[], maxChars: number): PassageSnippet {
  const codePoints = Array.from(text);
  const lowered = text.toLowerCase();
  const sorted = [...hitTerms].filter(Boolean).sort((a, b) => Array.from(b).length - Array.from(a).length);
  let anchor = 0;
  for (const term of sorted) {
    const index = lowered.indexOf(term.toLowerCase());
    if (index >= 0) {
      anchor = Array.from(text.slice(0, index)).length;
      break;
    }
  }
  const limit = Math.max(20, maxChars);
  let start = 0;
  let end = codePoints.length;
  if (codePoints.length > limit) {
    start = Math.max(0, Math.min(anchor - Math.floor(limit / 3), codePoints.length - limit));
    end = start + limit;
  }
  const raw = codePoints.slice(start, end).join("");
  const highlighted = sorted.length > 0
    ? raw.replace(new RegExp(sorted.map(escapeRegExp).join("|"), "giu"), (match) => `【${match}】`)
    : raw;
  return {
    snippet: `${start > 0 ? "…" : ""}${highlighted}${end < codePoints.length ? "…" : ""}`,
    offset: passageOffset + start,
    length: end - start,
  };
}

/**
 * 查询文本与段落共有的较长字面片段（≥3 个汉字，最多 8 个），用于没有点名实体时的命中校验与高亮：
 * bigram OR 召回只保证「有共同的两字词」，这里要求至少共享一个三字以上的连续片段，滤掉泛泛的撞词。
 */
export function sharedCjkPhrases(query: string, passage: string, minChars = 3, maxChars = 8): string[] {
  const segments = query.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff]+/gu) ?? [];
  const found = new Set<string>();
  for (const segment of segments) {
    const chars = Array.from(segment);
    let index = 0;
    while (index <= chars.length - minChars) {
      let matched = "";
      for (let size = Math.min(maxChars, chars.length - index); size >= minChars; size -= 1) {
        const piece = chars.slice(index, index + size).join("");
        if (passage.includes(piece)) {
          matched = piece;
          break;
        }
      }
      if (matched) {
        found.add(matched);
        index += Array.from(matched).length;
      } else {
        index += 1;
      }
    }
  }
  // 去掉被更长片段包含的短片段
  const list = [...found].sort((a, b) => b.length - a.length);
  return list.filter((item, index) => !list.slice(0, index).some((longer) => longer.includes(item)));
}
