/**
 * 整章改稿候选（chapter.propose_revision）已随 25 工具收口下线：
 * 原生 Read/Edit 改正文 + chapter.commit(mode="revision") 直接提交，
 * 或 chapter.propose_selection 做定点候选。
 *
 * 本文件锁住收口后仍然成立的契约：
 *   · chapter.commit 缺章号 / 正文为空都拒绝，不新建章节、不动正文；
 *   · mode="revision" 直接落盘并更新索引（不再产候选 artifact）；
 *   · 章号不存在时拒绝改稿，不悄悄新建；
 *   · lore.propose_update 并入 jingwei.write(action="propose") 后仍是只读候选。
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import * as coreModule from "@vivy1024/novelfork-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ensureNarrativeMemorySchema } from "../engine/narrative-memory/storage.js";
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
  // 改稿提交会自动重结算，叙事记忆表要先建好。
  ensureNarrativeMemorySchema(activeStorage);
  activeStorage.sqlite.prepare(`INSERT INTO "book" (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`)
    .run("book-test-1", "测试书", Date.now(), Date.now());
  // 改稿走 handleChapterWrite：它要读 book.json 的字数目标，否则写入直接抛错。
  await writeFile(
    join(testDir, "book.json"),
    JSON.stringify({ id: "book-test-1", title: "测试书", chapterWordCount: 3000, language: "zh" }),
    "utf8",
  );
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

const chapterFile = () => join(testDir, "chapters", "卷01", "0003_旧章.md");

async function seedChapter(chapterNumber: number, content: string): Promise<void> {
  const volumeDir = "卷01";
  const fileName = `${String(chapterNumber).padStart(4, "0")}_旧章.md`;
  const relativePath = `${volumeDir}/${fileName}`;
  await mkdir(join(testDir, "chapters", volumeDir), { recursive: true });
  await writeFile(join(testDir, "chapters", volumeDir, fileName), content, "utf8");
  await writeFile(
    join(testDir, "chapters", "index.json"),
    JSON.stringify([{
      id: `chapter:${chapterNumber}`,
      number: chapterNumber,
      fileName: relativePath,
      title: "旧章",
      wordCount: content.length,
      status: "accepted",
      updatedAt: new Date().toISOString(),
    }]),
    "utf8",
  );
}

function commit(input: Record<string, unknown>) {
  return executeRuntimeDomainTool("chapter.commit", input, binding, {} as never);
}

describe("chapter.commit mode=revision（整章改稿直接提交）", () => {
  it("校验必填：mode=revision 缺章号、空白正文都拒绝，正文不动", async () => {
    await seedChapter(3, "第一段。\r\n\r\n第二段。");
    const before = await readFile(chapterFile(), "utf8");

    // 改稿必须指名章号：不给章号时不会猜，也不会退回新建章。
    const noChapter = await commit({ mode: "revision", content: "新正文" });
    expect(noChapter?.ok).toBe(false);
    expect(noChapter?.error).toBe("invalid-input");

    // 空白正文且磁盘上没有这一章可读：明确拒绝，不新建章节。
    const nothingToRead = await commit({ chapterNumber: 9, mode: "revision", content: "  " });
    expect(nothingToRead?.ok).toBe(false);
    expect(nothingToRead?.error).toBe("chapter-file-not-found");

    // 不给 mode 时按新章入库，缺蓝图就被挡住（不会顺手覆盖既有正文）。
    const missingSpec = await commit({ chapterNumber: 3, content: "新正文" });
    expect(missingSpec?.ok).toBe(false);
    expect(missingSpec?.error).toBe("scene-spec-required");

    expect(await readFile(chapterFile(), "utf8")).toBe(before);
  });

  it("改稿直接落盘并更新索引，不再产候选 artifact", async () => {
    await seedChapter(3, "第一段。\r\n\r\n第二段。\r\n\r\n第三段没改。");
    const result = await commit({
      chapterNumber: 3,
      mode: "revision",
      content: "第一段。\r\n\r\n第二段改过了。\r\n\r\n第三段没改。\r\n\r\n新增一段。",
    });

    // 结算可能因为会话没有模型而失败（这里没有 generateText），但改稿本身必须已经落盘。
    expect((result?.data as { saved?: boolean }).saved).toBe(true);
    expect(result?.data).toMatchObject({ mode: "revision", chapterNumber: 3, bookId: binding.bookId });
    // 收口后不再有候选字段：直接写正文。
    expect(result?.data).not.toHaveProperty("artifact");
    expect(result?.data).not.toHaveProperty("originalHash");

    const written = await readFile(chapterFile(), "utf8");
    expect(written).toContain("第二段改过了。");
    expect(written).toContain("新增一段。");

    const index = JSON.parse(await readFile(join(testDir, "chapters", "index.json"), "utf8")) as Array<{
      number: number;
      wordCount: number;
    }>;
    expect(index).toHaveLength(1);
    expect(index[0]!.number).toBe(3);
    expect(index[0]!.wordCount).toBeGreaterThan(0);
  });

  it("章节不存在时拒绝改稿，不悄悄新建章节", async () => {
    await seedChapter(3, "第一段。");
    const result = await commit({ chapterNumber: 9, mode: "revision", content: "全新的第 9 章。" });
    expect(result?.ok).toBe(false);
    expect(result?.error).toBe("chapter-not-found");

    const index = JSON.parse(await readFile(join(testDir, "chapters", "index.json"), "utf8")) as Array<{ number: number }>;
    expect(index.map((entry) => entry.number)).toEqual([3]);
  });
});

describe("jingwei.write action=propose（原 lore.propose_update）", () => {
  it("校验必填与条目存在性", async () => {
    const missing = await executeRuntimeDomainTool(
      "jingwei.write",
      { action: "propose", bookId: "b", fieldsPatch: { a: 1 }, reason: "x" } as never,
      binding,
      {} as never,
    );
    expect(missing?.ok).toBe(false);
    expect(missing?.error).toBe("invalid-input");

    const noEntry = await executeRuntimeDomainTool(
      "jingwei.write",
      { action: "propose", bookId: "b", entryId: "entry-x", fieldsPatch: { a: 1 }, reason: "x" } as never,
      binding,
      {} as never,
    );
    expect(noEntry?.ok).toBe(false);
    expect(noEntry?.error).toBe("entry-not-found");
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
      "jingwei.write",
      { action: "propose", bookId: "b", entryId: created.id, fieldsPatch: { cultivation: "筑基", half: "new" }, reason: "突破" } as never,
      binding,
      {} as never,
    );
    expect(result?.ok).toBe(true);
    const artifact = (result?.data as { artifact: Record<string, unknown> }).artifact;
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
