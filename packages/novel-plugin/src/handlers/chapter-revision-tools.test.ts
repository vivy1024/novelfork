import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import * as coreModule from "@vivy1024/novelfork-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createStoryJingweiEntryRepository } from "../engine/jingwei/repositories/entry-repo.js";

import { executeRuntimeDomainTool, type TrustedRuntimeBookBinding } from "./runtime-domain-tools.js";

const tempDirs: string[] = [];
let activeStorage: StorageDatabase | undefined;
let testDir: string;
let binding: TrustedRuntimeBookBinding;

function initJingweiSchema(storage: StorageDatabase): void {
  // 手写精简 DDL 总会漏列（repo 查询要的 parent_id、builtin_kind 等）。
  // 用真实迁移把全部产品表建全，与线上同构。
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "..", "core", "src", "storage", "migrations") });
}

beforeEach(async () => {
  testDir = join(tmpdir(), `novelfork-revision-test-${crypto.randomUUID()}`);
  await mkdir(join(testDir, "chapters"), { recursive: true });
  tempDirs.push(testDir);
  activeStorage = createStorageDatabase({ databasePath: join(testDir, "novelfork.db") });
  initJingweiSchema(activeStorage);
  activeStorage.sqlite.prepare(`INSERT INTO "book" (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`)
    .run("book-test-1", "测试书", Date.now(), Date.now());
  vi.spyOn(coreModule, "getStorageDatabase").mockImplementation(() => activeStorage!);
  binding = { bookId: "book-test-1", root: testDir };
});

