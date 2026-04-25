import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createBookRepository } from "../bible/repositories/book-repo.js";
import { buildJingweiContext } from "../jingwei/context/build-jingwei-context.js";
import { createStoryJingweiEntryRepository } from "../jingwei/repositories/entry-repo.js";
import { createStoryJingweiSectionRepository } from "../jingwei/repositories/section-repo.js";
import type { CreateStoryJingweiEntryInput, CreateStoryJingweiSectionInput } from "../jingwei/types.js";
import { createStorageDatabase, type StorageDatabase } from "../storage/db.js";
import { runStorageMigrations } from "../storage/migrations-runner.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-jingwei-context-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  runStorageMigrations(storage);
  await createBookRepository(storage).create({
    id: "book-1",
    name: "凡人修仙录",
    bibleMode: "dynamic",
    currentChapter: 5,
    createdAt: new Date("2026-04-25T01:00:00.000Z"),
    updatedAt: new Date("2026-04-25T01:00:00.000Z"),
  });
  return storage;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function section(input: Partial<CreateStoryJingweiSectionInput> & Pick<CreateStoryJingweiSectionInput, "id" | "key" | "name">): CreateStoryJingweiSectionInput {
  const now = new Date("2026-04-25T02:00:00.000Z");
  return {
    bookId: "book-1",
    description: "",
    icon: null,
    order: 0,
    enabled: true,
    showInSidebar: true,
    participatesInAi: true,
    defaultVisibility: "tracked",
    fieldsJson: [],
    builtinKind: null,
    sourceTemplate: null,
    createdAt: now,
    updatedAt: now,
    ...input,
  };
}

function entry(input: Partial<CreateStoryJingweiEntryInput> & Pick<CreateStoryJingweiEntryInput, "id" | "sectionId" | "title" | "contentMd">): CreateStoryJingweiEntryInput {
  const now = new Date("2026-04-25T03:00:00.000Z");
  return {
    bookId: "book-1",
    tags: [],
    aliases: [],
    customFields: {},
    relatedChapterNumbers: [],
    relatedEntryIds: [],
    visibilityRule: { type: "tracked" },
    participatesInAi: true,
    tokenBudget: null,
    createdAt: now,
    updatedAt: now,
    ...input,
  };
}

