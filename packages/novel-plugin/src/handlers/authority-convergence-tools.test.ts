import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import * as coreModule from "@vivy1024/novelfork-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { executeRuntimeDomainTool, type TrustedRuntimeBookBinding } from "./runtime-domain-tools.js";
import { listLedgerEntries, upsertLedgerEntry } from "./jingwei-ledger-store.js";

const tempDirs: string[] = [];
let activeStorage: StorageDatabase | undefined;

function initJingweiSchema(storage: StorageDatabase): void {
  storage.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS story_jingwei_section (
      id TEXT PRIMARY KEY NOT NULL, book_id TEXT NOT NULL, key TEXT NOT NULL,
      name TEXT NOT NULL, description TEXT, "order" INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1, show_in_sidebar INTEGER DEFAULT 1,
      participates_in_ai INTEGER DEFAULT 1, default_visibility TEXT DEFAULT 'tracked',
      fields_json TEXT DEFAULT '[]', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS story_jingwei_entry (
      id TEXT PRIMARY KEY NOT NULL, book_id TEXT NOT NULL, section_id TEXT NOT NULL,
      category TEXT DEFAULT 'setting', title TEXT NOT NULL, content_md TEXT DEFAULT '',
      summary_md TEXT, tags_json TEXT DEFAULT '[]', aliases_json TEXT DEFAULT '[]',
      custom_fields_json TEXT DEFAULT '{}', fields_json TEXT DEFAULT '{}',
      related_chapter_numbers_json TEXT DEFAULT '[]', related_entry_ids_json TEXT DEFAULT '[]',
      visibility_rule_json TEXT DEFAULT '{"type":"tracked"}', participates_in_ai INTEGER DEFAULT 1,
      token_budget INTEGER, layer TEXT DEFAULT 'dynamic', priority_tier TEXT DEFAULT 'auto',
      importance INTEGER DEFAULT 40, status TEXT DEFAULT 'confirmed', lifecycle TEXT DEFAULT 'active',
      sort_order INTEGER DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    );
  `);
}

let testDir: string;
let binding: TrustedRuntimeBookBinding;

beforeEach(async () => {
  testDir = join(tmpdir(), `novelfork-authority-test-${crypto.randomUUID()}`);
  await mkdir(join(testDir, "chapters"), { recursive: true });
  await mkdir(join(testDir, "story"), { recursive: true });
  tempDirs.push(testDir);
  activeStorage = createStorageDatabase({ databasePath: join(testDir, "novelfork.db") });
  initJingweiSchema(activeStorage);

  vi.spyOn(coreModule, "getStorageDatabase").mockImplementation(() => activeStorage!);

  binding = {
    bookId: "book-test-1",
    root: testDir,
  };
});

afterEach(async () => {
  if (activeStorage) {
    activeStorage.close();
    activeStorage = undefined;
  }
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Authority Convergence: hooks.manage（经纬 DB 权威源）", () => {
  it("hooks.manage plants and pays off in Jingwei DB, and derives pending_hooks.md", async () => {
    // 1. plant
    const plantRes = await executeRuntimeDomainTool(
      "hooks.manage",
      { action: "plant", description: "青铜剑之谜", chapterNumber: 2 },
      binding,
      {} as never,
    );
    expect(plantRes?.ok).toBe(true);

    // 校验 DB 正确
    const entries = listLedgerEntries(activeStorage!, binding.bookId, "foreshadowing");
    expect(entries).toHaveLength(1);
    expect(entries[0]!.title).toBe("青铜剑之谜");
    expect(entries[0]!.fields).toMatchObject({
      status: "planted",
      plantedChapter: 2,
    });

    // 校验派生 pending_hooks.md 文件存在且包含信息
    const mdContent = await readFile(join(testDir, "story", "pending_hooks.md"), "utf8");
    expect(mdContent).toContain("- [ ] 青铜剑之谜（埋设于第2章）");

    // 2. list hooks
    const listRes = await executeRuntimeDomainTool(
      "hooks.manage",
      { action: "list" },
      binding,
      {} as never,
    );
    expect(listRes?.ok).toBe(true);
    expect((listRes?.data as { hooks: Array<{ id: string; text: string }> }).hooks[0]!.text).toContain("青铜剑之谜");

    // 3. payoff
    const hookId = entries[0]!.id;
    const payoffRes = await executeRuntimeDomainTool(
      "hooks.manage",
      { action: "payoff", hookId, chapterNumber: 15 },
      binding,
      {} as never,
    );
    expect(payoffRes?.ok).toBe(true);

    // 校验 DB payoff
    const updatedEntries = listLedgerEntries(activeStorage!, binding.bookId, "foreshadowing");
    expect(updatedEntries[0]!.fields).toMatchObject({
      status: "paid_off",
      plantedChapter: 2,
      payoffChapter: 15,
    });

    // 校验派生 pending_hooks.md 更新
    const updatedMd = await readFile(join(testDir, "story", "pending_hooks.md"), "utf8");
    expect(updatedMd).toContain("- [x] 青铜剑之谜（兑现于第15章）");
  });

  it("hooks.manage ignores conflicting Markdown content and relies solely on DB", async () => {
    // DB 中有一个【已兑现】的伏笔
    upsertLedgerEntry(activeStorage!, {
      bookId: binding.bookId,
      category: "foreshadowing",
      title: "真实伏笔",
      contentMd: "真实伏笔内容",
      fields: { status: "paid_off", plantedChapter: 1, payoffChapter: 5 },
    });

    // 故意写入冲突/伪造的 pending_hooks.md
    await writeFile(
      join(testDir, "story", "pending_hooks.md"),
      "# 伏笔\n- [ ] 假伏笔（Markdown独有，DB无记录）\n",
      "utf8",
    );

    // list 应该只返回 DB 里的真实伏笔，并且状态为 done: true
    const listRes = await executeRuntimeDomainTool(
      "hooks.manage",
      { action: "list" },
      binding,
      {} as never,
    );
    expect(listRes?.ok).toBe(true);
    const hooks = (listRes?.data as { hooks: Array<{ text: string; done: boolean }> }).hooks;
    expect(hooks).toHaveLength(1);
    expect(hooks[0]!.text).toContain("真实伏笔");
    expect(hooks[0]!.done).toBe(true);
  });

  it("hooks.manage works normally when no pending_hooks.md exists", async () => {
    const listRes = await executeRuntimeDomainTool(
      "hooks.manage",
      { action: "list" },
      binding,
      {} as never,
    );
    expect(listRes?.ok).toBe(true);
    expect((listRes?.data as { hooks: unknown[] }).hooks).toHaveLength(0);
  });

});
