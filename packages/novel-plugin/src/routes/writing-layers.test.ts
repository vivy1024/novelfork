import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StateManager } from "@vivy1024/novelfork-core";
import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import { createBookRepository } from "../engine/jingwei/repositories/book-repo.js";
import { createStoryJingweiEntryRepository } from "../engine/jingwei/repositories/entry-repo.js";
import { createStoryJingweiSectionRepository } from "../engine/jingwei/repositories/section-repo.js";
import { createWritingLayersRouter } from "./writing-layers.js";

const tempDirs: string[] = [];
const storages: StorageDatabase[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const storage of storages.splice(0)) storage.close();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createStorage(dir: string): Promise<StorageDatabase> {
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  storages.push(storage);
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
  await createBookRepository(storage).create({
    id: "book-1", name: "第一本书", jingweiMode: "dynamic", currentChapter: 1,
    createdAt: new Date("2026-01-01T00:00:00.000Z"), updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  return storage;
}

async function addEntry(storage: StorageDatabase, category: string, title: string, contentMd: string, fields: Record<string, unknown> = {}) {
  const section = await createStoryJingweiSectionRepository(storage).create({
    id: `sec-${category}-${crypto.randomUUID()}`, bookId: "book-1", key: category, name: category, description: "", icon: null, order: 0,
    enabled: true, showInSidebar: true, participatesInAi: true, defaultVisibility: "global", fieldsJson: [],
    builtinKind: category, sourceTemplate: null, createdAt: new Date(), updatedAt: new Date(),
  });
  await createStoryJingweiEntryRepository(storage).create({
    id: `entry-${crypto.randomUUID()}`, bookId: "book-1", sectionId: section.id, title, contentMd, category, fields,
    tags: [], aliases: [], customFields: {}, relatedChapterNumbers: [], relatedEntryIds: [], visibilityRule: { type: "global" },
    participatesInAi: true, tokenBudget: null, createdAt: new Date(), updatedAt: new Date(),
  });
}

async function setup() {
  const projectRoot = await tempDir("novelfork-route-layers-");
  const bookDir = join(projectRoot, "books", "book-1");
  await mkdir(join(bookDir, "story"), { recursive: true });
  const storage = await createStorage(projectRoot);
  const router = createWritingLayersRouter({ state: new StateManager(projectRoot), root: projectRoot } as never, {
    resolveBookRoot: () => bookDir,
    storage,
  });
  const put = (body: unknown) => router.request("/api/books/book-1/writing-layers", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const get = async () => (await router.request("/api/books/book-1/writing-layers")).json() as Promise<{
    bookDesign: { authorIntent: string; currentFocus: string; volumeOutline: string };
    bookRulesRaw: string;
    bookRulesText: string;
    bookRules: Array<{ title: string; content: string }>;
    notices: Array<{ field: string; legacyText?: string }>;
    revisions: Record<string, string>;
  }>;
  return { bookDir, storage, router, put, get };
}

describe("createWritingLayersRouter", () => {
  it("does not expose the removed author-profile API", async () => {
    const projectRoot = await tempDir("novelfork-route-project-");
    const state = new StateManager(projectRoot);
    const router = createWritingLayersRouter({ state, root: projectRoot } as never);

    const getRes = await router.request("/api/author-profile");
    expect(getRes.status).toBe(404);
  });

  it("GET 的当前聚焦与本书规则来自经纬，旧文件内容不会覆盖", async () => {
    const { storage, get, bookDir } = await setup();
    await addEntry(storage, "current-focus", "创作罗盘", "", { goal: "罗盘里的本章目标" });
    await addEntry(storage, "rules", "写作禁忌", "---\nprohibitions:\n  - 不得越级杀敌\n---\n规则正文。");
    await writeFile(join(bookDir, "story", "current_focus.md"), "罗盘里的本章目标\n", "utf8");

    const data = await get();

    expect(data).not.toHaveProperty("authorProfileEnabled");
    expect(data.bookDesign.currentFocus).toBe("罗盘里的本章目标");
    expect(data.bookRules).toEqual([expect.objectContaining({ title: "写作禁忌" })]);
    expect(data.bookRulesText).toContain("不得越级杀敌");
    expect(data.notices).toEqual([]);
    expect(Object.keys(data.revisions)).toEqual(["authorIntent"]);
  });

  it("存量书首次打开设置：旧文件内容迁进经纬后显示（只有文件有内容的情形）", async () => {
    const { get, bookDir } = await setup();
    await writeFile(join(bookDir, "story", "current_focus.md"), "# 当前聚焦\n\n药园日常。\n", "utf8");
    await writeFile(join(bookDir, "story", "book_rules.md"), "主角必须隐忍。\n", "utf8");

    const data = await get();

    expect(data.bookDesign.currentFocus).toBe("药园日常。");
    expect(data.bookRules.map((rule) => rule.content)).toEqual(["主角必须隐忍。"]);
  });

  it("两边都有且不同：显示经纬的值，旧聚焦作为提示返回；点「知道了」后收起", async () => {
    const { storage, get, bookDir, router } = await setup();
    await addEntry(storage, "current-focus", "创作罗盘", "", { goal: "罗盘目标" });
    await writeFile(join(bookDir, "story", "current_focus.md"), "旧设置里的聚焦\n", "utf8");

    const data = await get();
    expect(data.bookDesign.currentFocus).toBe("罗盘目标");
    expect(data.notices).toEqual([expect.objectContaining({ field: "currentFocus", legacyText: "旧设置里的聚焦" })]);

    const dismissed = await router.request("/api/books/book-1/writing-layers/notices/currentFocus/dismiss", { method: "POST" });
    expect(dismissed.status).toBe(200);
    expect((await get()).notices).toEqual([]);
  });
});

describe("writing-layers 写盘安全", () => {
  it("拒绝通过 writing-layers 写卷纲：422 + explanation，volume_outline.md 与其它字段都不动", async () => {
    const { bookDir, put } = await setup();
    await writeFile(join(bookDir, "story", "volume_outline.md"), "经纬导出的卷纲\n", "utf8");

    const response = await put({ bookDesign: { volumeOutline: "面板里改的卷纲", authorIntent: "顺带改意图" } });

    expect(response.status).toBe(422);
    const body = await response.json() as { error: { code: string }; explanation: Record<string, string> };
    expect(body.error.code).toBe("VOLUME_OUTLINE_READ_ONLY");
    expect(body.explanation.suggestedAction).toContain("卷纲/大纲");
    expect(await readFile(join(bookDir, "story", "volume_outline.md"), "utf8")).toBe("经纬导出的卷纲\n");
    await expect(readFile(join(bookDir, "story", "author_intent.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("拒绝写当前聚焦与本书规则：422 + explanation，不生成任何文件副本", async () => {
    const { bookDir, put } = await setup();

    const response = await put({ bookDesign: { currentFocus: "面板里写的聚焦", authorIntent: "顺带改意图" }, bookRulesRaw: "面板里写的规则" });

    expect(response.status).toBe(422);
    const body = await response.json() as { error: { code: string }; explanation: Record<string, string> };
    expect(body.error.code).toBe("WRITING_LAYER_MOVED");
    expect(body.explanation.suggestedAction).toContain("创作罗盘");
    await expect(readFile(join(bookDir, "story", "current_focus.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(bookDir, "story", "book_rules.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(bookDir, "story", "author_intent.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("revision 不一致时拒绝保存：409 + explanation + 冲突字段，磁盘内容不被覆盖", async () => {
    const { bookDir, put, get } = await setup();
    await writeFile(join(bookDir, "story", "author_intent.md"), "最初的意图\n", "utf8");
    const loaded = await get();
    await writeFile(join(bookDir, "story", "author_intent.md"), "别处改过的意图\n", "utf8");

    const response = await put({ bookDesign: { authorIntent: "面板里的旧版改动" }, revisions: { authorIntent: loaded.revisions.authorIntent } });

    expect(response.status).toBe(409);
    const body = await response.json() as { error: { code: string }; explanation: Record<string, string>; conflictFields: string[] };
    expect(body.error.code).toBe("WRITING_LAYER_REVISION_CONFLICT");
    expect(body.conflictFields).toEqual(["authorIntent"]);
    expect(body.explanation).toMatchObject({ whatHappened: expect.stringContaining("作者意图"), whyItMatters: expect.any(String), suggestedAction: expect.any(String) });
    expect(await readFile(join(bookDir, "story", "author_intent.md"), "utf8")).toBe("别处改过的意图\n");
  });

  it("revision 一致时保存作者意图成功并返回新 revision，可连续保存", async () => {
    const { put, get } = await setup();
    const loaded = await get();
    const first = await put({ bookDesign: { authorIntent: "意图一" }, revisions: { authorIntent: loaded.revisions.authorIntent } });
    expect(first.status).toBe(200);
    const firstBody = await first.json() as { revisions: Record<string, string> };
    expect(firstBody.revisions.authorIntent).not.toBe(loaded.revisions.authorIntent);

    const second = await put({ bookDesign: { authorIntent: "意图二" }, revisions: { authorIntent: firstBody.revisions.authorIntent } });
    expect(second.status).toBe(200);
    expect((await get()).bookDesign.authorIntent).toBe("意图二\n");
  });
});
