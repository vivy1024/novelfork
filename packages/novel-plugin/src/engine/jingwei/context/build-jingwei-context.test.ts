import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";
import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { createBookRepository } from "../repositories/book-repo.js";
import { createJingweiCharacterRepository } from "../repositories/character-repo.js";
import { createStoryJingweiEntryRepository } from "../repositories/entry-repo.js";
import { createStoryJingweiSectionRepository } from "../repositories/section-repo.js";
import { buildJingweiContext } from "./build-jingwei-context.js";

const tempDirs: string[] = [];
const storages: StorageDatabase[] = [];

async function setup(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-canonical-context-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  storages.push(storage);
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
  const now = new Date("2026-08-01T00:00:00.000Z");
  await createBookRepository(storage).create({
    id: "book-1",
    name: "权威源测试",
    jingweiMode: "dynamic",
    currentChapter: 12,
    createdAt: now,
    updatedAt: now,
  });
  await createStoryJingweiSectionRepository(storage).create({
    id: "characters-section",
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
    createdAt: now,
    updatedAt: now,
  });
  return storage;
}

async function createEntry(
  storage: StorageDatabase,
  input: { id: string; title: string; visibilityRule: { type: "global" | "tracked" | "nested"; keywords?: string[]; parentEntryIds?: string[] }; relatedEntryIds?: string[] },
) {
  const now = new Date("2026-08-01T01:00:00.000Z");
  return createStoryJingweiEntryRepository(storage).create({
    id: input.id,
    bookId: "book-1",
    sectionId: "characters-section",
    title: input.title,
    contentMd: `${input.title}的正式经纬内容`,
    category: "characters",
    fields: {},
    customFields: {},
    tags: [],
    aliases: [],
    relatedChapterNumbers: [],
    relatedEntryIds: input.relatedEntryIds ?? [],
    visibilityRule: input.visibilityRule,
    participatesInAi: true,
    tokenBudget: null,
    createdAt: now,
    updatedAt: now,
  });
}

afterEach(async () => {
  for (const storage of storages.splice(0)) storage.close();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("canonical Jingwei context", () => {
  it("reads story_jingwei_entry only when legacy and canonical rows coexist", async () => {
    const storage = await setup();
    await createEntry(storage, { id: "canonical", title: "正式角色", visibilityRule: { type: "global" } });
    await createJingweiCharacterRepository(storage).create({
      id: "legacy",
      bookId: "book-1",
      name: "旧表角色",
      aliasesJson: "[]",
      roleType: "配角",
      summary: "只存在旧表，不应进入核心上下文。",
      traitsJson: "{}",
      visibilityRuleJson: '{"type":"global"}',
      firstChapter: null,
      lastChapter: null,
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    });

    const result = await buildJingweiContext({ storage, bookId: "book-1", currentChapter: 12 });

    expect(result.items.map((item) => item.name)).toContain("正式角色");
    expect(result.items.map((item) => item.name)).not.toContain("旧表角色");
  });

  it("keeps tracked matching and resolves nested entries to at most the canonical graph", async () => {
    const storage = await setup();
    await createEntry(storage, { id: "global", title: "全局设定", visibilityRule: { type: "global" } });
    await createEntry(storage, { id: "tracked", title: "目标角色", visibilityRule: { type: "tracked", keywords: ["目标"] } });
    await createEntry(storage, { id: "nested", title: "关联秘密", visibilityRule: { type: "nested", parentEntryIds: ["tracked"] } });

    const result = await buildJingweiContext({ storage, bookId: "book-1", currentChapter: 12, sceneText: "本章涉及目标。" });
    const names = result.items.map((item) => item.name);

    expect(names).toEqual(expect.arrayContaining(["全局设定", "目标角色", "关联秘密"]));
  });
});
