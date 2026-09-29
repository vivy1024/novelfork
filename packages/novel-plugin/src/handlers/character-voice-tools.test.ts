import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import type { RuntimeTextGenerator, ToolExecutionContext } from "@vivy1024/novelfork-core/plugins";

import { createBookRepository } from "../engine/jingwei/repositories/book-repo.js";
import { createStoryJingweiEntryRepository } from "../engine/jingwei/repositories/entry-repo.js";
import { createStoryJingweiSectionRepository } from "../engine/jingwei/repositories/section-repo.js";
import { executeCharacterVoiceTool } from "./character-voice-tools.js";
import type { TrustedRuntimeBookBinding } from "./runtime-domain-tools.js";

let storage: StorageDatabase;
let tempDir: string;
let binding: TrustedRuntimeBookBinding;

beforeEach(async () => {
  tempDir = join(tmpdir(), `novelfork-voice-tools-${crypto.randomUUID()}`);
  const root = join(tempDir, "book-1");
  await mkdir(join(root, "chapters", "第一卷"), { recursive: true });
  binding = { bookId: "book-1", root };
  storage = createStorageDatabase({ databasePath: join(tempDir, "novelfork.db") });
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
  const now = new Date("2026-09-01T00:00:00.000Z");
  await createBookRepository(storage).create({ id: "book-1", name: "声线工具", jingweiMode: "dynamic", currentChapter: 1, createdAt: now, updatedAt: now });
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

async function createCharacter(title: string, fields: Record<string, unknown>, aliases: string[] = []) {
  const now = new Date("2026-09-01T00:00:00.000Z");
  return createStoryJingweiEntryRepository(storage).create({
    id: crypto.randomUUID(), bookId: "book-1", sectionId: "sec-1", title, contentMd: "", category: "characters",
    fields, customFields: fields, tags: [], aliases, relatedChapterNumbers: [], relatedEntryIds: [],
    visibilityRule: { type: "tracked" }, participatesInAi: true, tokenBudget: null, createdAt: now, updatedAt: now,
  });
}

function context(generateText?: RuntimeTextGenerator): ToolExecutionContext {
  return {
    sessionId: "narrator-1", runtimeProjectId: "project", projectRoot: "", projectType: "novel", enabledPluginIds: ["novel"], resourceBindings: {},
    ...(generateText ? { generateText } : {}),
  };
}

const run = (name: string, input: Record<string, unknown>, generateText?: RuntimeTextGenerator) =>
  executeCharacterVoiceTool(name, input, binding, context(generateText), { storage });

describe("叙述者角色声线工具", () => {
  it("按角色名读取声线，给出状态、待补充与当前注入预览", async () => {
    const lu = await createCharacter("陆沉", {
      personality: "沉默寡言",
      voice: { schemaVersion: 1, fields: { whenLying: { value: "撒谎时话多", status: "confirmed", source: "author" } } },
    }, ["阿沉"]);
    const result = await run("character.voice.read", { characterName: "阿沉" });
    expect(result.ok).toBe(true);
    const data = result.data as { entryId: string; expectedVersion: number; fields: { key: string; statusLabel: string; value: unknown }[]; constraintPreview: string };
    expect(data).toMatchObject({ entryId: lu.id, expectedVersion: lu.version });
    expect(data.fields.find((field) => field.key === "whenLying")).toMatchObject({ statusLabel: "已确认", value: "撒谎时话多" });
    expect(data.fields.find((field) => field.key === "positioning")).toMatchObject({ statusLabel: "待补充", value: "待补充" });
    expect(data.constraintPreview).toContain("撒谎时话多");
    expect(result.summary).toContain("已确认 1 项");
  });

  it("草稿走会话模型并扫描近章，写成待审且不进入注入预览；旧版本返回冲突", async () => {
    const lu = await createCharacter("陆沉", { personality: "沉默寡言" });
    await createCharacter("苏晚晴", {});
    await writeFile(join(binding.root, "chapters", "第一卷", "0001_初见.md"), [
      "陆沉冷声道：“啧，滚。”",
      "“啧，别碰它。”陆沉说。",
      "苏晚晴笑道：“师兄又凶人家。”",
    ].join("\n"), "utf8");
    const generateText = vi.fn(async () => ({ text: JSON.stringify({ fields: { underAnger: { value: "越气话越少", evidence: ["沉默寡言"] } } }) }));

    const drafted = await run("character_voice_draft", { entryId: lu.id, expectedVersion: lu.version, dialogueSamples: ["不必。"] }, generateText);
    expect(drafted.ok).toBe(true);
    expect(generateText).toHaveBeenCalledTimes(1);
    const data = drafted.data as { expectedVersion: number; draft: { chapterSampleCount: number; modelUsed: boolean }; fields: { key: string; status: string; source?: string }[]; constraintPreview: string };
    expect(data.expectedVersion).toBe(lu.version + 1);
    expect(data.draft).toMatchObject({ chapterSampleCount: 2, modelUsed: true });
    expect(data.fields.find((field) => field.key === "underAnger")).toMatchObject({ status: "needs-review", source: "模型增补" });
    expect(data.fields.find((field) => field.key === "catchphrases")).toMatchObject({ status: "needs-review" });
    expect(data.constraintPreview).toBe("");
    expect(drafted.summary).toContain("作者在角色卡「声线」区块逐项确认");

    const stale = await run("character.voice.draft", { entryId: lu.id, expectedVersion: lu.version });
    expect(stale).toMatchObject({ ok: false, error: "CHARACTER_VOICE_CONFLICT", data: { status: 409, explanation: { suggestedAction: expect.any(String) } } });
  });

  it("没有会话模型时只出规则初稿并如实提示；缺版本、找不到或重名角色时带解释失败", async () => {
    const lu = await createCharacter("陆沉", { personality: "沉默寡言" });
    const noModel = await run("character.voice.draft", { entryId: lu.id, expectedVersion: lu.version, useModel: true });
    expect(noModel.ok).toBe(true);
    expect((noModel.data as { warnings: { code: string }[] }).warnings.map((item) => item.code)).toContain("MODEL_UNAVAILABLE");

    expect(await run("character.voice.draft", { entryId: lu.id })).toMatchObject({ ok: false, error: "character-voice-version-required" });
    expect(await run("character.voice.read", {})).toMatchObject({ ok: false, error: "character-voice-target-required" });
    expect(await run("character.voice.read", { characterName: "无名氏" })).toMatchObject({ ok: false, error: "character-voice-character-not-found" });
    await createCharacter("陆沉", {});
    const ambiguous = await run("character.voice.read", { characterName: "陆沉" });
    expect(ambiguous).toMatchObject({ ok: false, error: "character-voice-character-ambiguous" });
    expect((ambiguous.data as { candidates: unknown[] }).candidates).toHaveLength(2);
  });
});
