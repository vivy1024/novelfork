import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import { createBookRepository } from "../../jingwei/repositories/book-repo.js";
import { createStoryJingweiEntryRepository } from "../../jingwei/repositories/entry-repo.js";
import { createStoryJingweiSectionRepository } from "../../jingwei/repositories/section-repo.js";
import { ensureNarrativeMemorySchema, upsertCharacterKernel } from "../storage.js";
import { DEFAULT_KERNEL_FIELDS } from "../types.js";
import { buildKernelCards } from "./kernel-channel.js";

const tempDirs: string[] = [];
const now = new Date("2026-08-25T00:00:00.000Z");

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-kernel-channel-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
  await createBookRepository(storage).create({
    id: "book-1",
    name: "测试书",
    jingweiMode: "dynamic",
    currentChapter: 20,
    createdAt: now,
    updatedAt: now,
  });
  await createStoryJingweiSectionRepository(storage).create({
    id: "sec-characters",
    bookId: "book-1",
    key: "characters",
    name: "角色",
    description: "",
    icon: null,
    order: 1,
    enabled: true,
    showInSidebar: true,
    participatesInAi: true,
    defaultVisibility: "tracked",
    fieldsJson: [],
    builtinKind: "characters",
    sourceTemplate: null,
    createdAt: now,
    updatedAt: now,
  });
  ensureNarrativeMemorySchema(storage);
  return storage;
}

async function createCharacter(storage: StorageDatabase, status: "confirmed" | "needs-review"): Promise<void> {
  await createStoryJingweiEntryRepository(storage).create({
    id: "entry-xue",
    bookId: "book-1",
    sectionId: "sec-characters",
    title: "薛行之",
    contentMd: "",
    summaryMd: "",
    tags: [],
    aliases: [],
    customFields: {},
    relatedChapterNumbers: [],
    relatedEntryIds: [],
    visibilityRule: { type: "tracked" },
    participatesInAi: true,
    tokenBudget: null,
    priorityTier: "core",
    layer: "canon",
    importance: 80,
    summaryL0: "薛行之",
    category: "characters",
    fields: {},
    status,
    createdAt: now,
    updatedAt: now,
  });
}

function seedKernel(storage: StorageDatabase): void {
  upsertCharacterKernel(storage, {
    id: "kernel:book-1:薛行之",
    bookId: "book-1",
    characterId: "薛行之",
    entryStatus: "active",
    fields: { motivation: "查清旧案真相" },
    evidence: [],
    updatedChapter: 3,
    updatedAt: now.toISOString(),
    origin: "settle",
  });
}

function kernelCards(storage: StorageDatabase, confirmedCharacterNames: readonly string[]) {
  return buildKernelCards({
    storage,
    bookId: "book-1",
    characterIds: ["薛行之"],
    confirmedCharacterNames,
    fields: DEFAULT_KERNEL_FIELDS,
    stateSummaryMaxChars: 200,
  });
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("character-kernel channel author confirmation gate", () => {
  it("does not inject a kernel when the confirmed name list excludes the character", async () => {
    const storage = await createStorage();
    try {
      await createCharacter(storage, "needs-review");
      seedKernel(storage);
      expect(kernelCards(storage, [])).toEqual([]);
    } finally {
      storage.close();
    }
  });

  it("injects the kernel once the character is in the confirmed name list", async () => {
    const storage = await createStorage();
    try {
      await createCharacter(storage, "confirmed");
      seedKernel(storage);
      const cards = kernelCards(storage, ["薛行之"]);
      expect(cards).toHaveLength(1);
      expect(cards[0]?.content).toContain("查清旧案真相");
    } finally {
      storage.close();
    }
  });
});
