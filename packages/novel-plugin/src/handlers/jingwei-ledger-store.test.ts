import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";
import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { createBookRepository } from "../engine/jingwei/repositories/book-repo.js";
import { softDeleteLedgerEntry, upsertLedgerEntry } from "./jingwei-ledger-store.js";

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
});
