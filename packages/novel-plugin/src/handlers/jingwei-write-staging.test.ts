import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  closeStorageDatabase,
  getStorageDatabase,
  initializeStorageDatabase,
  runStorageMigrations,
  type StorageDatabase,
} from "@vivy1024/novelfork-core";
import {
  ensureDissectionStagingSchema,
  insertDissectionStaging,
} from "../engine/jingwei/dissection-staging.js";
import { handleJingweiWrite } from "./jingwei-write-handler.js";

const tempDirs: string[] = [];
let storage: StorageDatabase;

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-jingwei-staging-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const database = initializeStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  runStorageMigrations(database);
  const now = Date.now();
  database.sqlite.prepare(
    `INSERT INTO book (id, name, jingwei_mode, current_chapter, created_at, updated_at)
     VALUES ('book-1', '测试书', 'dynamic', 0, ?, ?)`,
  ).run(now, now);
  ensureDissectionStagingSchema(database);
  return database;
}

function stage(title = "黑色小瓶", category = "foreshadowing", evidence = true) {
  if (!evidence) {
    const id = crypto.randomUUID();
    const now = Date.now();
    storage.sqlite.prepare(`
      INSERT INTO dissection_staging (
        id, book_id, kind, category, proposed_title, entry_key, aliases_json, source_refs_json,
        evidence_ranges_json, classification_reason, confidence, duplicate_candidates_json,
        status, participates_in_ai, content_md, fields_json, created_at, updated_at
      ) VALUES (?, 'book-1', ?, ?, ?, ?, '[]', '[]', '[]', '测试无证据候选', 0, '[]', 'needs-review', 0, ?, '{}', ?, ?)
    `).run(id, category, category, title, `${category}:${title}`, `- 权威内容：${title}`, now, now);
    return { id, bookId: "book-1", kind: category as "foreshadowing", category, proposedTitle: title, entryKey: `${category}:${title}`, aliases: [], sourceRefs: [], evidenceRanges: [], classificationReason: "测试无证据候选", confidence: 0, duplicateCandidates: [], status: "needs-review" as const, participatesInAi: false as const, contentMd: `- 权威内容：${title}`, fields: {}, createdAt: now, updatedAt: now };
  }
  return insertDissectionStaging(storage, {
    bookId: "book-1",
    kind: category as "foreshadowing",
    category,
    proposedTitle: title,
    sourceRefs: [{ chapterNumber: 1, excerpt: "正文证据" }],
    classificationReason: "拆书抽取候选",
    contentMd: `- 权威内容：${title}`,
    fields: { source: "book.dissect" },
  });
}

