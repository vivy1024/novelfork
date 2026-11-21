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
import {
  DROPPED_POINTER_INDEX_HEADER,
  DROPPED_POINTER_INDEX_ITEM_ID,
  MAX_DROPPED_INDEX_BLOCK_CHARS,
  MAX_DROPPED_INDEX_BLOCK_TOKENS,
} from "./compose-context.js";
import {
  estimateTokens,
  MAX_DROPPED_ENTRY_POINTERS,
  MAX_DROPPED_POINTER_SNIPPET_CHARS,
} from "./token-budget.js";

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
  input: {
    id: string;
    title: string;
    contentMd?: string;
    importance?: number;
    visibilityRule: { type: "global" | "tracked" | "nested"; keywords?: string[]; parentEntryIds?: string[] };
    relatedEntryIds?: string[];
  },
) {
  const now = new Date("2026-08-01T01:00:00.000Z");
  return createStoryJingweiEntryRepository(storage).create({
    id: input.id,
    bookId: "book-1",
    sectionId: "characters-section",
    title: input.title,
    contentMd: input.contentMd ?? `${input.title}的正式经纬内容`,
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
    ...(input.importance !== undefined ? { importance: input.importance } : {}),
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
    expect(result.droppedIds).toEqual([]);
    expect(result.droppedPointers).toEqual([]);
    expect(result.droppedIndexBlock).toBeUndefined();
    expect(result.items.some((item) => item.id === DROPPED_POINTER_INDEX_ITEM_ID)).toBe(false);
  });

  it("appends a bounded dropped-pointer index when token budget trims lower-priority entries", async () => {
    const storage = await setup();
    await createEntry(storage, {
      id: "core-protagonist",
      title: "林渊",
      importance: 95,
      contentMd: "主角，剑宗外门出身，性格克制冷静。",
      visibilityRule: { type: "global" },
    });
    await createEntry(storage, {
      id: "side-merchant",
      title: "沈掌柜",
      importance: 20,
      contentMd: "黑市情报贩子，掌管城南三间暗阁，擅长伪造玉简并在多方势力之间周旋牟利，隐藏真实身份多年未曾暴露。",
      visibilityRule: { type: "tracked", keywords: ["黑市"] },
    });
    await createEntry(storage, {
      id: "side-guard",
      title: "赵统领",
      importance: 10,
      contentMd: "城防营副统领，早年受过林家恩惠，但因宗门禁令始终不敢明面相助，只在暗中传递巡逻换防时刻表。",
      visibilityRule: { type: "tracked", keywords: ["黑市"] },
    });

    const tokenBudget = 30;
    const result = await buildJingweiContext({
      storage,
      bookId: "book-1",
      currentChapter: 12,
      sceneText: "林渊夜探黑市。",
      tokenBudget,
    });

    expect(result.totalTokens).toBeLessThanOrEqual(tokenBudget);
    expect(result.droppedIds).toEqual(expect.arrayContaining(["side-merchant", "side-guard"]));
    expect(result.droppedPointers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "side-merchant",
        title: "沈掌柜",
        category: "characters",
      }),
      expect.objectContaining({
        id: "side-guard",
        title: "赵统领",
        category: "characters",
      }),
    ]));
    for (const pointer of result.droppedPointers) {
      expect(Array.from(pointer.snippet ?? "").length).toBeLessThanOrEqual(MAX_DROPPED_POINTER_SNIPPET_CHARS);
    }

    const tail = result.items[result.items.length - 1];
    expect(tail?.id).toBe(DROPPED_POINTER_INDEX_ITEM_ID);
    expect(result.droppedIndexBlock).toBe(tail?.content);
    expect(result.droppedIndexBlock).toContain(DROPPED_POINTER_INDEX_HEADER);
    expect(result.droppedIndexBlock).toContain("jingwei.read");
    expect(result.droppedIndexBlock).toContain("- [characters] 沈掌柜 (id: side-merchant)");
    expect(Array.from(result.droppedIndexBlock ?? "").length).toBeLessThanOrEqual(MAX_DROPPED_INDEX_BLOCK_CHARS);
    expect(estimateTokens(result.droppedIndexBlock ?? "")).toBeLessThanOrEqual(MAX_DROPPED_INDEX_BLOCK_TOKENS);
  });

  it("caps droppedPointers at 30 and keeps the dropped index strictly bounded when many entries are trimmed", async () => {
    const storage = await setup();
    await createEntry(storage, {
      id: "anchor",
      title: "核心设定",
      importance: 100,
      contentMd: "核心世界法则。",
      visibilityRule: { type: "global" },
    });
    for (let i = 1; i <= 36; i += 1) {
      await createEntry(storage, {
        id: `extra-${i}`,
        title: `旁支人物${i}`,
        importance: 10,
        contentMd: `这是第${i}位旁支人物的详细背景设定，记录了他在边陲城池中的过往经历、盟友关系以及未公开的秘密动机。`,
        visibilityRule: { type: "tracked", keywords: ["边陲"] },
      });
    }

    const result = await buildJingweiContext({
      storage,
      bookId: "book-1",
      currentChapter: 12,
      sceneText: "主角踏入边陲城池。",
      tokenBudget: 20,
    });

    expect(result.totalTokens).toBeLessThanOrEqual(20);
    expect(result.droppedIds.length).toBe(36);
    expect(result.droppedPointers.length).toBe(MAX_DROPPED_ENTRY_POINTERS);
    expect(result.droppedIndexBlock).toBeDefined();
    expect(result.droppedIndexBlock).toContain("jingwei.read");
    expect(Array.from(result.droppedIndexBlock ?? "").length).toBeLessThanOrEqual(MAX_DROPPED_INDEX_BLOCK_CHARS);
    expect(estimateTokens(result.droppedIndexBlock ?? "")).toBeLessThanOrEqual(MAX_DROPPED_INDEX_BLOCK_TOKENS);
  });
});
