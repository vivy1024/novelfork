import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { createBookRepository } from "../engine/jingwei/repositories/book-repo.js";
import { createStoryJingweiEntryRepository } from "../engine/jingwei/repositories/entry-repo.js";
import { createStoryJingweiSectionRepository } from "../engine/jingwei/repositories/section-repo.js";
import { insertNarrativeEvent } from "../engine/narrative-memory/storage.js";
import type { NarrativeEvent } from "../engine/narrative-memory/types.js";
import {
  extractRevisionPairs,
  saveChapterAiDraft,
  STYLE_VAULT_RELATIVE_DIR,
} from "../engine/writing-layers/style-vault.js";
import { createPendingReviewRouter, type PendingReviewSummary } from "./pending-review.js";

const tempDirs: string[] = [];
const storages: StorageDatabase[] = [];

async function createFixture(): Promise<{ storage: StorageDatabase; bookRoot: string }> {
  const dir = join(tmpdir(), `novelfork-pending-review-${crypto.randomUUID()}`);
  tempDirs.push(dir);
  const bookRoot = join(dir, "book-1");
  await mkdir(join(bookRoot, "chapters", "卷01"), { recursive: true });
  await mkdir(join(bookRoot, "story"), { recursive: true });
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  storages.push(storage);
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
  const now = new Date("2026-09-01T00:00:00.000Z");
  await createBookRepository(storage).create({
    id: "book-1", name: "待确认聚合测试", jingweiMode: "dynamic", currentChapter: 1, createdAt: now, updatedAt: now,
  });
  await createStoryJingweiSectionRepository(storage).create({
    id: "sec-1", bookId: "book-1", key: "features", name: "角色与推进", description: "", icon: null, order: 1, enabled: true,
    showInSidebar: true, participatesInAi: true, defaultVisibility: "tracked", fieldsJson: [], builtinKind: null,
    sourceTemplate: null, createdAt: now, updatedAt: now,
  });
  return { storage, bookRoot };
}