afterEach(async () => {
  if (activeStorage) {
    activeStorage.close();
    activeStorage = undefined;
  }
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function seedChapter(chapterNumber: number, content: string): Promise<void> {
  const volumeDir = "卷01";
  const fileName = `${String(chapterNumber).padStart(4, "0")}_旧章.md`;
  const relativePath = `${volumeDir}/${fileName}`;
  await mkdir(join(testDir, "chapters", volumeDir), { recursive: true });
  await writeFile(join(testDir, "chapters", volumeDir, fileName), content, "utf8");
  await writeFile(
    join(testDir, "chapters", "index.json"),
    JSON.stringify([{ id: `chapter:${chapterNumber}`, fileName: relativePath, chapterNumber, title: "旧章", wordCount: content.length, status: "accepted", updatedAt: new Date().toISOString() }]),
    "utf8",
  );
}

describe("chapter.propose_revision（T5.3 整章改动候选）", () => {
  it("校验必填：缺章号、正文或理由都拒绝，候选不落盘", async () => {
    for (const input of [
      { bookId: "b", content: "新正文", reason: "为什么" },
      { bookId: "b", chapterNumber: 3, reason: "为什么" },
      { bookId: "b", chapterNumber: 3, content: "新正文" },
      { bookId: "b", chapterNumber: 3, content: "  ", reason: "为什么" },
    ]) {
      const result = await executeRuntimeDomainTool("chapter.propose_revision", input as never, binding, {} as never);
      expect(result.ok).toBe(false);
      expect(result.error).toBe("invalid-input");
    }
  });

  it("正文超过 6 万字拒绝（要求拆成多个候选）", async () => {
    const result = await executeRuntimeDomainTool(
      "chapter.propose_revision",
      { bookId: "b", chapterNumber: 3, content: "字".repeat(60_001), reason: "长" } as never,
      binding,
      {} as never,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe("content-too-large");
  });

  it("产候选：before 摘要、hash 与段落统计，正文不改", async () => {
    await seedChapter(3, "第一段。\r\n\r\n第二段。\r\n\r\n第三段没改。");
    const result = await executeRuntimeDomainTool(
      "chapter.propose_revision",
      { bookId: "b", chapterNumber: 3, content: "第一段。\r\n\r\n第二段改过了。\r\n\r\n第三段没改。\r\n\r\n新增一段。", reason: "把冲突提前" } as never,
      binding,
      {} as never,
    );
    expect(result.ok).toBe(true);
    const artifact = (result.data as { artifact: Record<string, unknown> }).artifact;
    expect(artifact).toMatchObject({ kind: "chapter-revision", bookId: binding.bookId, chapterNumber: 3, reason: "把冲突提前", originalExists: true });
    expect(typeof artifact.originalHash).toBe("string");
    expect((artifact.originalHash as string).length).toBe(64);
    expect(artifact.stats).toMatchObject({ unchangedParagraphs: 2, removedParagraphs: 1, addedParagraphs: 2 });
    expect(artifact.newText).toContain("新增一段。");
    // 正文未被修改
    expect((await readFile(join(testDir, "chapters", "卷01", "0003_旧章.md"), "utf8"))).toContain("第二段。");
  });

  it("章节不存在：按新建候选处理并明确标出", async () => {
    const result = await executeRuntimeDomainTool(
      "chapter.propose_revision",
      { bookId: "b", chapterNumber: 9, content: "全新的第 9 章。", reason: "新写" } as never,
      binding,
      {} as never,
    );
    expect(result.ok).toBe(true);
    const artifact = (result.data as { artifact: Record<string, unknown> }).artifact;
    expect(artifact.originalExists).toBe(false);
    expect(artifact.stats).toMatchObject({ unchangedParagraphs: 0, removedParagraphs: 0, addedParagraphs: 1 });
  });
});

describe("lore.propose_update（T5.3 设定字段改动候选）", () => {
  it("校验必填与条目存在性", async () => {
    const missing = await executeRuntimeDomainTool("lore.propose_update", { bookId: "b", fieldsPatch: { a: 1 }, reason: "x" } as never, binding, {} as never);
    expect(missing.ok).toBe(false);
    expect(missing.error).toBe("invalid-input");

    const noEntry = await executeRuntimeDomainTool("lore.propose_update", { bookId: "b", entryId: "entry-x", fieldsPatch: { a: 1 }, reason: "x" } as never, binding, {} as never);
    expect(noEntry.ok).toBe(false);
    expect(noEntry.error).toBe("entry-not-found");
  });

  it("before 只投被 patch 的键，条目本身不动", async () => {
    const repo = createStoryJingweiEntryRepository(activeStorage!);
    const now = Date.now();
    activeStorage!.sqlite.prepare(
      `INSERT INTO story_jingwei_section (id, book_id, key, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("sec-characters", binding.bookId, "characters", "人物", now, now);
    const created = { id: `entry-${crypto.randomUUID()}` };
    activeStorage!.sqlite.prepare(
      `INSERT INTO story_jingwei_entry (id, book_id, section_id, category, title, content_md, fields_json, status, lifecycle, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', 'active', ?, ?)`,
    ).run(created.id, binding.bookId, "sec-characters", "characters", "林舟", "主角", JSON.stringify({ cultivation: "练气", goal: "夺回师门" }), now, now);

    const result = await executeRuntimeDomainTool(
      "lore.propose_update",
      { bookId: "b", entryId: created.id, fieldsPatch: { cultivation: "筑基", half: "new" }, reason: "突破" } as never,
      binding,
      {} as never,
    );
    expect(result.ok).toBe(true);
    const artifact = (result.data as { artifact: Record<string, unknown> }).artifact;
    expect(artifact).toMatchObject({
      kind: "lore-update",
      entryId: created.id,
      entryTitle: "林舟",
      category: "characters",
      reason: "突破",
    });
    expect(artifact.before).toEqual({ cultivation: "练气", half: null });
    expect(artifact.fieldsPatch).toEqual({ cultivation: "筑基", half: "new" });
    // 条目未被修改
    const after = await repo.getById(binding.bookId, created.id);
    expect(after?.fields).toMatchObject({ cultivation: "练气" });
  });
});
