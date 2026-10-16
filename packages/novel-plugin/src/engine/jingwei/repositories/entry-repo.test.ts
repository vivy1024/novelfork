import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";
import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { createBookRepository } from "./book-repo.js";
import { createStoryJingweiEntryRepository } from "./entry-repo.js";
import { createStoryJingweiSectionRepository } from "./section-repo.js";

const tempDirs: string[] = [];
const storages: StorageDatabase[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-jingwei-entry-repo-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  storages.push(storage);
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
  await createBookRepository(storage).create({
    id: "book-1",
    name: "测试书",
    jingweiMode: "dynamic",
    currentChapter: 1,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
  });
  await createStoryJingweiSectionRepository(storage).create({
    id: "section-1",
    bookId: "book-1",
    key: "characters",
    name: "角色",
    description: "",
    icon: null,
    order: 0,
    enabled: true,
    showInSidebar: true,
    participatesInAi: true,
    defaultVisibility: "tracked",
    fieldsJson: [],
    builtinKind: "characters",
    sourceTemplate: "test",
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
  });
  return storage;
}

afterEach(async () => {
  for (const storage of storages.splice(0)) storage.close();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("story jingwei entry fields merge semantics", () => {
  async function createForeshadowingEntry(storage: StorageDatabase) {
    return createStoryJingweiEntryRepository(storage).create({
      id: "entry-foreshadowing",
      bookId: "book-1",
      sectionId: "section-1",
      title: "血仇伏笔",
      contentMd: "韩立的血仇伏笔",
      tags: [],
      aliases: [],
      fields: {
        name: "血仇伏笔",
        description: "墨大夫夺舍之恨",
        plantedChapter: 3,
        targetChapter: 40,
        status: "已埋设",
      },
      customFields: {
        name: "血仇伏笔",
        description: "墨大夫夺舍之恨",
        plantedChapter: 3,
        targetChapter: 40,
        status: "已埋设",
      },
      relatedChapterNumbers: [],
      relatedEntryIds: [],
      visibilityRule: { type: "tracked" },
      participatesInAi: true,
      tokenBudget: null,
      createdAt: new Date("2026-08-01T01:00:00.000Z"),
      updatedAt: new Date("2026-08-01T01:00:00.000Z"),
    });
  }

  it("fieldsPatch 只增量合并传入键，保留其余 fields（伏笔拖拽改状态不丢数据）", async () => {
    const storage = await createStorage();
    const repo = createStoryJingweiEntryRepository(storage);
    await createForeshadowingEntry(storage);

    await repo.update("book-1", "entry-foreshadowing", {
      fieldsPatch: { status: "已回收" },
      source: "user",
    });

    const entry = await repo.getById("book-1", "entry-foreshadowing");
    expect(entry?.fields).toEqual({
      name: "血仇伏笔",
      description: "墨大夫夺舍之恨",
      plantedChapter: 3,
      targetChapter: 40,
      status: "已回收",
    });
    const row = storage.sqlite.prepare<{ fields_json: string; custom_fields_json: string }>(`
      SELECT fields_json, custom_fields_json FROM story_jingwei_entry WHERE id = ?
    `).get("entry-foreshadowing");
    expect(JSON.parse(row!.fields_json)).toEqual(entry!.fields);
    expect(JSON.parse(row!.custom_fields_json)).toEqual(entry!.fields);
  });

  it("customFields-only 更新同样是合并而非整体替换", async () => {
    const storage = await createStorage();
    const repo = createStoryJingweiEntryRepository(storage);
    await createForeshadowingEntry(storage);

    await repo.update("book-1", "entry-foreshadowing", {
      customFields: { status: "已废弃" },
      source: "user",
    });

    const entry = await repo.getById("book-1", "entry-foreshadowing");
    expect(entry?.fields).toEqual({
      name: "血仇伏笔",
      description: "墨大夫夺舍之恨",
      plantedChapter: 3,
      targetChapter: 40,
      status: "已废弃",
    });
  });

  it("fields 显式提供时仍整体替换（编辑器全量提交语义不变）", async () => {
    const storage = await createStorage();
    const repo = createStoryJingweiEntryRepository(storage);
    await createForeshadowingEntry(storage);

    await repo.update("book-1", "entry-foreshadowing", {
      fields: { status: "已回收", note: "只保留这两个键" },
      source: "user",
    });

    const entry = await repo.getById("book-1", "entry-foreshadowing");
    expect(entry?.fields).toEqual({ status: "已回收", note: "只保留这两个键" });
  });
});

describe("story jingwei entry authority and revisions", () => {
  async function createEntry(storage: StorageDatabase) {
    return createStoryJingweiEntryRepository(storage).create({
      id: "entry-1",
      bookId: "book-1",
      sectionId: "section-1",
      title: "旧标题",
      contentMd: "旧正文",
      tags: [],
      aliases: [],
      customFields: { category: "characters", phase: "初始" },
      relatedChapterNumbers: [],
      relatedEntryIds: [],
      visibilityRule: { type: "tracked" },
      participatesInAi: true,
      tokenBudget: null,
      createdAt: new Date("2026-08-01T01:00:00.000Z"),
      updatedAt: new Date("2026-08-01T01:00:00.000Z"),
    });
  }

  it("promotes legacy customFields input into canonical fields and category", async () => {
    const storage = await createStorage();
    const created = await createEntry(storage);

    expect(created.category).toBe("characters");
    expect(created.fields).toEqual({ category: "characters", phase: "初始" });
    const row = storage.sqlite.prepare<{ fields_json: string; custom_fields_json: string }>(`
      SELECT fields_json, custom_fields_json FROM story_jingwei_entry WHERE id = ?
    `).get("entry-1");
    expect(JSON.parse(row!.fields_json)).toEqual(created.fields);
    expect(JSON.parse(row!.custom_fields_json)).toEqual(created.fields);
  });

  it("records the complete previous snapshot in jingwei_revision only", async () => {
    const storage = await createStorage();
    const repo = createStoryJingweiEntryRepository(storage);
    await createEntry(storage);

    await repo.update("book-1", "entry-1", {
      contentMd: "新正文",
      fields: { category: "characters", phase: "变化" },
      source: "user",
      revisionReason: "manual-edit",
    });

    const revisions = await repo.listRevisions("book-1", "entry-1");
    expect(revisions[0]).toMatchObject({
      contentMd: "旧正文",
      changedBy: "user",
      reason: "manual-edit",
      snapshot: {
        title: "旧标题",
        contentMd: "旧正文",
        category: "characters",
        fields: { category: "characters", phase: "初始" },
      },
    });

    const entry = await repo.getById("book-1", "entry-1");
    expect(entry?.revisionHistory).toEqual([]);
    expect(entry?.fields.phase).toBe("变化");
  });

  it("reverts all editable fields and saves the current state as a new revision", async () => {
    const storage = await createStorage();
    const repo = createStoryJingweiEntryRepository(storage);
    await createEntry(storage);
    await repo.update("book-1", "entry-1", {
      title: "新标题",
      contentMd: "新正文",
      category: "relationships",
      fields: { phase: "变化" },
      priorityTier: "core",
      source: "user",
    });
    const target = (await repo.listRevisions("book-1", "entry-1"))[0]!;

    const reverted = await repo.revertToRevision("book-1", "entry-1", target.id, { updatedAt: new Date("2026-08-02T00:00:00.000Z") });

    expect(reverted).toMatchObject({
      title: "旧标题",
      contentMd: "旧正文",
      category: "characters",
      fields: { category: "characters", phase: "初始" },
      priorityTier: "auto",
      version: 3,
    });
    expect(await repo.listRevisions("book-1", "entry-1")).toHaveLength(2);
  });
});

describe("story jingwei entry identity and source refs", () => {
  it("creates a stable entryKey and sourceRefs, then keeps the key when the title changes", async () => {
    const storage = await createStorage();
    const repo = createStoryJingweiEntryRepository(storage);
    const created = await repo.create({
      id: "entry-identity",
      bookId: "book-1",
      sectionId: "section-1",
      title: "旧标题",
      contentMd: "旧正文",
      tags: [],
      aliases: [" 韩 立 ", "韩立"],
      customFields: {},
      relatedChapterNumbers: [],
      relatedEntryIds: [],
      visibilityRule: { type: "tracked" },
      participatesInAi: true,
      tokenBudget: null,
      sourceRefs: [{ chapterNumber: 1, excerpt: "首次出场" }],
      createdAt: new Date("2026-08-01T01:00:00.000Z"),
      updatedAt: new Date("2026-08-01T01:00:00.000Z"),
    });

    expect(created.entryKey).toBe("characters:旧标题");
    expect(created.aliases).toEqual(["韩 立"]);
    expect(created.sourceRefs).toEqual([{ chapterNumber: 1, excerpt: "首次出场" }]);

    const updated = await repo.update("book-1", "entry-identity", {
      title: "新标题",
      sourceRefs: [{ chapterNumber: 2, excerpt: "二次出场" }],
      source: "user",
    });
    expect(updated?.entryKey).toBe("characters:旧标题");
    expect(updated?.sourceRefs).toEqual([
      { chapterNumber: 1, excerpt: "首次出场" },
      { chapterNumber: 2, excerpt: "二次出场" },
    ]);
  });

  it("uses a stable chapter-summary key and restores identity from revision snapshots", async () => {
    const storage = await createStorage();
    const repo = createStoryJingweiEntryRepository(storage);
    const created = await repo.create({
      id: "entry-summary",
      bookId: "book-1",
      sectionId: "section-1",
      title: "第12章",
      contentMd: "摘要正文",
      category: "chapter-summaries",
      tags: [],
      aliases: [],
      fields: { chapterNumber: 12 },
      customFields: { chapterNumber: 12 },
      relatedChapterNumbers: [12],
      relatedEntryIds: [],
      visibilityRule: { type: "nested" },
      participatesInAi: true,
      tokenBudget: null,
      sourceRefs: [{ chapterNumber: 12, excerpt: "本章摘要" }],
      createdAt: new Date("2026-08-01T01:00:00.000Z"),
      updatedAt: new Date("2026-08-01T01:00:00.000Z"),
    });
    expect(created.entryKey).toBe("chapter-summaries:chapter:12");

    await repo.update("book-1", "entry-summary", {
      title: "第12章摘要：药园试探",
      source: "auto-settle",
    });
    const target = (await repo.listRevisions("book-1", "entry-summary"))[0]!;
    const reverted = await repo.revertToRevision("book-1", "entry-summary", target.id);
    expect(reverted?.entryKey).toBe("chapter-summaries:chapter:12");
    expect(reverted?.sourceRefs).toEqual([{ chapterNumber: 12, excerpt: "本章摘要" }]);
  });
});

describe("story jingwei entry optimistic concurrency (T-24)", () => {
  async function createTrackedEntry(storage: StorageDatabase) {
    return createStoryJingweiEntryRepository(storage).create({
      id: "entry-tracked",
      bookId: "book-1",
      sectionId: "section-1",
      title: "林舟",
      contentMd: "初版设定",
      category: "characters",
      fields: { role: "旧角色" },
      tags: [],
      aliases: [],
      customFields: {},
      relatedChapterNumbers: [],
      relatedEntryIds: [],
      visibilityRule: { type: "tracked" },
      participatesInAi: true,
      tokenBudget: null,
      createdAt: new Date("2026-08-01T01:00:00.000Z"),
      updatedAt: new Date("2026-08-01T01:00:00.000Z"),
    });
  }

  it("带当前版本的写入成功，并把版本推进一位", async () => {
    const storage = await createStorage();
    const repo = createStoryJingweiEntryRepository(storage);
    const created = await createTrackedEntry(storage);

    const updated = await repo.update("book-1", "entry-tracked", {
      contentMd: "作者改过的设定",
      source: "user",
      expectedVersion: created.version,
    });

    expect(updated?.contentMd).toBe("作者改过的设定");
    expect(updated?.version).toBe(created.version + 1);
  });

  it("并发编辑冲突被检测：后台写入先改了条目，前端带旧版本的保存被拒绝且不覆盖", async () => {
    const storage = await createStorage();
    const repo = createStoryJingweiEntryRepository(storage);
    const created = await createTrackedEntry(storage);
    // 前端在版本 created.version 时读到条目；此后后台结算先写入（不带版本，保持原行为）。
    await repo.update("book-1", "entry-tracked", {
      fieldsPatch: { role: "结算改出的角色" },
      source: "auto-settle",
    });

    await expect(repo.update("book-1", "entry-tracked", {
      contentMd: "前端基于旧版本的编辑",
      source: "user",
      expectedVersion: created.version,
    })).rejects.toMatchObject({ code: "ENTRY_VERSION_CONFLICT" });

    // 冲突时后台结算的结果必须保留，前端的过期编辑不得写入。
    const stored = await repo.getById("book-1", "entry-tracked");
    expect(stored?.fields).toEqual({ role: "结算改出的角色" });
    expect(stored?.contentMd).toBe("初版设定");
  });

  it("冲突被拒时事务整体回滚：不留下多余的修订记录", async () => {
    const storage = await createStorage();
    const repo = createStoryJingweiEntryRepository(storage);
    const created = await createTrackedEntry(storage);
    await repo.update("book-1", "entry-tracked", { fieldsPatch: { role: "结算改出的角色" }, source: "auto-settle" });
    const revisionsBefore = storage.sqlite.prepare<{ n: number }>(
      `SELECT COUNT(*) AS n FROM "jingwei_revision" WHERE "entry_id" = ?`,
    ).get("entry-tracked")!.n;

    await expect(repo.update("book-1", "entry-tracked", {
      contentMd: "前端基于旧版本的编辑",
      source: "user",
      expectedVersion: created.version,
    })).rejects.toMatchObject({ code: "ENTRY_VERSION_CONFLICT" });

    const revisionsAfter = storage.sqlite.prepare<{ n: number }>(
      `SELECT COUNT(*) AS n FROM "jingwei_revision" WHERE "entry_id" = ?`,
    ).get("entry-tracked")!.n;
    expect(revisionsAfter).toBe(revisionsBefore);
  });

  it("旧库中版本为 NULL 的条目按版本 1 处理：expectedVersion=1 的写入成功，不产生假冲突", async () => {
    const storage = await createStorage();
    const repo = createStoryJingweiEntryRepository(storage);
    await createTrackedEntry(storage);
    // 模拟旧库：version 列为 NULL（readEntry 把它按 1 返回）。
    storage.sqlite.prepare(`UPDATE "story_jingwei_entry" SET "version" = NULL WHERE "id" = ?`).run("entry-tracked");

    const updated = await repo.update("book-1", "entry-tracked", {
      contentMd: "旧库条目的合法编辑",
      source: "user",
      expectedVersion: 1,
    });

    expect(updated?.contentMd).toBe("旧库条目的合法编辑");
  });

  it("不带 expectedVersion 的写入保持原行为，兼容既有调用方", async () => {
    const storage = await createStorage();
    const repo = createStoryJingweiEntryRepository(storage);
    await createTrackedEntry(storage);

    const updated = await repo.update("book-1", "entry-tracked", {
      contentMd: "无版本写入",
      source: "user",
    });

    expect(updated?.contentMd).toBe("无版本写入");
  });
});

describe("story jingwei entry cross-book references (T-12)", () => {
  // book-1 / section-1 由 createStorage 建好；这里再建一本书 book-2 及其分区与条目，作为“别的书”。
  async function createTwoBookStorage(): Promise<StorageDatabase> {
    const storage = await createStorage();
    await createBookRepository(storage).create({
      id: "book-2",
      name: "别的书",
      jingweiMode: "dynamic",
      currentChapter: 1,
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    });
    await createStoryJingweiSectionRepository(storage).create({
      id: "section-other",
      bookId: "book-2",
      key: "characters",
      name: "角色",
      description: "",
      icon: null,
      order: 0,
      enabled: true,
      showInSidebar: true,
      participatesInAi: true,
      defaultVisibility: "tracked",
      fieldsJson: [],
      builtinKind: "characters",
      sourceTemplate: "test",
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    });
    const repo = createStoryJingweiEntryRepository(storage);
    await repo.create(entryInput({ id: "entry-other", bookId: "book-2", sectionId: "section-other", title: "别书角色" }));
    await repo.create(entryInput({ id: "entry-a", title: "甲" }));
    await repo.create(entryInput({ id: "entry-b", title: "乙", parentId: "entry-a" }));
    return storage;
  }

  function entryInput(overrides: Partial<Parameters<ReturnType<typeof createStoryJingweiEntryRepository>["create"]>[0]> & { id: string; title: string }) {
    return {
      bookId: "book-1",
      sectionId: "section-1",
      contentMd: "",
      category: "characters",
      fields: {},
      tags: [],
      aliases: [],
      customFields: {},
      relatedChapterNumbers: [],
      relatedEntryIds: [],
      visibilityRule: { type: "tracked" as const },
      participatesInAi: true,
      tokenBudget: null,
      createdAt: new Date("2026-08-01T01:00:00.000Z"),
      updatedAt: new Date("2026-08-01T01:00:00.000Z"),
      ...overrides,
    };
  }

  function rowCount(storage: StorageDatabase, id: string): number {
    return storage.sqlite.prepare<{ n: number }>(`SELECT COUNT(*) AS n FROM story_jingwei_entry WHERE id = ?`).get(id)!.n;
  }

  it("新建条目：分区属于别的书时拒绝，且不落库", async () => {
    const storage = await createTwoBookStorage();
    const repo = createStoryJingweiEntryRepository(storage);
    await expect(repo.create(entryInput({ id: "entry-x", title: "丙", sectionId: "section-other" })))
      .rejects.toMatchObject({ code: "JINGWEI_SECTION_NOT_IN_BOOK", explanation: { whatHappened: expect.any(String) } });
    expect(rowCount(storage, "entry-x")).toBe(0);
  });

  it("新建条目：父条目属于别的书或就是自己时拒绝", async () => {
    const storage = await createTwoBookStorage();
    const repo = createStoryJingweiEntryRepository(storage);
    await expect(repo.create(entryInput({ id: "entry-x", title: "丙", parentId: "entry-other" })))
      .rejects.toMatchObject({ code: "JINGWEI_PARENT_NOT_IN_BOOK" });
    await expect(repo.create(entryInput({ id: "entry-y", title: "丁", parentId: "entry-y" })))
      .rejects.toMatchObject({ code: "JINGWEI_PARENT_CYCLE" });
    expect(rowCount(storage, "entry-x") + rowCount(storage, "entry-y")).toBe(0);
  });

  it("新建条目：relatedEntryIds 里别的书的 id 被滤掉，本书 id 保留", async () => {
    const storage = await createTwoBookStorage();
    const created = await createStoryJingweiEntryRepository(storage)
      .create(entryInput({ id: "entry-x", title: "丙", relatedEntryIds: ["entry-a", "entry-other", "entry-b"] }));
    expect(created.relatedEntryIds).toEqual(["entry-a", "entry-b"]);
  });

  it("更新条目：改到别的书的分区或父条目时拒绝，原值不变", async () => {
    const storage = await createTwoBookStorage();
    const repo = createStoryJingweiEntryRepository(storage);
    await expect(repo.update("book-1", "entry-b", { sectionId: "section-other" }))
      .rejects.toMatchObject({ code: "JINGWEI_SECTION_NOT_IN_BOOK" });
    await expect(repo.update("book-1", "entry-b", { parentId: "entry-other" }))
      .rejects.toMatchObject({ code: "JINGWEI_PARENT_NOT_IN_BOOK" });
    const stored = await repo.getById("book-1", "entry-b");
    expect(stored?.sectionId).toBe("section-1");
    expect(stored?.parentId).toBe("entry-a");
  });

  it("更新条目：父条目不能是自己，也不能是自己的后代（成环）", async () => {
    const storage = await createTwoBookStorage();
    const repo = createStoryJingweiEntryRepository(storage);
    await expect(repo.update("book-1", "entry-a", { parentId: "entry-a" })).rejects.toMatchObject({ code: "JINGWEI_PARENT_CYCLE" });
    // entry-b 是 entry-a 的子条目：把 entry-a 挂到 entry-b 下会成环
    await expect(repo.update("book-1", "entry-a", { parentId: "entry-b" })).rejects.toMatchObject({ code: "JINGWEI_PARENT_CYCLE" });
    expect((await repo.getById("book-1", "entry-a"))?.parentId).toBeNull();
  });

  it("更新条目：relatedEntryIds 过滤别的书的 id；同书父条目与分区正常可改（对照）", async () => {
    const storage = await createTwoBookStorage();
    const repo = createStoryJingweiEntryRepository(storage);
    await repo.create(entryInput({ id: "entry-c", title: "丙" }));
    const updated = await repo.update("book-1", "entry-c", { parentId: "entry-b", sectionId: "section-1", relatedEntryIds: ["entry-other", "entry-a"] });
    expect(updated?.parentId).toBe("entry-b");
    expect(updated?.relatedEntryIds).toEqual(["entry-a"]);
  });

  it("回退到旧修订时若旧父条目已成为自己的后代，拒绝回退以免成环", async () => {
    const storage = await createTwoBookStorage();
    const repo = createStoryJingweiEntryRepository(storage);
    await repo.create(entryInput({ id: "entry-p", title: "父" }));
    await repo.create(entryInput({ id: "entry-c", title: "子", parentId: "entry-p" }));
    // 把 entry-c 移到根：这次更新前的快照里 parentId 仍是 entry-p
    await repo.update("book-1", "entry-c", { parentId: null, revisionReason: "move" });
    const [moveRevision] = await repo.listRevisions("book-1", "entry-c");
    expect(moveRevision?.snapshot?.parentId).toBe("entry-p");
    // 再把 entry-p 挂到 entry-c 下；此时回退 entry-c 会得到 c → p → c 的环
    await repo.update("book-1", "entry-p", { parentId: "entry-c" });
    await expect(repo.revertToRevision("book-1", "entry-c", moveRevision!.id)).rejects.toMatchObject({ code: "JINGWEI_PARENT_CYCLE" });
    expect((await repo.getById("book-1", "entry-c"))?.parentId).toBeNull();
  });
});
