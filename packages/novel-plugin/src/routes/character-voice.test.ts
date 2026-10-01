import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { createBookRepository } from "../engine/jingwei/repositories/book-repo.js";
import { createStoryJingweiEntryRepository } from "../engine/jingwei/repositories/entry-repo.js";
import { createStoryJingweiSectionRepository } from "../engine/jingwei/repositories/section-repo.js";
import { buildVoiceConstraintText, readCharacterVoiceProfiles } from "../engine/writing-layers/character-voice.js";
import { createCharacterVoiceRouter, type CreateCharacterVoiceRouterOptions } from "./character-voice.js";

let storage: StorageDatabase;
let tempDir: string;
let bookRoot: string;

beforeEach(async () => {
  tempDir = join(tmpdir(), `novelfork-voice-route-${crypto.randomUUID()}`);
  bookRoot = join(tempDir, "book-1");
  await mkdir(join(bookRoot, "chapters", "第一卷"), { recursive: true });
  storage = createStorageDatabase({ databasePath: join(tempDir, "novelfork.db") });
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
  const now = new Date("2026-09-01T00:00:00.000Z");
  await createBookRepository(storage).create({ id: "book-1", name: "声线测试", jingweiMode: "dynamic", currentChapter: 1, createdAt: now, updatedAt: now });
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

function app(options: Partial<CreateCharacterVoiceRouterOptions> = {}) {
  return new Hono().route("/", createCharacterVoiceRouter({ storage, resolveBookRoot: () => bookRoot, ...options }));
}

const json = (body: unknown, method = "POST"): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function createEntry(_server: Hono, body: {
  title: string;
  category: string;
  fields: Record<string, unknown>;
  layer?: "canon" | "dynamic";
  status?: "confirmed" | "needs-review";
}) {
  const now = new Date("2026-09-01T00:00:00.000Z");
  return createStoryJingweiEntryRepository(storage).create({
    id: crypto.randomUUID(), bookId: "book-1", sectionId: "sec-1", title: body.title, contentMd: "", category: body.category,
    fields: body.fields, customFields: body.fields, tags: [], aliases: [], relatedChapterNumbers: [], relatedEntryIds: [],
    visibilityRule: { type: "tracked" }, participatesInAi: true, tokenBudget: null, layer: body.layer ?? "dynamic",
    status: body.status ?? "confirmed", createdAt: now, updatedAt: now,
  });
}

const voicePath = (entryId: string) => `/api/books/book-1/jingwei/entries/${entryId}/voice`;

describe("角色声线 HTTP", () => {
  it("读取未设置的声线为全部待补充；非角色条目与损坏数据给出带解释的错误", async () => {
    const server = app();
    const character = await createEntry(server, { title: "陆沉", category: "characters", fields: { personality: "沉默寡言" } });
    const response = await server.request(voicePath(character.id));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ entryId: character.id, version: character.version, summary: { confirmed: 0, missing: 10 } });
    expect(body.voice.fields.positioning).toEqual({ value: "", status: "missing" });

    const place = await createEntry(server, { title: "青云山", category: "locations", fields: {} });
    const notCharacter = await server.request(voicePath(place.id));
    expect(notCharacter.status).toBe(400);
    expect(await notCharacter.json()).toMatchObject({ code: "CHARACTER_VOICE_NOT_CHARACTER", explanation: { whatHappened: expect.any(String), whyItMatters: expect.any(String), suggestedAction: expect.any(String) } });

    const broken = await createEntry(server, { title: "坏卡", category: "characters", fields: { voice: { schemaVersion: 9 } } });
    const corrupted = await server.request(voicePath(broken.id));
    expect(corrupted.status).toBe(422);
    expect(await corrupted.json()).toMatchObject({ code: "CHARACTER_VOICE_CORRUPTED" });
    expect((await server.request(`${voicePath(broken.id)}/draft`, json({ expectedVersion: broken.version }))).status).toBe(422);
    const row = storage.sqlite.prepare<{ fields_json: string }>(`SELECT fields_json FROM story_jingwei_entry WHERE id = ?`).get(broken.id)!;
    expect(JSON.parse(row.fields_json).voice).toEqual({ schemaVersion: 9 });

    expect((await server.request("/api/books/book-1/jingwei/entries/missing/voice")).status).toBe(404);
  });

  it("生成草稿：扫描近章与粘贴样本，写成待审且不动其他字段与条目状态", async () => {
    const server = app();
    const lu = await createEntry(server, { title: "陆沉", category: "characters", layer: "canon", status: "confirmed", fields: { personality: "沉默寡言", core_belief: "只信手里的剑", goal: "报仇" } });
    await createEntry(server, { title: "苏晚晴", category: "characters", fields: {} });
    await writeFile(join(bookRoot, "chapters", "第一卷", "0001_初见.md"), [
      "陆沉冷声道：“啧，滚。”",
      "苏晚晴笑道：“师兄又凶人家。”",
      "“啧，别碰它。”陆沉说。",
      "陆沉看了苏晚晴一眼，说：“走吧。”",
    ].join("\n"), "utf8");

    const response = await server.request(`${voicePath(lu.id)}/draft`, json({ expectedVersion: lu.version, scanChapters: 5, dialogueSamples: ["不必。\n啧，又是你。"] }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.version).toBe(lu.version + 1);
    expect(body.draft).toMatchObject({ chapterSampleCount: 2, scannedChapters: 1, sampleCount: 4, modelUsed: false });
    expect(body.voice.fields.catchphrases).toMatchObject({ value: ["啧"], status: "needs-review", source: "dialogue" });
    expect(body.voice.fields.sentenceLength.status).toBe("needs-review");
    expect(body.voice.fields.whenLying.status).toBe("missing");
    expect(body.warnings.map((item: { code: string }) => item.code)).toContain("FIELDS_MISSING");
    // 苏晚晴的台词不应被归到陆沉名下。
    expect(JSON.stringify(body.voice)).not.toContain("凶人家");

    const row = storage.sqlite.prepare<{ fields_json: string; status: string; layer: string; participates_in_ai: number }>(
      `SELECT fields_json, status, layer, participates_in_ai FROM story_jingwei_entry WHERE id = ?`,
    ).get(lu.id)!;
    const fields = JSON.parse(row.fields_json);
    expect(fields).toMatchObject({ personality: "沉默寡言", core_belief: "只信手里的剑", goal: "报仇" });
    expect(fields.voice.fields.catchphrases.status).toBe("needs-review");
    expect(row).toMatchObject({ status: "confirmed", layer: "canon", participates_in_ai: 1 });
  });

  it("确认保存要求版本，旧版本 409，逐项确认后才进入写作约束", async () => {
    const server = app();
    const lu = await createEntry(server, { title: "陆沉", category: "characters", fields: { personality: "沉默寡言" } });
    const drafted = await (await server.request(`${voicePath(lu.id)}/draft`, json({ expectedVersion: lu.version, dialogueSamples: ["啧。滚。", "啧，别碰它。", "不必。", "走。"] }))).json();

    expect((await server.request(voicePath(lu.id), json({ fields: { positioning: { value: "话少", status: "confirmed" } } }, "PUT"))).status).toBe(400);
    const stale = await server.request(voicePath(lu.id), json({ expectedVersion: lu.version, fields: { positioning: { value: "话少", status: "confirmed" } } }, "PUT"));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "CHARACTER_VOICE_CONFLICT", explanation: { suggestedAction: expect.stringContaining("重新载入") } });
    expect((await server.request(voicePath(lu.id), json({ expectedVersion: drafted.version, fields: { tone: { value: "x", status: "confirmed" } } }, "PUT"))).status).toBe(400);

    const confirmed = await server.request(voicePath(lu.id), json({ expectedVersion: drafted.version, fields: {
      catchphrases: { value: drafted.voice.fields.catchphrases.value, status: "confirmed" },
      whenLying: { value: "撒谎时反而话多", status: "confirmed" },
    } }, "PUT"));
    expect(confirmed.status).toBe(200);
    const saved = await confirmed.json();
    expect(saved.version).toBe(drafted.version + 1);
    expect(saved.voice.fields.catchphrases).toMatchObject({ status: "confirmed", source: "dialogue" });
    expect(saved.voice.fields.whenLying).toMatchObject({ status: "confirmed", source: "author" });
    expect(saved.voice.fields.sentenceLength.status).toBe("needs-review");

    // 再次生成草稿不覆盖已确认项。
    const redraft = await (await server.request(`${voicePath(lu.id)}/draft`, json({ expectedVersion: saved.version, dialogueSamples: ["哈哈哈，好。", "哈哈哈，行。", "哈哈哈。"] }))).json();
    expect(redraft.draft.keptConfirmedKeys).toContain("catchphrases");
    expect(redraft.voice.fields.catchphrases.value).toEqual(drafted.voice.fields.catchphrases.value);

    const entries = await createStoryJingweiEntryRepository(storage).listByBook("book-1");
    const { profiles } = readCharacterVoiceProfiles(entries);
    const text = buildVoiceConstraintText(profiles, [lu.id]);
    expect(text).toContain("撒谎时反而话多");
    expect(text).toContain("「啧」");
    expect(text).not.toContain("长短句倾向");
  });

  it("请求模型增补：可用时写成待审模型来源，不可用或失败时带解释回退规则初稿", async () => {
    const generateText = vi.fn(async () => ({ text: JSON.stringify({ fields: { underAnger: { value: "越气话越少", evidence: ["沉默寡言"] } } }) }));
    const server = app({ resolveGenerateText: async () => generateText });
    const lu = await createEntry(server, { title: "陆沉", category: "characters", fields: { personality: "沉默寡言" } });
    const withModel = await (await server.request(`${voicePath(lu.id)}/draft`, json({ expectedVersion: lu.version, useModel: true }))).json();
    expect(withModel.draft.modelUsed).toBe(true);
    expect(withModel.voice.fields.underAnger).toMatchObject({ value: "越气话越少", source: "model", status: "needs-review" });
    expect(withModel.warnings.map((item: { code: string }) => item.code)).toContain("FEW_DIALOGUE_SAMPLES");

    const noModel = app({ resolveGenerateText: async () => undefined });
    const other = await createEntry(noModel, { title: "苏晚晴", category: "characters", fields: { personality: "话多" } });
    const fallback = await (await noModel.request(`${voicePath(other.id)}/draft`, json({ expectedVersion: other.version, useModel: true }))).json();
    expect(fallback.draft.modelUsed).toBe(false);
    expect(fallback.warnings.find((item: { code: string }) => item.code === "MODEL_UNAVAILABLE")).toMatchObject({ explanation: { whatHappened: expect.any(String) } });
    expect(fallback.voice.fields.positioning.status).toBe("needs-review");

    const failing = app({ resolveGenerateText: async () => async () => { throw new Error("超时"); } });
    const third = await createEntry(failing, { title: "顾长风", category: "characters", fields: { personality: "圆滑" } });
    const failed = await (await failing.request(`${voicePath(third.id)}/draft`, json({ expectedVersion: third.version, useModel: true }))).json();
    expect(failed.warnings.find((item: { code: string }) => item.code === "MODEL_FAILED")?.explanation.whatHappened).toContain("超时");
    expect(failed.draft.modelStatus).toBe("failed");
  });

  it("模型输出被截断 / 没有 JSON / 格式错误分别如实提示；缺字段说明写明是模型失败而不是没有依据", async () => {
    type Warning = { code: string; message: string; explanation: { whatHappened: string; whyItMatters: string; suggestedAction: string } };
    const draftWith = async (text: string, extra: { outputTruncated?: boolean } = {}) => {
      // 走宿主服务端文本生成（resolveTextGeneration），确认 outputTruncated 原样传到解析层。
      const server = app({ resolveTextGeneration: async () => ({ available: true, generateText: async () => ({ text, ...extra }) }) });
      const entry = await createEntry(server, { title: `角色${crypto.randomUUID().slice(0, 4)}`, category: "characters", fields: { personality: "圆滑" } });
      return (await (await server.request(`${voicePath(entry.id)}/draft`, json({ expectedVersion: entry.version, useModel: true }))).json()) as { warnings: Warning[]; draft: { modelStatus: string }; voice: { fields: Record<string, { status: string }> } };
    };
    const codes = (body: { warnings: Warning[] }) => body.warnings.map((item) => item.code);

    const truncated = await draftWith("```json\n{\"fields\": {\"underAnger\": {\"value\": \"越气越");
    expect(codes(truncated)).toContain("MODEL_OUTPUT_TRUNCATED");
    expect(truncated.draft.modelStatus).toBe("failed");
    expect(truncated.voice.fields.underAnger!.status).toBe("missing");
    const truncatedWarning = truncated.warnings.find((item) => item.code === "MODEL_OUTPUT_TRUNCATED")!;
    expect(truncatedWarning.explanation.whatHappened).toContain("截断");
    expect(truncatedWarning.explanation.suggestedAction).toContain("重试");

    const missing = truncated.warnings.find((item) => item.code === "FIELDS_MISSING")!;
    expect(missing.message).toContain("模型增补失败");
    expect(missing.explanation.whatHappened).toContain("不代表角色卡和对白里没有依据");
    expect(missing.explanation.whatHappened).not.toContain("找不到这些方面的依据");
    expect(missing.explanation.suggestedAction).toMatch(/重试.*换一个模型/u);

    const hostTruncated = await draftWith("我先分析一下这个角色", { outputTruncated: true });
    expect(codes(hostTruncated)).toContain("MODEL_OUTPUT_TRUNCATED");

    const noJson = await draftWith("这个角色话不多。");
    expect(codes(noJson)).toContain("MODEL_OUTPUT_NO_JSON");
    expect(noJson.warnings.find((item) => item.code === "MODEL_OUTPUT_NO_JSON")!.explanation.whatHappened).toContain("没有 JSON");

    const invalid = await draftWith("{\"fields\": {\"underAnger\": 1 2}}");
    expect(codes(invalid)).toContain("MODEL_OUTPUT_INVALID");

    // 所有提示都带三段解释。
    for (const body of [truncated, hostTruncated, noJson, invalid]) {
      for (const warning of body.warnings) {
        expect(warning.explanation).toMatchObject({ whatHappened: expect.any(String), whyItMatters: expect.any(String), suggestedAction: expect.any(String) });
      }
    }
  });

  it("模型输出里未转义的 ASCII 引号修补后照常写入", async () => {
    const raw = "{\"fields\": {\"underAnger\": {\"value\": \"一急就骂\"妈妈的\"\", \"evidence\": [\"记着罢，妈妈的……\"]}}}";
    const server = app({ resolveGenerateText: async () => async () => ({ text: raw }) });
    const aq = await createEntry(server, { title: "阿Q", category: "characters", fields: {} });
    const body = await (await server.request(`${voicePath(aq.id)}/draft`, json({ expectedVersion: aq.version, useModel: true, dialogueSamples: ["记着罢，妈妈的……", "畜生！", "没有。"] }))).json();
    expect(body.draft).toMatchObject({ modelUsed: true, modelStatus: "applied" });
    expect(body.voice.fields.underAnger).toMatchObject({ value: "一急就骂“妈妈的”", source: "model", status: "needs-review" });
  });

  it("不请模型时，缺字段说明是规则初稿没找到直接依据，并提示可请模型增补", async () => {
    const server = app();
    const lu = await createEntry(server, { title: "陆沉", category: "characters", fields: { personality: "沉默寡言" } });
    const body = await (await server.request(`${voicePath(lu.id)}/draft`, json({ expectedVersion: lu.version }))).json();
    expect(body.draft.modelStatus).toBe("not-requested");
    const missing = body.warnings.find((item: { code: string }) => item.code === "FIELDS_MISSING");
    expect(missing.explanation.whatHappened).toContain("规则初稿");
    expect(missing.explanation.suggestedAction).toContain("请模型增补");
  });

  it("没有任何依据时不写入、不增版本", async () => {
    const server = app();
    const blank = await createEntry(server, { title: "路人甲", category: "characters", fields: {} });
    const response = await (await server.request(`${voicePath(blank.id)}/draft`, json({ expectedVersion: blank.version }))).json();
    expect(response.version).toBe(blank.version);
    expect(response.draft.appliedKeys).toEqual([]);
    expect(response.summary.missing).toBe(10);
  });
});