describe("jingwei.write staging promote/reject", () => {
  beforeEach(async () => {
    storage = await createStorage();
    expect(getStorageDatabase()).toBe(storage);
  });

  afterEach(async () => {
    closeStorageDatabase();
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  test("requires an explicit stagingDecision", async () => {
    const candidate = stage();
    const result = await handleJingweiWrite({ bookId: "book-1", stagingId: candidate.id, title: "被忽略" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("staging-decision-required");
  });

  test("rejects a candidate without evidence before the evidence gate", async () => {
    const candidate = stage("无证据候选", "foreshadowing", false);
    const result = await handleJingweiWrite({ bookId: "book-1", stagingId: candidate.id, stagingDecision: "reject" });
    expect(result.ok).toBe(true);
    const row = storage.sqlite.prepare(`SELECT status FROM dissection_staging WHERE id = ?`).get(candidate.id) as { status: string };
    expect(row.status).toBe("rejected");
  });

  test("promotes a staging candidate as authoritative data and creates the official entry", async () => {
    const candidate = stage();
    const result = await handleJingweiWrite({
      bookId: "book-1",
      stagingId: candidate.id,
      stagingDecision: "promote",
      title: "篡改标题",
      contentMd: "篡改内容",
      category: "rules",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.action).toBe("created");
    const entry = storage.sqlite.prepare(`SELECT title, content_md, status, participates_in_ai FROM story_jingwei_entry WHERE book_id = ?`).get("book-1") as { title: string; content_md: string; status: string; participates_in_ai: number };
    expect(entry.title).toBe("黑色小瓶");
    expect(entry.content_md).toContain("权威内容");
    expect(entry.status).toBe("confirmed");
    expect(entry.participates_in_ai).toBe(1);
    const stagingRow = storage.sqlite.prepare(`SELECT status FROM dissection_staging WHERE id = ?`).get(candidate.id) as { status: string };
    expect(stagingRow.status).toBe("accepted");
  });

  test("requires explicit entryId when multiple duplicate candidates exist", async () => {
    const candidate = insertDissectionStaging(storage, {
      bookId: "book-1",
      kind: "foreshadowing",
      category: "foreshadowing",
      proposedTitle: "暂存标题",
      sourceRefs: [{ chapterNumber: 2, excerpt: "证据" }],
      duplicateCandidates: [
        { entryId: "entry-1", title: "候选 1", reason: "alias" },
        { entryId: "entry-2", title: "候选 2", reason: "fuzzy" }
      ],
      classificationReason: "抽取",
      contentMd: "新内容",
    });
    
    // Attempt to promote without entryId
    const result = await handleJingweiWrite({ bookId: "book-1", stagingId: candidate.id, stagingDecision: "promote", title: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("duplicate-review-required");
    }
  });

  test("updates the duplicate official entry selected by staging with entryId", async () => {
    const created = await handleJingweiWrite({
      bookId: "book-1",
      action: "create",
      title: "黑色小瓶",
      category: "foreshadowing",
      layer: "dynamic",
      contentMd: "旧内容",
    });
    expect(created.ok).toBe(true);
    const entryId = (storage.sqlite.prepare(`SELECT id FROM story_jingwei_entry WHERE title = '黑色小瓶'`).get() as { id: string }).id;
    const candidate = insertDissectionStaging(storage, {
      bookId: "book-1",
      kind: "foreshadowing",
      category: "foreshadowing",
      proposedTitle: "完全不同的暂存标题",
      sourceRefs: [{ chapterNumber: 2, excerpt: "第二章证据" }],
      duplicateCandidates: [
        { entryId, title: "黑色小瓶", reason: "title" },
        { entryId: "other-id", title: "其他", reason: "alias" }
      ],
      classificationReason: "重新抽取",
      contentMd: "暂存的新权威内容",
    });
    const result = await handleJingweiWrite({ bookId: "book-1", stagingId: candidate.id, stagingDecision: "promote", title: "错误输入", entryId });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.action).toBe("updated");
      expect(result.data.entryId).toBe(entryId);
    }
    const rows = storage.sqlite.prepare(`SELECT id, title, content_md FROM story_jingwei_entry WHERE book_id = ?`).all("book-1") as Array<{ id: string; title: string; content_md: string }>;
    expect(rows.length).toBe(1);
    expect(rows[0]!.title).toBe("完全不同的暂存标题");
    expect(rows[0]!.content_md).toBe("暂存的新权威内容");
  });

  test("preserves entry_key, sourceRefs and aliases properly on promotion", async () => {
    const created = await handleJingweiWrite({
      bookId: "book-1",
      action: "create",
      title: "原名",
      category: "character",
      layer: "dynamic",
      contentMd: "旧内容",
      aliases: ["旧别名"],
    });
    expect(created.ok).toBe(true);
    // Directly update entry_key and sourceRefs (which can't be set via regular API currently)
    storage.sqlite.prepare(`UPDATE story_jingwei_entry SET entry_key = 'char:原名', source_refs_json = '[{"chapterNumber":1,"excerpt":"来源"}]' WHERE title = '原名'`).run();
    
    const entryId = (storage.sqlite.prepare(`SELECT id FROM story_jingwei_entry WHERE title = '原名'`).get() as { id: string }).id;
    
    const candidate = insertDissectionStaging(storage, {
      bookId: "book-1",
      kind: "character",
      category: "character",
      proposedTitle: "新名",
      entryKey: "char:原名", // SAME key
      aliases: ["新别名", "旧别名"],
      sourceRefs: [{ chapterNumber: 2, excerpt: "新来源" }],
      duplicateCandidates: [{ entryId, title: "原名", reason: "key" }],
      classificationReason: "重名",
      contentMd: "新内容",
    });
    
    const result = await handleJingweiWrite({ bookId: "book-1", stagingId: candidate.id, stagingDecision: "promote", title: "不相关" });
    expect(result.ok).toBe(true);
    
    const row = storage.sqlite.prepare(`SELECT entry_key, aliases_json, source_refs_json FROM story_jingwei_entry WHERE id = ?`).get(entryId) as any;
    expect(row.entry_key).toBe("char:原名");
    
    const aliases = JSON.parse(row.aliases_json);
    expect(aliases).toContain("旧别名");
    expect(aliases).toContain("新别名");
    
    const sourceRefs = JSON.parse(row.source_refs_json);
    expect(sourceRefs.length).toBe(2);
  });

  test("returns staging-not-pending on repeated processing", async () => {
    const candidate = stage();
    const first = await handleJingweiWrite({ bookId: "book-1", stagingId: candidate.id, stagingDecision: "reject" });
    expect(first.ok).toBe(true);
    const second = await handleJingweiWrite({ bookId: "book-1", stagingId: candidate.id, stagingDecision: "reject" });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toBe("staging-not-pending");
  });

  test("rolls back the official write when accepting staging fails", async () => {
    const candidate = stage();
    storage.sqlite.exec(`
      CREATE TRIGGER fail_official_insert BEFORE INSERT ON story_jingwei_entry
      BEGIN SELECT RAISE(FAIL, 'simulated-official-write-error'); END;
    `);
    const result = await handleJingweiWrite({ bookId: "book-1", stagingId: candidate.id, stagingDecision: "promote" });
    expect(result.ok).toBe(false);
    const entries = storage.sqlite.prepare(`SELECT id FROM story_jingwei_entry WHERE book_id = ?`).all("book-1") as Array<{ id: string }>;
    expect(entries).toHaveLength(0);
    const stagingRow = storage.sqlite.prepare(`SELECT status FROM dissection_staging WHERE id = ?`).get(candidate.id) as { status: string };
    expect(stagingRow.status).toBe("needs-review");
  });
});
