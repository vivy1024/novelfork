import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";
import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { createBookRepository } from "../engine/jingwei/repositories/book-repo.js";
import { softDeleteLedgerEntry, upsertLedgerEntry, type LedgerStaleWriteInfo } from "./jingwei-ledger-store.js";

const tempDirs: string[] = [];
const storages: StorageDatabase[] = [];

async function setup(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-ledger-revision-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  storages.push(storage);
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
  const now = new Date("2026-08-05T00:00:00.000Z");
  await createBookRepository(storage).create({
    id: "book-1",
    name: "账本测试",
    jingweiMode: "dynamic",
    currentChapter: 1,
    createdAt: now,
    updatedAt: now,
  });
  return storage;
}

afterEach(async () => {
  for (const storage of storages.splice(0)) storage.close();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Jingwei ledger revision authority", () => {
  it("records a complete snapshot before overwrite and mirrors canonical fields", async () => {
    const storage = await setup();
    upsertLedgerEntry(storage, {
      bookId: "book-1",
      category: "outline",
      title: "卷纲",
      contentMd: "旧卷纲",
      fields: { volumes: [{ number: 1, title: "旧卷" }] },
      now: () => new Date("2026-08-05T01:00:00.000Z"),
    });
    const updated = upsertLedgerEntry(storage, {
      bookId: "book-1",
      category: "outline",
      title: "卷纲",
      contentMd: "新卷纲",
      fields: { volumes: [{ number: 1, title: "新卷" }] },
      reason: "outline-update",
      changedBy: "auto-settle",
      now: () => new Date("2026-08-05T02:00:00.000Z"),
    });

    const row = storage.sqlite.prepare<{ fields_json: string; custom_fields_json: string; version: number }>(`
      SELECT fields_json, custom_fields_json, version FROM story_jingwei_entry WHERE id = ?
    `).get(updated.id)!;
    expect(JSON.parse(row.fields_json)).toEqual({ volumes: [{ number: 1, title: "新卷" }] });
    expect(JSON.parse(row.custom_fields_json)).toEqual(JSON.parse(row.fields_json));
    expect(row.version).toBe(2);

    const revision = storage.sqlite.prepare<{ snapshot_json: string; reason: string; changed_by: string }>(`
      SELECT snapshot_json, reason, changed_by FROM jingwei_revision WHERE entry_id = ? ORDER BY created_at DESC LIMIT 1
    `).get(updated.id)!;
    expect(revision).toMatchObject({ reason: "outline-update", changed_by: "auto-settle" });
    expect(JSON.parse(revision.snapshot_json)).toMatchObject({
      contentMd: "旧卷纲",
      category: "outline",
      fields: { volumes: [{ number: 1, title: "旧卷" }] },
    });
  });

  it("records the current ledger state before soft deletion", async () => {
    const storage = await setup();
    const entry = upsertLedgerEntry(storage, {
      bookId: "book-1",
      category: "foreshadowing",
      title: "青铜铃",
      contentMd: "尚未回收",
      fields: { status: "planted" },
      now: () => new Date("2026-08-05T01:00:00.000Z"),
    });

    expect(softDeleteLedgerEntry(storage, "book-1", entry.id, new Date("2026-08-05T02:00:00.000Z").getTime())).toBe(true);
    const revision = storage.sqlite.prepare<{ reason: string; snapshot_json: string }>(`
      SELECT reason, snapshot_json FROM jingwei_revision WHERE entry_id = ? ORDER BY created_at DESC LIMIT 1
    `).get(entry.id)!;
    expect(revision.reason).toBe("ledger-soft-delete");
    expect(JSON.parse(revision.snapshot_json)).toMatchObject({ contentMd: "尚未回收", fields: { status: "planted" } });
  });

  it("upsertLedgerEntry matches by entryKey and unions aliases/sourceRefs", async () => {
    const storage = await setup();
    const e1 = upsertLedgerEntry(storage, {
      bookId: "book-1",
      category: "outline",
      title: "原标题",
      contentMd: "内容",
      fields: {},
      entryKey: "custom:123",
      aliases: ["小名1"],
      sourceRefs: [{ chapterNumber: 1, excerpt: "出处1" }],
    });
    expect(e1.title).toBe("原标题");
    // update by custom entryKey
    const e2 = upsertLedgerEntry(storage, {
      bookId: "book-1",
      category: "outline",
      title: "新标题",
      contentMd: "新内容",
      fields: {},
      entryKey: "custom:123",
      aliases: ["小名2"],
      sourceRefs: [{ chapterNumber: 2, excerpt: "出处2" }],
    });
    expect(e2.id).toBe(e1.id); // Same row
    expect(e2.title).toBe("新标题");

    const row = storage.sqlite.prepare<{ entry_key: string, aliases_json: string, source_refs_json: string }>(`
      SELECT entry_key, aliases_json, source_refs_json FROM story_jingwei_entry WHERE id = ?
    `).get(e1.id)!;
    expect(row.entry_key).toBe("custom:123");
    expect(JSON.parse(row.aliases_json)).toEqual(["小名1", "小名2"]);
    expect(JSON.parse(row.source_refs_json)).toEqual([
      { chapterNumber: 1, excerpt: "出处1" },
      { chapterNumber: 2, excerpt: "出处2" }
    ]);
  });

  it("后台写入不覆盖作者刚保存的内容：作者保存之后，结算带着旧版本写入时被拒绝，作者内容保留", async () => {
    const storage = await setup();
    const entry = upsertLedgerEntry(storage, {
      bookId: "book-1",
      category: "characters",
      title: "韩立",
      contentMd: "原设定",
      fields: { realm: "炼气" },
      now: () => new Date("2026-08-05T01:00:00.000Z"),
    });
    const seenVersion = storage.sqlite.prepare<{ version: number }>(`SELECT version FROM story_jingwei_entry WHERE id = ?`).get(entry.id)!.version;

    upsertLedgerEntry(storage, {
      bookId: "book-1",
      category: "characters",
      title: "韩立",
      contentMd: "作者手改的设定",
      fields: { realm: "筑基" },
      expectedVersion: seenVersion,
      now: () => new Date("2026-08-05T02:00:00.000Z"),
    });

    expect(() => upsertLedgerEntry(storage, {
      bookId: "book-1",
      category: "characters",
      title: "韩立",
      contentMd: "结算写入的内容",
      fields: { realm: "金丹" },
      expectedVersion: seenVersion,
      changedBy: "auto-settle",
      now: () => new Date("2026-08-05T03:00:00.000Z"),
    })).toThrow(expect.objectContaining({ code: "ENTRY_VERSION_CONFLICT" }));

    const row = storage.sqlite.prepare<{ content_md: string; fields_json: string }>(`SELECT content_md, fields_json FROM story_jingwei_entry WHERE id = ?`).get(entry.id)!;
    expect(row.content_md).toBe("作者手改的设定");
    expect(JSON.parse(row.fields_json)).toEqual({ realm: "筑基" });
  });

  it("机器只在自己读到的那一版上写：作者先保存后，带旧版本的机器写入不落库、原样保留作者内容并交给待处理", async () => {
    const storage = await setup();
    const entry = upsertLedgerEntry(storage, {
      bookId: "book-1",
      category: "characters",
      title: "韩立",
      contentMd: "机器初稿",
      fields: { realm: "炼气" },
      now: () => new Date("2026-08-05T01:00:00.000Z"),
    });
    // 结算开始时机器读到的版本
    const snapshotVersion = entry.version;
    // 结算跑的过程中，作者手改并保存
    const saved = upsertLedgerEntry(storage, {
      bookId: "book-1",
      category: "characters",
      title: "韩立",
      contentMd: "作者手改的设定",
      fields: { realm: "筑基" },
      now: () => new Date("2026-08-05T02:00:00.000Z"),
    });
    expect(saved.version).toBe(snapshotVersion + 1);

    const stale: LedgerStaleWriteInfo[] = [];
    const reasons: string[] = [];
    const result = upsertLedgerEntry(storage, {
      bookId: "book-1",
      category: "characters",
      title: "韩立",
      contentMd: "结算写入的内容",
      fields: { realm: "金丹" },
      expectedVersion: snapshotVersion,
      changedBy: "auto-settle",
      onStaleWrite: (conflict) => { reasons.push(conflict.reason); stale.push(conflict.info); },
      now: () => new Date("2026-08-05T03:00:00.000Z"),
    });

    expect(stale).toHaveLength(1);
    expect(stale[0]!.changedFields).toEqual(["title", "contentMd", "realm"]);
    expect(stale[0]!.category).toBe("characters");
    expect(stale[0]!.kind).toBe("version-mismatch");
    expect(stale[0]!.entryId).toBe(entry.id);
    expect(reasons[0]).toBe("ledger-upsert");
    expect(result.contentMd).toBe("作者手改的设定");

    const row = storage.sqlite.prepare<{ content_md: string; fields_json: string; version: number }>(
      `SELECT content_md, fields_json, version FROM story_jingwei_entry WHERE id = ?`,
    ).get(entry.id)!;
    expect(row.content_md).toBe("作者手改的设定");
    expect(JSON.parse(row.fields_json)).toEqual({ realm: "筑基" });
    expect(row.version).toBe(snapshotVersion + 1);
  });

  it("机器读到「还没有条目」时才新建：作者已建同名条目时不覆盖，原条目保留并交给待处理", async () => {
    const storage = await setup();
    const author = upsertLedgerEntry(storage, {
      bookId: "book-1",
      category: "foreshadowing",
      title: "小瓶",
      contentMd: "作者写的伏笔",
      fields: { status: "已埋设" },
      now: () => new Date("2026-08-05T01:00:00.000Z"),
    });

    const stale: LedgerStaleWriteInfo[] = [];
    const result = upsertLedgerEntry(storage, {
      bookId: "book-1",
      category: "foreshadowing",
      title: "小瓶",
      contentMd: "结算发现的伏笔",
      fields: { status: "已埋设", plantedChapter: 3 },
      expectedVersion: 0,
      changedBy: "chapter-settlement",
      onStaleWrite: (conflict) => { stale.push(conflict.info); },
      now: () => new Date("2026-08-05T02:00:00.000Z"),
    });

    expect(stale).toHaveLength(1);
    expect(stale[0]!.kind).toBe("created-after-read");
    expect(stale[0]!.entryId).toBe(author.id);
    expect(result.id).toBe(author.id);
    expect(result.contentMd).toBe("作者写的伏笔");
    expect(result.version).toBe(author.version);

    const row = storage.sqlite.prepare<{ content_md: string; version: number }>(
      `SELECT content_md, version FROM story_jingwei_entry WHERE id = ?`,
    ).get(author.id)!;
    expect(row.content_md).toBe("作者写的伏笔");
    expect(row.version).toBe(author.version);
    expect(storage.sqlite.prepare(`SELECT COUNT(*) AS n FROM story_jingwei_entry WHERE book_id = ? AND title = ?`).get("book-1", "小瓶")).toEqual({ n: 1 });
  });
});
