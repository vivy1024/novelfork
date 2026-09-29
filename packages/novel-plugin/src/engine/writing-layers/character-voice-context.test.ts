import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { createBookRepository } from "../jingwei/repositories/book-repo.js";
import { createStoryJingweiEntryRepository } from "../jingwei/repositories/entry-repo.js";
import { createStoryJingweiSectionRepository } from "../jingwei/repositories/section-repo.js";
import { loadSceneVoiceConstraints } from "./character-voice-context.js";

let storage: StorageDatabase;
let tempDir: string;
const now = new Date("2026-09-01T00:00:00.000Z");

beforeEach(async () => {
  tempDir = join(tmpdir(), `novelfork-voice-context-${crypto.randomUUID()}`);
  await mkdir(tempDir, { recursive: true });
  storage = createStorageDatabase({ databasePath: join(tempDir, "novelfork.db") });
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
  await createBookRepository(storage).create({ id: "book-1", name: "声线注入", jingweiMode: "dynamic", currentChapter: 1, createdAt: now, updatedAt: now });
  await createStoryJingweiSectionRepository(storage).create({
    id: "sec-1", bookId: "book-1", key: "characters", name: "角色", description: "", icon: null, order: 1, enabled: true,
    showInSidebar: true, participatesInAi: true, defaultVisibility: "tracked", fieldsJson: [], builtinKind: "characters",
    sourceTemplate: null, createdAt: now, updatedAt: now,
  });
});

afterEach(async () => {
  storage.close();
  await rm(tempDir, { recursive: true, force: true });
});

async function createCharacter(title: string, aliases: string[], voice: unknown) {
  return createStoryJingweiEntryRepository(storage).create({
    id: crypto.randomUUID(), bookId: "book-1", sectionId: "sec-1", title, contentMd: "", category: "characters",
    fields: { voice }, customFields: {}, tags: [], aliases, relatedChapterNumbers: [], relatedEntryIds: [],
    visibilityRule: { type: "tracked" }, participatesInAi: true, tokenBudget: null, layer: "dynamic",
    status: "confirmed", createdAt: now, updatedAt: now,
  });
}

describe("loadSceneVoiceConstraints", () => {
  it("按标题与别名匹配出场角色，只注入已确认字段", async () => {
    const luChen = await createCharacter("陆沉", ["阿沉"], {
      schemaVersion: 1,
      fields: {
        positioning: { value: "冷硬克制，话少但句句落地", status: "confirmed", source: "author" },
        catchphrases: { value: ["罢了"], status: "needs-review", source: "dialogue" },
      },
    });
    await createCharacter("苏晚", [], {
      schemaVersion: 1,
      fields: { positioning: { value: "明快爱逗人", status: "confirmed", source: "author" } },
    });

    const result = await loadSceneVoiceConstraints({ storage, bookId: "book-1", characterNames: ["阿沉", "路人甲"] });

    expect(result.matchedIds).toEqual([luChen.id]);
    expect(result.text).toContain("### 陆沉");
    expect(result.text).toContain("冷硬克制");
    // 待审字段不注入；未出场角色不注入。
    expect(result.text).not.toContain("罢了");
    expect(result.text).not.toContain("苏晚");
    expect(result.corruptedIds).toEqual([]);
  });

  it("声线损坏的条目单独列出，不注入也不抛错", async () => {
    const broken = await createCharacter("坏卡", [], { schemaVersion: 9 });
    const result = await loadSceneVoiceConstraints({ storage, bookId: "book-1", characterNames: ["坏卡"] });
    expect(result.text).toBe("");
    expect(result.corruptedIds).toEqual([broken.id]);
  });

  it("没有出场角色或没有匹配时返回空约束", async () => {
    expect((await loadSceneVoiceConstraints({ storage, bookId: "book-1", characterNames: [] })).text).toBe("");
    expect((await loadSceneVoiceConstraints({ storage, bookId: "book-1", characterNames: ["无名"] })).matchedIds).toEqual([]);
  });
});
