import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import { createBookRepository } from "../jingwei/repositories/book-repo.js";
import { createStoryJingweiEntryRepository } from "../jingwei/repositories/entry-repo.js";
import { createStoryJingweiSectionRepository } from "../jingwei/repositories/section-repo.js";
import { readCurrentFocusDocFromStorage } from "../jingwei/current-focus.js";
import {
  ensureLayerAuthorityMigrated,
  LEGACY_BOOK_RULES_REVIEW_TITLE,
  listAuthoritativeBookRules,
  readLayerAuthorityMarker,
  runLayerAuthorityMigration,
} from "./layer-authority.js";
import { resolveWritingLayers, saveBookDesign } from "./layer-store.js";

const tempDirs: string[] = [];
const storages: StorageDatabase[] = [];

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "novelfork-layer-authority-"));
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  storages.push(storage);
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
  await createBookRepository(storage).create({
    id: "book-1",
    name: "测试书",
    jingweiMode: "dynamic",
    currentChapter: 1,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  const bookRoot = join(dir, "book-1");
  await mkdir(join(bookRoot, "story"), { recursive: true });
  return { storage, bookRoot, bookId: "book-1" };
}

async function addEntry(storage: StorageDatabase, input: { category: string; title: string; contentMd: string; fields?: Record<string, unknown>; status?: "confirmed" | "needs-review" }) {
  const sections = createStoryJingweiSectionRepository(storage);
  const existing = (await sections.listByBook("book-1")).find((section) => section.key === input.category);
  const sectionId = existing?.id ?? (await sections.create({
    id: `sec-${input.category}`,
    bookId: "book-1",
    key: input.category,
    name: input.category,
    description: "",
    icon: null,
    order: 0,
    enabled: true,
    showInSidebar: true,
    participatesInAi: true,
    defaultVisibility: "global",
    fieldsJson: [],
    builtinKind: input.category,
    sourceTemplate: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  })).id;
  return createStoryJingweiEntryRepository(storage).create({
    id: `entry-${crypto.randomUUID()}`,
    bookId: "book-1",
    sectionId,
    title: input.title,
    contentMd: input.contentMd,
    category: input.category,
    fields: input.fields ?? {},
    tags: [],
    aliases: [],
    customFields: {},
    relatedChapterNumbers: [],
    relatedEntryIds: [],
    visibilityRule: { type: "global" },
    participatesInAi: true,
    tokenBudget: null,
    status: input.status ?? "confirmed",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

async function liveEntries(storage: StorageDatabase, category: string) {
  return (await createStoryJingweiEntryRepository(storage).listByBook("book-1")).filter((entry) => entry.category === category);
}

afterEach(async () => {
  for (const storage of storages.splice(0)) storage.close();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("当前聚焦迁移：旧 current_focus.md → 经纬创作罗盘", () => {
  it("只有文件有内容：写进罗盘的本章目标，按作者内容处理", async () => {
    const { storage, bookRoot, bookId } = await setup();
    await writeFile(join(bookRoot, "story", "current_focus.md"), "# 当前聚焦\n\n林舟通过守门人试炼。\n", "utf8");

    const { marker } = await runLayerAuthorityMigration({ storage, bookId, bookRoot });

    expect(marker.currentFocus?.outcome).toBe("migrated");
    expect(readCurrentFocusDocFromStorage(storage, bookId)).toBe("林舟通过守门人试炼。");
    const [entry] = await liveEntries(storage, "current-focus");
    expect(entry).toMatchObject({ status: "confirmed", fields: expect.objectContaining({ goal: "林舟通过守门人试炼。" }) });
  });

  it("两边内容相同：什么都不改，也不提示", async () => {
    const { storage, bookRoot, bookId } = await setup();
    await addEntry(storage, { category: "current-focus", title: "创作罗盘", contentMd: "林舟通过守门人试炼。", fields: { goal: "林舟通过守门人试炼。" } });
    await writeFile(join(bookRoot, "story", "current_focus.md"), "# 当前聚焦\n\n林舟通过守门人试炼。\n", "utf8");

    const { marker } = await runLayerAuthorityMigration({ storage, bookId, bookRoot });

    expect(marker.currentFocus?.outcome).toBe("same");
    expect(await liveEntries(storage, "current-focus")).toHaveLength(1);
    expect((await resolveWritingLayers({ bookRoot, storage, bookId })).notices).toEqual([]);
  });

  it("两边都有且不同：保留罗盘，旧内容作为提示带给作者，不丢", async () => {
    const { storage, bookRoot, bookId } = await setup();
    await addEntry(storage, { category: "current-focus", title: "创作罗盘", contentMd: "", fields: { goal: "罗盘里的目标" } });
    await writeFile(join(bookRoot, "story", "current_focus.md"), "旧设置里的聚焦\n", "utf8");

    const layers = await resolveWritingLayers({ bookRoot, storage, bookId });

    expect(readCurrentFocusDocFromStorage(storage, bookId)).toBe("罗盘里的目标");
    expect(layers.bookDesign.currentFocus).toBe("罗盘里的目标");
    expect(layers.notices).toEqual([expect.objectContaining({ field: "currentFocus", legacyText: "旧设置里的聚焦" })]);
  });

  it("文件为空或只是模板：不建条目", async () => {
    const { storage, bookRoot, bookId } = await setup();
    await writeFile(join(bookRoot, "story", "current_focus.md"), "# 当前聚焦\n\n## 当前重点\n\n（描述接下来 1-3 章最需要优先推进的内容。）\n", "utf8");

    const { marker } = await runLayerAuthorityMigration({ storage, bookId, bookRoot });

    expect(marker.currentFocus?.outcome).toBe("empty");
    expect(await liveEntries(storage, "current-focus")).toHaveLength(0);
  });

  it("幂等：重复迁移不重复建条目；作者在罗盘里改过后也不会被旧文件覆盖", async () => {
    const { storage, bookRoot, bookId } = await setup();
    await writeFile(join(bookRoot, "story", "current_focus.md"), "旧聚焦\n", "utf8");
    await runLayerAuthorityMigration({ storage, bookId, bookRoot });
    const [entry] = await liveEntries(storage, "current-focus");
    await createStoryJingweiEntryRepository(storage).update(bookId, entry!.id, { fieldsPatch: { goal: "作者新改的目标" }, contentMd: "作者新改的目标" });

    await runLayerAuthorityMigration({ storage, bookId, bookRoot });
    await ensureLayerAuthorityMigrated({ storage, bookId, bookRoot });

    expect(await liveEntries(storage, "current-focus")).toHaveLength(1);
    expect(readCurrentFocusDocFromStorage(storage, bookId)).toBe("作者新改的目标");
  });
});

describe("本书规则迁移：旧 book_rules.md → 经纬写作规则", () => {
  it("只有文件有内容：建一条已确认的写作规则，写章立刻生效", async () => {
    const { storage, bookRoot, bookId } = await setup();
    await writeFile(join(bookRoot, "story", "book_rules.md"), "---\nprohibitions:\n  - 不得越级杀敌\n---\n主角必须隐忍。\n", "utf8");

    const layers = await resolveWritingLayers({ bookRoot, storage, bookId });

    expect(layers.bookRuleEntries).toHaveLength(1);
    expect(layers.bookRulesText).toContain("不得越级杀敌");
    expect(layers.bookRules?.rules.prohibitions).toEqual(["不得越级杀敌"]);
    const [entry] = await liveEntries(storage, "rules");
    expect(entry).toMatchObject({ status: "confirmed", participatesInAi: true });
  });

  it("两边内容相同：不建新条目", async () => {
    const { storage, bookRoot, bookId } = await setup();
    await addEntry(storage, { category: "rules", title: "本书规则", contentMd: "主角必须隐忍。" });
    await writeFile(join(bookRoot, "story", "book_rules.md"), "主角必须隐忍。\n", "utf8");

    const { marker } = await runLayerAuthorityMigration({ storage, bookId, bookRoot });

    expect(marker.bookRules?.outcome).toBe("same");
    expect(await liveEntries(storage, "rules")).toHaveLength(1);
  });

  it("两边都有且不同：保留经纬，旧规则进一条待确认条目，不参与写章", async () => {
    const { storage, bookRoot, bookId } = await setup();
    await addEntry(storage, { category: "rules", title: "文风基调", contentMd: "基调：冷峻。" });
    await writeFile(join(bookRoot, "story", "book_rules.md"), "旧版规则：不得写网络用语。\n", "utf8");

    const layers = await resolveWritingLayers({ bookRoot, storage, bookId });

    expect(layers.bookRuleEntries.map((rule) => rule.content)).toEqual(["基调：冷峻。"]);
    const review = (await liveEntries(storage, "rules")).find((entry) => entry.title === LEGACY_BOOK_RULES_REVIEW_TITLE);
    expect(review).toMatchObject({ status: "needs-review", participatesInAi: false, contentMd: "旧版规则：不得写网络用语。" });
    expect(layers.notices.map((notice) => notice.field)).toEqual(["bookRules"]);

    // 作者删掉待确认条目后，同一份旧文件不会再把它建回来。
    await createStoryJingweiEntryRepository(storage).softDelete(bookId, review!.id);
    await runLayerAuthorityMigration({ storage, bookId, bookRoot });
    expect((await liveEntries(storage, "rules")).some((entry) => entry.title === LEGACY_BOOK_RULES_REVIEW_TITLE)).toBe(false);
  });

  it("模板规则文件不迁移", async () => {
    const { storage, bookRoot, bookId } = await setup();
    await writeFile(join(bookRoot, "story", "book_rules.md"), "# 写作规则\n\n在这里记录本书的写作约束、禁忌和统一口径。\n", "utf8");

    await runLayerAuthorityMigration({ storage, bookId, bookRoot });

    expect(await listAuthoritativeBookRules(storage, bookId)).toEqual([]);
    expect((await readLayerAuthorityMarker(bookRoot)).bookRules?.outcome).toBe("empty");
  });

  it("待确认的写作规则不算生效规则", async () => {
    const { storage, bookId } = await setup();
    await addEntry(storage, { category: "rules", title: "草稿", contentMd: "还没确认。", status: "needs-review" });
    expect(await listAuthoritativeBookRules(storage, bookId)).toEqual([]);
  });
});

describe("写前检查与设置页同源", () => {
  it("存量书只有旧 current_focus.md：preflight 读到的当前聚焦与设置页显示的一致，都来自罗盘", async () => {
    const { storage, bookRoot, bookId } = await setup();
    await writeFile(join(bookRoot, "book.json"), JSON.stringify({ id: bookId, title: "测试书", genre: "xianxia", platform: "qidian", status: "writing", language: "zh" }), "utf8");
    await writeFile(join(bookRoot, "story", "current_focus.md"), "# 当前聚焦\n\n药园试探小瓶秘密。\n", "utf8");

    const { handleWritePreflight } = await import("../../handlers/write-preflight.js");
    const preflight = await handleWritePreflight({ bookId, storage, bookRoot, chapterNumber: 1 });
    const settings = await resolveWritingLayers({ bookRoot, storage, bookId });

    expect(preflight.currentFocus).toMatchObject({ status: "available", sourceFile: "jingwei:current-focus" });
    expect(preflight.currentFocus.content).toBe(settings.bookDesign.currentFocus);
    expect(settings.bookDesign.currentFocus).toBe("药园试探小瓶秘密。");
  });

  it("罗盘与旧文件不同：preflight 只按罗盘，不读旧文件", async () => {
    const { storage, bookRoot, bookId } = await setup();
    await writeFile(join(bookRoot, "book.json"), JSON.stringify({ id: bookId, title: "测试书", genre: "xianxia", platform: "qidian", status: "writing", language: "zh" }), "utf8");
    await addEntry(storage, { category: "current-focus", title: "创作罗盘", contentMd: "", fields: { goal: "罗盘目标" } });
    await writeFile(join(bookRoot, "story", "current_focus.md"), "旧文件目标\n", "utf8");

    const { handleWritePreflight } = await import("../../handlers/write-preflight.js");
    const preflight = await handleWritePreflight({ bookId, storage, bookRoot, chapterNumber: 1 });

    expect(preflight.currentFocus.content).toBe("罗盘目标");
    expect(JSON.stringify(preflight)).not.toContain("旧文件目标");
  });
});

describe("旧文件不再被写入", () => {
  it("保存作者意图只写作者意图文件，不会生成 current_focus.md / book_rules.md", async () => {
    const { bookRoot } = await setup();
    await saveBookDesign(bookRoot, { authorIntent: "长期方向" });

    expect(await readFile(join(bookRoot, "story", "author_intent.md"), "utf8")).toBe("长期方向\n");
    await expect(readFile(join(bookRoot, "story", "current_focus.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(bookRoot, "story", "book_rules.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("迁移只读旧文件，不改它们", async () => {
    const { storage, bookRoot, bookId } = await setup();
    await writeFile(join(bookRoot, "story", "current_focus.md"), "旧聚焦\n", "utf8");
    await writeFile(join(bookRoot, "story", "book_rules.md"), "旧规则\n", "utf8");

    await runLayerAuthorityMigration({ storage, bookId, bookRoot });

    expect(await readFile(join(bookRoot, "story", "current_focus.md"), "utf8")).toBe("旧聚焦\n");
    expect(await readFile(join(bookRoot, "story", "book_rules.md"), "utf8")).toBe("旧规则\n");
  });
});
