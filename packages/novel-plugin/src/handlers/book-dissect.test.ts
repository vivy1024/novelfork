import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import { ensureNarrativeMemorySchema } from "../engine/narrative-memory/storage.js";
import { extractDissectDraftFromTexts, handleBookDissect } from "./book-dissect.js";

// 不 mock core：handleBookDissect 全链路都接受显式 storage，
// mock 会跨测试文件泄漏（污染其他文件的 getStorageDatabase）。
let activeStorage: StorageDatabase | undefined;

const tempDirs: string[] = [];

async function createBook(chapters: Array<{ number: number; content: string }>) {
  const dir = join(tmpdir(), `novelfork-dissect-${crypto.randomUUID()}`);
  await mkdir(join(dir, "chapters"), { recursive: true });
  await mkdir(join(dir, "story"), { recursive: true });
  tempDirs.push(dir);
  await writeFile(join(dir, "book.json"), JSON.stringify({
    id: "book-1",
    title: "测试书",
    chapterWordCount: 3000,
    language: "zh",
    enabledPresetIds: [],
  }), "utf8");
  const index = [];
  for (const chapter of chapters) {
    const fileName = `${String(chapter.number).padStart(4, "0")}-ch.md`;
    await writeFile(join(dir, "chapters", fileName), chapter.content, "utf8");
    index.push({
      number: chapter.number,
      title: `第${chapter.number}章`,
      fileName,
      wordCount: chapter.content.length,
      status: "accepted",
    });
  }
  await writeFile(join(dir, "chapters", "index.json"), JSON.stringify(index), "utf8");
  activeStorage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  ensureNarrativeMemorySchema(activeStorage);
  activeStorage.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS story_jingwei_section (
      id TEXT PRIMARY KEY NOT NULL, book_id TEXT NOT NULL, key TEXT NOT NULL,
      name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', "order" INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1, show_in_sidebar INTEGER NOT NULL DEFAULT 1,
      participates_in_ai INTEGER NOT NULL DEFAULT 1, default_visibility TEXT NOT NULL DEFAULT 'tracked',
      fields_json TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS story_jingwei_entry (
      id TEXT PRIMARY KEY NOT NULL, book_id TEXT NOT NULL, section_id TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'setting', title TEXT NOT NULL, content_md TEXT NOT NULL DEFAULT '',
      summary_md TEXT, tags_json TEXT NOT NULL DEFAULT '[]', aliases_json TEXT NOT NULL DEFAULT '[]',
      custom_fields_json TEXT NOT NULL DEFAULT '{}', fields_json TEXT NOT NULL DEFAULT '{}',
      related_chapter_numbers_json TEXT NOT NULL DEFAULT '[]', related_entry_ids_json TEXT NOT NULL DEFAULT '[]',
      visibility_rule_json TEXT NOT NULL DEFAULT '{"type":"tracked"}', participates_in_ai INTEGER NOT NULL DEFAULT 1,
      token_budget INTEGER, layer TEXT NOT NULL DEFAULT 'dynamic', priority_tier TEXT DEFAULT 'auto',
      importance INTEGER NOT NULL DEFAULT 40, status TEXT DEFAULT 'confirmed', lifecycle TEXT NOT NULL DEFAULT 'active',
      sort_order INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    );
  `);
  return dir;
}

afterEach(async () => {
  activeStorage?.close();
  activeStorage = undefined;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("extractDissectDraftFromTexts", () => {
  it("extracts characters locations hooks and focus from sample prose", () => {
    const draft = extractDissectDraftFromTexts([
      {
        number: 1,
        title: "第一章",
        content: "韩立冷声道：「日后自有分晓。」\n他来到药园，不知为何心神不宁。",
      },
    ]);
    expect(draft.characters.some((name) => name.includes("韩立"))).toBe(true);
    expect(draft.locations).toContain("药园");
    expect(draft.hooks.length).toBeGreaterThan(0);
    expect(draft.suggestedFocus).toContain("第1章");
  });
});

describe("handleBookDissect", () => {
  it("returns draft without writing when apply=false", async () => {
    const bookRoot = await createBook([
      { number: 1, content: "【地点】韩立抵达药园\n厉飞雨笑道：「秘密不能说。」日后必有波澜。" },
    ]);
    const result = await handleBookDissect({
      bookId: "book-1",
      bookRoot,
      fromChapter: 1,
      toChapter: 1,
      apply: false,
      settle: true,
      storage: activeStorage,
    });
    expect(result.ok).toBe(true);
    expect(result.applied).toBe(false);
    expect(result.settled).toBe(true);
    expect(result.writtenFiles).toEqual([]);
    expect(result.draft.chapterSummaries.length).toBe(1);
  });

  it("writes into jingwei as dynamic needs-review when apply=true", async () => {
    const bookRoot = await createBook([
      { number: 1, content: "韩立走道药园，淡淡道：「将来再议。」殊不知小瓶另有秘密。" },
      { number: 2, content: "【地点】韩立回到洞府。秘密尚未揭开。" },
    ]);
    const result = await handleBookDissect({
      bookId: "book-1",
      bookRoot,
      apply: true,
      settle: true,
      storage: activeStorage,
    });
    expect(result.ok).toBe(true);
    expect(result.applied).toBe(true);

    // 权威源在经纬：全部 dynamic + needs-review，不进 canon
    const rows = activeStorage!.sqlite.prepare(
      `SELECT category, layer, status FROM story_jingwei_entry WHERE book_id = ?`,
    ).all("book-1") as Array<{ category: string; layer: string; status: string }>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.layer === "dynamic")).toBe(true);
    expect(rows.every((row) => row.status === "needs-review")).toBe(true);
    expect(rows.some((row) => row.category === "chapter-summaries")).toBe(true);

    // 不再写 pending_hooks.json / chapter_summaries.json 作权威
    expect(result.writtenFiles.some((file) => file.includes("pending_hooks.json"))).toBe(false);
    expect(result.writtenFiles.some((file) => file.includes("chapter_summaries.json"))).toBe(false);

    // 调试快照仍写
    const draftFile = await readFile(join(bookRoot, "story", "dissect_draft.json"), "utf8");
    expect(draftFile).toContain("book-1");
    expect(draftFile).toContain("权威源在经纬");
  });
});
