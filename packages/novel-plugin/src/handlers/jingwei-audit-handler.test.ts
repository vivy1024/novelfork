import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { createBookRepository } from "../engine/jingwei/repositories/book-repo.js";
import { createStoryJingweiEntryRepository } from "../engine/jingwei/repositories/entry-repo.js";
import { createStoryJingweiSectionRepository } from "../engine/jingwei/repositories/section-repo.js";
import type { CreateStoryJingweiEntryInput, CreateStoryJingweiSectionInput } from "../engine/jingwei/types.js";
import { handleJingweiAudit } from "./jingwei-audit-handler.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-jingwei-audit-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
  await createBookRepository(storage).create({
    id: "book-1",
    name: "凡人修仙录",
    jingweiMode: "dynamic",
    currentChapter: 12,
    createdAt: new Date("2026-05-20T01:00:00.000Z"),
    updatedAt: new Date("2026-05-20T01:00:00.000Z"),
  });
  return storage;
}

function section(input: Partial<CreateStoryJingweiSectionInput> & Pick<CreateStoryJingweiSectionInput, "id" | "key" | "name">): CreateStoryJingweiSectionInput {
  const now = new Date("2026-05-20T02:00:00.000Z");
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
  const now = new Date("2026-05-20T03:00:00.000Z");
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
    priorityTier: "auto",
    createdAt: now,
    updatedAt: now,
    ...input,
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("jingwei.audit lore gate", () => {
  it("reports entries that are not active, confirmed, and AI-visible", async () => {
    const storage = await createStorage();
    try {
      const sections = createStoryJingweiSectionRepository(storage);
      const entries = createStoryJingweiEntryRepository(storage);
      await sections.create(section({ id: "sec-people", key: "people", name: "人物" }));
      await sections.create(section({ id: "sec-disabled", key: "secret", name: "禁用分区", participatesInAi: false }));
      await entries.create(entry({ id: "ok", sectionId: "sec-people", title: "韩立", contentMd: "可进入 AI 的确认设定。" }));
      await entries.create(entry({ id: "optout", sectionId: "sec-people", title: "隐藏条目", contentMd: "不得进入 AI。", participatesInAi: false }));
      await entries.create(entry({ id: "draft", sectionId: "sec-people", title: "草稿条目", contentMd: "尚未确认。" }));
      await entries.create(entry({ id: "archived", sectionId: "sec-people", title: "归档条目", contentMd: "已归档。" }));
      await entries.create(entry({ id: "section-optout", sectionId: "sec-disabled", title: "禁用分区条目", contentMd: "分区不参与 AI。" }));
      storage.sqlite.prepare("UPDATE story_jingwei_entry SET status = 'draft' WHERE id = 'draft'").run();
      storage.sqlite.prepare("UPDATE story_jingwei_entry SET lifecycle = 'archived' WHERE id = 'archived'").run();

      const result = await handleJingweiAudit({ bookId: "book-1", storage });

      expect(result.ok).toBe(true);
      expect(result.summary).toContain("发现 4 项");
      expect(result.data.checkedEntryCount).toBe(5);
      expect(result.data.findings.map((finding) => finding.entryId)).toEqual(expect.arrayContaining(["optout", "draft", "archived", "section-optout"]));
      expect(result.data.findings.find((finding) => finding.entryId === "optout")?.reasons).toContain("entry.participates_in_ai=false");
      expect(result.data.findings.find((finding) => finding.entryId === "draft")?.reasons).toContain("status=draft");
      expect(result.data.findings.find((finding) => finding.entryId === "archived")?.reasons).toContain("lifecycle=archived");
      expect(result.data.findings.find((finding) => finding.entryId === "section-optout")?.reasons).toContain("section.participates_in_ai=false");
      expect(result.data.findings.some((finding) => finding.entryId === "ok")).toBe(false);
    } finally {
      storage.close();
    }
  });
});
