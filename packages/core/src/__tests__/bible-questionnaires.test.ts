import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { createStorageDatabase, type StorageDatabase } from "../storage/db.js";
import { runStorageMigrations } from "../storage/migrations-runner.js";
import {
  createBookRepository,
  createBiblePremiseRepository,
  createBibleCharacterRepository,
  createQuestionnaireResponseRepository,
  createQuestionnaireTemplateRepository,
  createRatifyQuestionnaireForChapter,
  loadBuiltinQuestionnaireTemplates,
  seedQuestionnaireTemplates,
  submitQuestionnaireResponse,
  suggestQuestionnaireAnswer,
  validateQuestionnaireTemplate,
} from "../bible/index.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-questionnaire-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  runStorageMigrations(storage);
  return storage;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Novel Bible Phase C questionnaire seed", () => {
  it("applies the 0004 Phase C migration with questionnaire and core shift tables", async () => {
    const storage = await createStorage();
    try {
      const migrationNames = storage.sqlite
        .prepare(`SELECT name FROM "drizzle_migrations" ORDER BY name`)
        .all()
        .map((row) => (row as { name: string }).name);
      const tableNames = storage.sqlite
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
        .all()
        .map((row) => (row as { name: string }).name);

      expect(migrationNames).toContain("0004_bible_phaseC.sql");
      expect(tableNames).toEqual(expect.arrayContaining([
        "questionnaire_template",
        "questionnaire_response",
        "core_shift",
      ]));
    } finally {
      storage.close();
    }
  });

  it("loads at least 10 valid builtin questionnaire templates across tiers", () => {
    const templates = loadBuiltinQuestionnaireTemplates();

    expect(templates.length).toBeGreaterThanOrEqual(10);
    expect(templates.filter((template) => template.tier === 1)).toHaveLength(3);
    expect(templates.filter((template) => template.tier === 2).length).toBeGreaterThanOrEqual(5);
    expect(templates.some((template) => template.tier === 3)).toBe(true);

    for (const template of templates) {
      expect(() => validateQuestionnaireTemplate(template)).not.toThrow();
      expect(template.questions.length).toBeGreaterThan(0);
      for (const question of template.questions) {
        expect(question.id).toMatch(/^[a-z0-9-]+$/u);
        expect(question.mapping.fieldPath.length).toBeGreaterThan(0);
      }
    }
  });

  it("seeds builtin questionnaire templates idempotently by id and version", async () => {
    const storage = await createStorage();
    try {
      const templates = createQuestionnaireTemplateRepository(storage);
      const first = await seedQuestionnaireTemplates(storage);
      const second = await seedQuestionnaireTemplates(storage);
      const rows = await templates.list();

      expect(first.inserted).toBeGreaterThanOrEqual(10);
      expect(second.inserted).toBe(0);
      expect(rows).toHaveLength(first.inserted);
      expect(new Set(rows.map((row) => `${row.id}@${row.version}`)).size).toBe(rows.length);
      expect(rows.every((row) => row.isBuiltin)).toBe(true);
    } finally {
      storage.close();
    }
  });

  it("submits a response transactionally and maps answers into the target Bible object", async () => {
    const storage = await createStorage();
    try {
      await seedQuestionnaireTemplates(storage);
      await seedBook(storage);
      const result = await submitQuestionnaireResponse({
        storage,
        bookId: "book-1",
        templateId: "tier1-common-premise",
        responseId: "response-1",
        answers: {
          logline: "凡人靠小瓶求长生",
          theme: "谨慎,长生",
          tone: "热血",
          "target-readers": "修仙升级流读者",
          "unique-hook": "小瓶催熟资源",
          "genre-tags": "玄幻,修仙",
        },
        answeredVia: "author",
        submittedAt: new Date("2026-04-25T04:00:00.000Z"),
      });

      const premise = await createBiblePremiseRepository(storage).getByBook("book-1");
      const response = await createQuestionnaireResponseRepository(storage).getById("book-1", result.response.id);

      expect(result.response.status).toBe("submitted");
      expect(response?.answersJson).toContain("凡人靠小瓶求长生");
      expect(premise).toMatchObject({
        bookId: "book-1",
        logline: "凡人靠小瓶求长生",
        tone: "热血",
        targetReaders: "修仙升级流读者",
        uniqueHook: "小瓶催熟资源",
      });
      expect(JSON.parse(premise?.themeJson ?? "[]")).toEqual(["谨慎", "长生"]);
      expect(JSON.parse(premise?.genreTagsJson ?? "[]")).toEqual(["玄幻", "修仙"]);
    } finally {
      storage.close();
    }
  });

  it("rolls back target writes when a mapping fails", async () => {
    const storage = await createStorage();
    try {
      await seedBook(storage);
      await createQuestionnaireTemplateRepository(storage).create({
        id: "broken-template",
        version: "1.0.0",
        genreTagsJson: JSON.stringify(["通用"]),
        tier: 1,
        targetObject: "premise",
        questionsJson: JSON.stringify([
          { id: "logline", prompt: "一句话", type: "text", mapping: { fieldPath: "logline" }, defaultSkippable: false },
          { id: "bad", prompt: "坏字段", type: "text", mapping: { fieldPath: "unknown.path" }, defaultSkippable: false },
        ]),
        isBuiltin: true,
        createdAt: new Date("2026-04-25T01:00:00.000Z"),
      });

      await expect(submitQuestionnaireResponse({
        storage,
        bookId: "book-1",
        templateId: "broken-template",
        responseId: "response-broken",
        answers: { logline: "不应落库", bad: "boom" },
      })).rejects.toThrow(/Unsupported questionnaire mapping/u);

      expect(await createBiblePremiseRepository(storage).getByBook("book-1")).toBeNull();
      expect(await createQuestionnaireResponseRepository(storage).getById("book-1", "response-broken")).toBeNull();
    } finally {
      storage.close();
    }
  });

  it("builds a dynamic ratify questionnaire for unfiled chapter entities", async () => {
    const storage = await createStorage();
    try {
      await seedBook(storage);
      await createBibleCharacterRepository(storage).create({
        id: "char-known",
        bookId: "book-1",
        name: "韩立",
        aliasesJson: "[]",
        roleType: "protagonist",
        summary: "已建档主角。",
        traitsJson: "{}",
        visibilityRuleJson: JSON.stringify({ type: "tracked" }),
        firstChapter: 1,
        lastChapter: null,
        createdAt: new Date("2026-04-25T01:00:00.000Z"),
        updatedAt: new Date("2026-04-25T01:00:00.000Z"),
      });

      const ratify = await createRatifyQuestionnaireForChapter({
        storage,
        bookId: "book-1",
        chapterNumber: 7,
        chapterText: "韩立遇见 [[人物:林间老翁]]，听说 [[设定:九阳草]] 引发 [[矛盾:灵田争夺]]。",
      });

      expect(ratify.id).toBe("ratify-questionnaire:book-1:7");
      expect(ratify.candidates.map((candidate) => `${candidate.type}:${candidate.name}`)).toEqual([
        "character:林间老翁",
        "setting:九阳草",
        "conflict:灵田争夺",
      ]);
      expect(ratify.questions).toHaveLength(3);
      expect(ratify.questions[0]).toMatchObject({ type: "single", options: ["固化", "忽略"] });
    } finally {
      storage.close();
    }
  });

  it("returns an empty AI suggestion when the provider fails", async () => {
    const suggestion = await suggestQuestionnaireAnswer({
      question: { id: "logline", prompt: "一句话", type: "text", mapping: { fieldPath: "logline" }, defaultSkippable: false },
      existingAnswers: {},
      context: { bookId: "book-1", templateId: "tier1-common-premise" },
      provider: async () => {
        throw new Error("LLM unavailable");
      },
    });

    expect(suggestion).toEqual({ answer: "", reason: "AI 建议暂不可用，请先手动填写或跳过。", degraded: true });
  });
});

async function seedBook(storage: StorageDatabase) {
  await createBookRepository(storage).create({
    id: "book-1",
    name: "凡人修仙录",
    bibleMode: "static",
    currentChapter: 1,
    createdAt: new Date("2026-04-25T01:00:00.000Z"),
    updatedAt: new Date("2026-04-25T01:00:00.000Z"),
  });
}