describe("buildJingweiContext", () => {
  it("loads enabled AI sections, applies timeline rules, and matches tracked entries by title, aliases, and keywords", async () => {
    const storage = await createStorage();
    try {
      const sections = createStoryJingweiSectionRepository(storage);
      const entries = createStoryJingweiEntryRepository(storage);
      await sections.create(section({ id: "sec-memory", key: "core-memory", name: "核心记忆", builtinKind: "core-memory", defaultVisibility: "global", order: 0 }));
      await sections.create(section({ id: "sec-people", key: "people", name: "人物", builtinKind: "people", order: 1 }));
      await sections.create(section({ id: "sec-disabled", key: "hidden", name: "隐藏", enabled: false, participatesInAi: true, order: 2 }));
      await sections.create(section({ id: "sec-local", key: "local", name: "本地", enabled: true, participatesInAi: false, order: 3 }));
      await entries.create(entry({ id: "memory", sectionId: "sec-memory", title: "小瓶规则", contentMd: "小瓶可以催熟灵草。", visibilityRule: { type: "global", visibleAfterChapter: 1 } }));
      await entries.create(entry({ id: "matched-title", sectionId: "sec-people", title: "韩立", contentMd: "谨慎低调。", visibilityRule: { type: "tracked" } }));
      await entries.create(entry({ id: "matched-alias", sectionId: "sec-people", title: "掌天瓶", contentMd: "神秘法宝。", aliases: ["小绿瓶"], visibilityRule: { type: "tracked" } }));
      await entries.create(entry({ id: "matched-keyword", sectionId: "sec-people", title: "墨大夫", contentMd: "前期威胁。", visibilityRule: { type: "tracked", keywords: ["七玄门"] } }));
      await entries.create(entry({ id: "future", sectionId: "sec-people", title: "元婴秘密", contentMd: "未来情报。", visibilityRule: { type: "global", visibleAfterChapter: 99 } }));
      await entries.create(entry({ id: "entry-disabled", sectionId: "sec-disabled", title: "禁用栏目", contentMd: "不应出现。", visibilityRule: { type: "global" } }));
      await entries.create(entry({ id: "entry-local", sectionId: "sec-local", title: "本地栏目", contentMd: "不参与 AI。", visibilityRule: { type: "global" } }));
      await entries.create(entry({ id: "entry-optout", sectionId: "sec-people", title: "不参与", contentMd: "不应出现。", visibilityRule: { type: "global" }, participatesInAi: false }));

      const result = await buildJingweiContext({ storage, bookId: "book-1", currentChapter: 5, sceneText: "韩立摸出小绿瓶，想起七玄门往事。" });
      expect(result.items[0]?.entryId).toBe("memory");
      expect(result.items.map((item) => item.entryId).sort()).toEqual(["matched-alias", "matched-keyword", "matched-title", "memory"]);
      expect(result.items.map((item) => item.text)).toContain("【核心记忆】小瓶规则：小瓶可以催熟灵草。");
      expect(result.droppedEntryIds).toEqual([]);
      expect(result.sectionStats).toEqual([
        { sectionId: "sec-memory", sectionName: "核心记忆", count: 1 },
        { sectionId: "sec-people", sectionName: "人物", count: 3 },
      ]);
    } finally {
      storage.close();
    }
  });

  it("expands nested entries from injected references without cycles", async () => {
    const storage = await createStorage();
    try {
      const sections = createStoryJingweiSectionRepository(storage);
      const entries = createStoryJingweiEntryRepository(storage);
      await sections.create(section({ id: "sec-people", key: "people", name: "人物", builtinKind: "people" }));
      await sections.create(section({ id: "sec-clue", key: "clue", name: "线索", defaultVisibility: "nested" }));
      await entries.create(entry({ id: "root", sectionId: "sec-people", title: "韩立", contentMd: "关联小瓶。", relatedEntryIds: ["nested-1"], visibilityRule: { type: "tracked" } }));
      await entries.create(entry({ id: "nested-1", sectionId: "sec-clue", title: "小瓶", contentMd: "只能被引用注入。", relatedEntryIds: ["nested-2"], visibilityRule: { type: "nested", parentEntryIds: ["root"] } }));
      await entries.create(entry({ id: "nested-2", sectionId: "sec-clue", title: "循环线索", contentMd: "回指根节点。", relatedEntryIds: ["root"], visibilityRule: { type: "nested", parentEntryIds: ["nested-1"] } }));

      const result = await buildJingweiContext({ storage, bookId: "book-1", currentChapter: 5, sceneText: "韩立看见异样。" });
      expect(result.items.map((item) => [item.entryId, item.source, item.text])).toEqual([
        ["root", "tracked", "【人物】韩立：关联小瓶。"],
        ["nested-1", "nested", "【自定义-线索】小瓶：只能被引用注入。"],
        ["nested-2", "nested", "【自定义-线索】循环线索：回指根节点。"],
      ]);
    } finally {
      storage.close();
    }
  });

  it("keeps core memory before lower priority items when token budget is tight", async () => {
    const storage = await createStorage();
    try {
      const sections = createStoryJingweiSectionRepository(storage);
      const entries = createStoryJingweiEntryRepository(storage);
      await sections.create(section({ id: "sec-memory", key: "core-memory", name: "核心记忆", builtinKind: "core-memory", defaultVisibility: "global", order: 0 }));
      await sections.create(section({ id: "sec-people", key: "people", name: "人物", builtinKind: "people", order: 1 }));
      await entries.create(entry({ id: "memory", sectionId: "sec-memory", title: "铁律", contentMd: "核心记忆短句。", visibilityRule: { type: "global" } }));
      await entries.create(entry({ id: "long", sectionId: "sec-people", title: "冗长人物", contentMd: "很长".repeat(80), visibilityRule: { type: "global" } }));

      const result = await buildJingweiContext({ storage, bookId: "book-1", currentChapter: 5, tokenBudget: 20 });
      expect(result.items.map((item) => item.entryId)).toEqual(["memory"]);
      expect(result.droppedEntryIds).toEqual(["long"]);
      expect(result.totalTokens).toBeLessThanOrEqual(20);
    } finally {
      storage.close();
    }
  });
});
