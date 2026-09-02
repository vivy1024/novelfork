/**
 * 本章提及回填：字典扫描正文 ∪ 既有事件 subject/object，写入 narrative_chapter_mention。
 *
 * 不调 LLM。表空时共现仍回落到事件；回填后共现优先吃这张表。
 *
 *   bun scripts/backfill-chapter-mentions.ts --dry-run
 *   bun scripts/backfill-chapter-mentions.ts --apply --book=这个世界修仙讲科学-e664adad
 */

import { Database } from "bun:sqlite";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { buildEntityDictionary } from "../packages/novel-plugin/src/engine/narrative-memory/entity-dictionary.ts";
import { collectChapterMentions } from "../packages/novel-plugin/src/engine/narrative-memory/chapter-mention.ts";
import { replaceChapterMentions } from "../packages/novel-plugin/src/engine/narrative-memory/storage.ts";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const BOOK_FILTER = args.find((arg) => arg.startsWith("--book="))?.slice("--book=".length);
const DB_PATH = args.find((arg) => arg.startsWith("--db="))?.slice("--db=".length)
  ?? join(homedir(), ".novelfork", "novelfork.db");

const CHAPTER_FILE = /^(\d{4})_.*\.(md|txt)$/u;

function listChapterFiles(bookRoot: string): Array<{ chapterNumber: number; path: string }> {
  const chaptersDir = join(bookRoot, "chapters");
  if (!existsSync(chaptersDir)) return [];
  const out: Array<{ chapterNumber: number; path: string }> = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const match = CHAPTER_FILE.exec(entry.name);
      if (!match) continue;
      out.push({ chapterNumber: Number(match[1]), path: full });
    }
  };
  walk(chaptersDir);
  return out.sort((left, right) => left.chapterNumber - right.chapterNumber);
}

function main(): void {
  const sqlite = new Database(DB_PATH);
  const storage = { sqlite } as never;
  const books = BOOK_FILTER
    ? sqlite.query(`SELECT book_id, book_root FROM book_runtime_bindings WHERE book_id = ?`).all(BOOK_FILTER) as Array<{ book_id: string; book_root: string }>
    : sqlite.query(`SELECT book_id, book_root FROM book_runtime_bindings`).all() as Array<{ book_id: string; book_root: string }>;

  if (books.length === 0) {
    console.log("没有可回填的绑定书籍。");
    return;
  }

  for (const book of books) {
    const dictionary = buildEntityDictionary(storage, book.book_id);
    const events = sqlite.query(
      `SELECT chapter_number AS chapterNumber, subject, object FROM narrative_event WHERE book_id = ?`,
    ).all(book.book_id) as Array<{ chapterNumber: number; subject: string; object: string }>;
    const eventsByChapter = new Map<number, string[]>();
    for (const event of events) {
      const bucket = eventsByChapter.get(event.chapterNumber) ?? [];
      if (event.subject) bucket.push(event.subject);
      if (event.object) bucket.push(event.object);
      eventsByChapter.set(event.chapterNumber, bucket);
    }

    const files = listChapterFiles(book.book_root);
    const counts: number[] = [];
    for (const file of files) {
      const content = readFileSync(file.path, "utf8");
      const mentions = collectChapterMentions({
        content,
        dictionary,
        eventNames: eventsByChapter.get(file.chapterNumber) ?? [],
      });
      counts.push(mentions.length);
      if (APPLY) replaceChapterMentions(storage, book.book_id, file.chapterNumber, mentions);
    }
    const avg = counts.length === 0 ? 0 : counts.reduce((sum, value) => sum + value, 0) / counts.length;
    const below = counts.filter((value) => value < 6).length;
    console.log(`${APPLY ? "已写入" : "干跑"} ${book.book_id}`);
    console.log(`  章数 ${counts.length}  平均提及 ${avg.toFixed(1)}  低于6章数 ${below}  最小 ${counts.length ? Math.min(...counts) : 0}`);
  }
}

main();