afterEach(async () => {
  for (const storage of storages.splice(0)) storage.close();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function app(storage: StorageDatabase, bookRoot: string): Hono {
  return new Hono().route("/", createPendingReviewRouter({ storage, resolveBookRoot: () => bookRoot }));
}

async function createEntry(storage: StorageDatabase, body: {
  title: string;
  category: string;
  fields?: Record<string, unknown>;
  layer?: "canon" | "dynamic";
  status?: "confirmed" | "needs-review";
  contentMd?: string;
}) {
  const now = new Date("2026-09-01T00:00:00.000Z");
  return createStoryJingweiEntryRepository(storage).create({
    id: crypto.randomUUID(), bookId: "book-1", sectionId: "sec-1", title: body.title, contentMd: body.contentMd ?? "",
    category: body.category, fields: body.fields ?? {}, customFields: body.fields ?? {}, tags: [], aliases: [],
    relatedChapterNumbers: [], relatedEntryIds: [], visibilityRule: { type: "tracked" }, participatesInAi: true,
    tokenBudget: null, layer: body.layer ?? "dynamic", status: body.status ?? "confirmed", createdAt: now, updatedAt: now,
  });
}

function event(input: Partial<NarrativeEvent> & Pick<NarrativeEvent, "id" | "subject" | "predicate" | "object">): NarrativeEvent {
  return {
    id: input.id,
    bookId: "book-1",
    chapterNumber: input.chapterNumber ?? 12,
    eventType: input.eventType ?? "world_fact_introduced",
    subject: input.subject,
    predicate: input.predicate,
    object: input.object,
    evidenceText: input.evidenceText ?? "证据文本",
    confidence: input.confidence ?? 0.8,
    source: input.source ?? "settle",
    status: input.status ?? "pending",
    riskLevel: input.riskLevel ?? "low",
    createdAt: input.createdAt ?? "2026-09-01T00:00:00.000Z",
  };
}

async function writeStylePreset(bookRoot: string, rules: Array<{ text: string; status: string }>, options: {
  samples?: Array<{ id: string; text: string }>;
} = {}): Promise<void> {
  await writeFile(join(bookRoot, "story", "style_preset.json"), `${JSON.stringify({
    schemaVersion: 1,
    name: "本书文风",
    generalRules: [],
    sources: [
      {
        id: "author-revisions",
        title: "作者改稿",
        rules: [],
        samples: (options.samples ?? []).map((sample) => ({
          id: sample.id, sceneType: "general", text: sample.text, evidence: "测试", transfer: "transferable", status: "confirmed",
        })),
      },
      {
        id: "ref-1",
        title: "某参考作品",
        rules: rules.map((rule, index) => ({
          text: rule.text, evidence: `证据 ${index}`, transfer: "transferable", status: rule.status,
        })),
        samples: [],
      },
    ],
    bookVoice: { tone: "", narrativeVoice: "", principles: [] },
    fingerprint: null,
  }, null, 2)}\n`, "utf8");
}

async function writeChapter(bookRoot: string, number: number, fileName: string, text: string): Promise<void> {
  await writeFile(join(bookRoot, "chapters", "卷01", fileName), text, "utf8");
  await writeFile(join(bookRoot, "chapters", "index.json"), `${JSON.stringify([
    { number, title: `第 ${number} 章`, fileName: `卷01/${fileName}`, wordCount: text.length, updatedAt: "2026-09-01T00:00:00.000Z" },
  ], null, 2)}\n`, "utf8");
}

const summaryOf = async (response: Response): Promise<PendingReviewSummary> => await response.json() as PendingReviewSummary;
const groupOf = (summary: PendingReviewSummary, kind: string) => summary.groups.find((group) => group.kind === kind)!;

describe("待确认聚合路由", () => {
  it("空结果：六类计数为 0，explanation 说明口径与入口", async () => {
    const { storage, bookRoot } = await createFixture();
    const server = app(storage, bookRoot);
    const response = await server.request("/api/books/book-1/pending-review");
    expect(response.status).toBe(200);
    const summary = await summaryOf(response);
    expect(summary.total).toBe(0);
    expect(summary.groups.map((group) => group.kind)).toEqual(["voice", "styleRule", "foreshadow", "event", "fact", "revision"]);
    for (const group of summary.groups) {
      expect(group.count).toBe(0);
      expect(group.items).toEqual([]);
    }
    expect(summary.explanation).toContain("没有待处理项");
    expect(summary.explanation).toContain("声线");
    expect(summary.explanation).toContain("文风金库");
  });

  it("聚合六类来源，计数、位置与一句话摘要齐全", async () => {
    const { storage, bookRoot } = await createFixture();

    // 声线：角色卡有 voice，一个待审字段、九个待补充。
    await createEntry(storage, {
      title: "陆沉",
      category: "characters",
      fields: {
        personality: "沉默寡言",
        voice: {
          schemaVersion: 1,
          fields: { catchphrases: { value: ["啧"], status: "needs-review", source: "dialogue" } },
        },
      },
    });
    // 非角色条目带 voice 不算声线；没生成过声线的角色不出现。
    await createEntry(storage, { title: "青云山", category: "locations", fields: { voice: { schemaVersion: 1, fields: {} } } });
    await createEntry(storage, { title: "苏晚晴", category: "characters", fields: {} });

    // 伏笔草稿：章后结算写的 foreshadowing + needs-review；已确认的不出现。
    await createEntry(storage, {
      title: "断剑来历",
      category: "foreshadowing",
      layer: "dynamic",
      status: "needs-review",
      fields: { status: "已埋设", plantedChapter: 3, description: "旧剑缺了一角" },
    });
    await createEntry(storage, { title: "山门之谜", category: "foreshadowing", status: "confirmed", fields: {} });

    // 待审叙事事件：最新章的是「本章提议」，更早章的归到事实/关系草案。
    insertNarrativeEvent(storage, event({ id: "ev-latest", subject: "陆沉", predicate: "学会", object: "御剑", chapterNumber: 12 }));
    insertNarrativeEvent(storage, event({ id: "ev-earlier-rel", subject: "陆沉", predicate: "信任", object: "苏晚晴", chapterNumber: 3, eventType: "relationship_changed" }));
    insertNarrativeEvent(storage, event({ id: "ev-done", subject: "陆沉", predicate: "离开", object: "山门", chapterNumber: 12, status: "applied" }));

    // 文风规则：来源包里一条待审、一条已确认。
    await writeStylePreset(bookRoot, [
      { text: "短句收在动作前", status: "needs-review" },
      { text: "对话先行", status: "confirmed" },
    ]);

    // 改稿段：AI 原稿与作者现稿相近但不同 → 未采纳对照段。
    const aiText = "他走进雨里，没有回头，伞落在门后。\n远处钟声又响了一遍，城里的人都睡了。";
    const authorText = "他走进大雨里，头也不回，伞还是落在门后。\n远处的钟声像隔着水汽，闷闷地又响了一遍，满城的人都睡了。";
    const revisionCount = extractRevisionPairs(aiText, authorText).length;
    expect(revisionCount).toBeGreaterThan(0);
    await saveChapterAiDraft(bookRoot, { chapterNumber: 3, text: aiText, source: "pipeline.write", now: new Date("2026-09-01T00:00:00.000Z") });
    await writeChapter(bookRoot, 3, "0003_雨夜.md", authorText);

    const server = app(storage, bookRoot);
    const response = await server.request("/api/books/book-1/pending-review");
    expect(response.status).toBe(200);
    const summary = await summaryOf(response);
    expect(summary.total).toBe(5 + revisionCount);

    const voice = groupOf(summary, "voice");
    expect(voice.count).toBe(1);
    expect(voice.items[0]).toMatchObject({
      location: "角色「陆沉」",
      resolveAt: "角色卡 › 声线",
      target: { kind: "jingwei-entry" },
    });
    expect(voice.items[0]!.summary).toContain("1 项待审");
    expect(voice.items[0]!.summary).toContain("9 项待补充");

    const styleRule = groupOf(summary, "styleRule");
    expect(styleRule.count).toBe(1);
    expect(styleRule.items[0]).toMatchObject({
      location: "来源包「某参考作品」",
      summary: "短句收在动作前",
      target: { kind: "style-panel" },
    });

    const foreshadow = groupOf(summary, "foreshadow");
    expect(foreshadow.count).toBe(1);
    expect(foreshadow.items[0]).toMatchObject({
      location: "第 3 章埋下",
      summary: "断剑来历",
      target: { kind: "jingwei-entry" },
    });

    const eventGroup = groupOf(summary, "event");
    expect(eventGroup.count).toBe(1);
    expect(eventGroup.items[0]).toMatchObject({ location: "第 12 章", target: { kind: "events" } });
    expect(eventGroup.items[0]!.summary).toContain("陆沉");

    const factGroup = groupOf(summary, "fact");
    expect(factGroup.count).toBe(1);
    expect(factGroup.items[0]).toMatchObject({ location: "第 3 章" });
    expect(factGroup.items[0]!.summary).toContain("关系草案");

    const revision = groupOf(summary, "revision");
    expect(revision.count).toBeGreaterThan(0);
    expect(revision.items[0]).toMatchObject({ location: "第 3 章", target: { kind: "vault", chapterNumber: 3 }, resolveAt: "文风金库 › 采纳为范文" });
  });

  it("已采纳的改稿段不再出现；limit 只截摘要、不截计数", async () => {
    const { storage, bookRoot } = await createFixture();
    const aiText = "他走进雨里，没有回头，伞落在门后。\n远处钟声又响了一遍，城里的人都睡了。";
    const authorText = "他走进大雨里，头也不回，伞还是落在门后。\n远处的钟声像隔着水汽，闷闷地又响了一遍，满城的人都睡了。";
    const pairs = extractRevisionPairs(aiText, authorText);
    expect(pairs.length).toBeGreaterThan(0);
    await saveChapterAiDraft(bookRoot, { chapterNumber: 3, text: aiText, source: "pipeline.write", now: new Date("2026-09-01T00:00:00.000Z") });
    await writeChapter(bookRoot, 3, "0003_雨夜.md", authorText);

    const server = app(storage, bookRoot);
    const before = await summaryOf(await server.request("/api/books/book-1/pending-review"));
    expect(groupOf(before, "revision").count).toBe(pairs.length);

    // 采纳全部改稿段（与采纳路径同一 id 算法），聚合应为 0。
    const { adoptRevisionSamples } = await import("../engine/writing-layers/style-vault.js");
    await adoptRevisionSamples(bookRoot, pairs.map((pair) => ({ chapterNumber: 3, authorText: pair.authorText, aiText: pair.aiText })), null);
    const after = await summaryOf(await server.request("/api/books/book-1/pending-review"));
    expect(groupOf(after, "revision").count).toBe(0);
    expect(groupOf(after, "revision").items).toEqual([]);

    // 多个角色都有待审声线时，count 是全量、items 被 limit 截断。
    for (let index = 0; index < 7; index += 1) {
      await createEntry(storage, {
        title: `角色${index}`,
        category: "characters",
        fields: { voice: { schemaVersion: 1, fields: { positioning: { value: `冷场 ${index}`, status: "needs-review" } } } },
      });
    }
    const limited = await summaryOf(await server.request("/api/books/book-1/pending-review?limit=2"));
    expect(groupOf(limited, "voice").count).toBe(7);
    expect(groupOf(limited, "voice").items).toHaveLength(2);
    const defaulted = await summaryOf(await server.request("/api/books/book-1/pending-review"));
    expect(groupOf(defaulted, "voice").items).toHaveLength(5);
  });

  it("损坏的声线进入 warnings 而不进列表；预设损坏同样告警，其余分项不受影响", async () => {
    const { storage, bookRoot } = await createFixture();
    await createEntry(storage, { title: "坏卡", category: "characters", fields: { voice: { schemaVersion: 9 } } });
    await createEntry(storage, {
      title: "好卡",
      category: "characters",
      fields: { voice: { schemaVersion: 1, fields: { positioning: { value: "横", status: "needs-review" } } } },
    });
    await writeFile(join(bookRoot, "story", "style_preset.json"), "{bad json\n", "utf8");
    await mkdir(join(bookRoot, STYLE_VAULT_RELATIVE_DIR), { recursive: true });
    await writeFile(join(bookRoot, STYLE_VAULT_RELATIVE_DIR, "chapter-0009.json"), "not-json", "utf8");
    await writeChapter(bookRoot, 9, "0009_断章.md", "一夜无话。第二天他照常去了街口买包子，店主多送了他一个。");

    const server = app(storage, bookRoot);
    const response = await server.request("/api/books/book-1/pending-review");
    expect(response.status).toBe(200);
    const summary = await summaryOf(response);
    expect(groupOf(summary, "voice").count).toBe(1);
    expect(groupOf(summary, "voice").items[0]).toMatchObject({ location: "角色「好卡」" });
    expect(groupOf(summary, "styleRule").count).toBe(0);
    const codes = summary.warnings.map((warning) => warning.code);
    expect(codes).toContain("CHARACTER_VOICE_CORRUPTED");
    expect(codes).toContain("STYLE_PRESET_CORRUPTED");
    expect(codes).toContain("STYLE_VAULT_DRAFT_CORRUPTED");
  });

  it("非法书籍 ID 返回带解释的 400", async () => {
    const { storage, bookRoot } = await createFixture();
    const server = app(storage, bookRoot);
    const response = await server.request(`/api/books/${encodeURIComponent("../x")}/pending-review`);
    expect(response.status).toBe(400);
    const body = await response.json() as { code?: string; explanation?: Record<string, string> };
    expect(body.code).toBe("INVALID_BOOK_ID");
    expect(Object.keys(body.explanation ?? {}).sort()).toEqual(["suggestedAction", "whatHappened", "whyItMatters"].sort());
  });
});
