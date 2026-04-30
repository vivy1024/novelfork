import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { Hono } from "hono";
import {
  checkFormat,
  checkPublishReadiness,
  estimateBookAiRatio,
  generateAiDisclosure,
  loadDictionary,
  scanBook,
  type ChapterAiScoreInput,
  type FormatChapterInput,
  type PublishReadinessChapterInput,
  type SensitiveWord,
  type SupportedPlatform,
} from "@vivy1024/novelfork-core/compliance";

import type { RouterContext } from "./context.js";

const SUPPORTED_PLATFORMS = ["qidian", "jjwxc", "fanqie", "qimao", "generic"] as const;
const SENSITIVE_CATEGORIES = ["political", "sexual", "violence", "religious", "racial", "crime-glorify", "minor-protection", "medical-mislead", "custom"] as const;
const SENSITIVE_SEVERITIES = ["block", "warn", "suggest"] as const;

interface LoadedChapter {
  readonly chapterNumber: number;
  readonly title: string;
  readonly content: string;
  readonly aiTasteScore: number;
}

function isSupportedPlatform(value: unknown): value is SupportedPlatform {
  return typeof value === "string" && (SUPPORTED_PLATFORMS as readonly string[]).includes(value);
}

function parsePlatform(value: unknown): SupportedPlatform | null {
  if (value === undefined || value === null || value === "") return "generic";
  return isSupportedPlatform(value) ? value : null;
}

async function readJsonBody(c: { req: { json: <T>() => Promise<T> } }): Promise<Record<string, unknown>> {
  return c.req.json<Record<string, unknown>>().catch(() => ({}));
}

function countWords(text: string): number {
  return Array.from(text.replace(/\s/g, "")).length;
}

function normalizeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function resolveBodyAiScore(body: Record<string, unknown>, chapterNumber: number): number | undefined {
  const aiScores = body.aiScores;
  if (Array.isArray(aiScores)) {
    const matched = aiScores.find((entry) => {
      if (!entry || typeof entry !== "object") return false;
      return (entry as { chapterNumber?: unknown }).chapterNumber === chapterNumber;
    });
    if (matched && typeof matched === "object") {
      return normalizeNumber((matched as { aiTasteScore?: unknown; score?: unknown }).aiTasteScore)
        ?? normalizeNumber((matched as { score?: unknown }).score);
    }
  }
  if (aiScores && typeof aiScores === "object") {
    return normalizeNumber((aiScores as Record<string, unknown>)[String(chapterNumber)]);
  }
  return undefined;
}

function resolveChapterAiScore(meta: Record<string, unknown>, body: Record<string, unknown>, chapterNumber: number): number {
  return resolveBodyAiScore(body, chapterNumber)
    ?? normalizeNumber(meta.detectionScore)
    ?? normalizeNumber(meta.aiTasteScore)
    ?? 0;
}

async function readChapterFile(ctx: RouterContext, bookId: string, chapterNumber: number): Promise<string> {
  const chaptersDir = join(ctx.state.bookDir(bookId), "chapters");
  const padded = String(chapterNumber).padStart(4, "0");
  const files = await readdir(chaptersDir).catch(() => []);
  const filename = files.find((file) => file.startsWith(padded) && file.endsWith(".md"));
  if (!filename) return "";
  return readFile(join(chaptersDir, filename), "utf-8").catch(() => "");
}

async function loadChapters(ctx: RouterContext, bookId: string, body: Record<string, unknown>): Promise<ReadonlyArray<LoadedChapter>> {
  const index = await ctx.state.loadChapterIndex(bookId);
  return Promise.all(index.map(async (meta) => {
    const record = meta as Record<string, unknown>;
    const chapterNumber = typeof record.number === "number" ? record.number : 0;
    return {
      chapterNumber,
      title: typeof record.title === "string" ? record.title : `第${chapterNumber}章`,
      content: await readChapterFile(ctx, bookId, chapterNumber),
      aiTasteScore: resolveChapterAiScore(record, body, chapterNumber),
    };
  }));
}

function toFormatChapters(chapters: ReadonlyArray<LoadedChapter>): ReadonlyArray<FormatChapterInput> {
  return chapters.map((chapter) => ({
    chapterNumber: chapter.chapterNumber,
    title: chapter.title,
    content: chapter.content,
  }));
}

function toAiChapters(chapters: ReadonlyArray<LoadedChapter>): ReadonlyArray<ChapterAiScoreInput> {
  return chapters.map((chapter) => ({
    chapterNumber: chapter.chapterNumber,
    chapterTitle: chapter.title,
    wordCount: countWords(chapter.content),
    aiTasteScore: chapter.aiTasteScore,
  }));
}

function toPublishChapters(chapters: ReadonlyArray<LoadedChapter>): ReadonlyArray<PublishReadinessChapterInput> {
  return chapters.map((chapter) => ({
    chapterNumber: chapter.chapterNumber,
    title: chapter.title,
    content: chapter.content,
    aiTasteScore: chapter.aiTasteScore,
  }));
}

function buildBookFormatConfig(book: Record<string, unknown>, body: Record<string, unknown>): { readonly title?: string; readonly synopsis?: string } {
  return {
    title: typeof book.title === "string" ? book.title : undefined,
    synopsis: typeof body.synopsis === "string"
      ? body.synopsis
      : typeof book.synopsis === "string"
        ? book.synopsis
        : typeof book.description === "string"
          ? book.description
          : undefined,
  };
}

function normalizeSensitiveWord(value: unknown): SensitiveWord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.word !== "string" || record.word.trim().length === 0) return null;
  const category = typeof record.category === "string" && (SENSITIVE_CATEGORIES as readonly string[]).includes(record.category)
    ? record.category as SensitiveWord["category"]
    : "custom";
  const severity = typeof record.severity === "string" && (SENSITIVE_SEVERITIES as readonly string[]).includes(record.severity)
    ? record.severity as SensitiveWord["severity"]
    : "warn";
  const platforms = Array.isArray(record.platforms)
    ? record.platforms.filter(isSupportedPlatform)
    : ["generic" as SupportedPlatform];
  return {
    word: record.word.trim(),
    category,
    severity,
    platforms: platforms.length > 0 ? platforms : ["generic"],
    ...(typeof record.suggestion === "string" ? { suggestion: record.suggestion } : {}),
  };
}

function normalizeSensitiveWords(value: unknown): ReadonlyArray<SensitiveWord> {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeSensitiveWord).filter((word): word is SensitiveWord => word !== null);
}

function filterCustomWords(words: ReadonlyArray<SensitiveWord>, platform: SupportedPlatform): ReadonlyArray<SensitiveWord> {
  return words.filter((word) => word.platforms.length === 0 || word.platforms.includes(platform) || word.platforms.includes("generic"));
}

function dictionarySummary(platform: SupportedPlatform, customWordCount: number) {
  const dictionary = loadDictionary(platform);
  const severityCounts = {
    block: dictionary.filter((word) => word.severity === "block").length,
    warn: dictionary.filter((word) => word.severity === "warn").length,
    suggest: dictionary.filter((word) => word.severity === "suggest").length,
  };
  return {
    platform,
    wordCount: dictionary.length,
    customWordCount,
    categories: [...new Set(dictionary.map((word) => word.category))],
    severityCounts,
  };
}

function invalidPlatformResponse(c: { json: (value: unknown, status?: number) => Response }, value: unknown): Response {
  return c.json({ error: `Unsupported platform: ${String(value)}` }, 400);
}

export function createComplianceRouter(ctx: RouterContext): Hono {
  const app = new Hono();
  const importedWords: SensitiveWord[] = [];

  app.post("/api/books/:bookId/compliance/sensitive-scan", async (c) => {
    const body = await readJsonBody(c);
    const platform = parsePlatform(body.platform);
    if (!platform) return invalidPlatformResponse(c, body.platform);
    const bookId = c.req.param("bookId");
    await ctx.state.loadBookConfig(bookId);
    const chapters = await loadChapters(ctx, bookId, body);
    const customWords = filterCustomWords([...importedWords, ...normalizeSensitiveWords(body.customWords)], platform);
    return c.json({ result: scanBook(toFormatChapters(chapters), platform, customWords) });
  });

  app.post("/api/books/:bookId/compliance/ai-ratio", async (c) => {
    const body = await readJsonBody(c);
    const platform = parsePlatform(body.platform);
    if (!platform) return invalidPlatformResponse(c, body.platform);
    const bookId = c.req.param("bookId");
    await ctx.state.loadBookConfig(bookId);
    const chapters = await loadChapters(ctx, bookId, body);
    return c.json({ report: estimateBookAiRatio(bookId, toAiChapters(chapters), platform) });
  });

  app.post("/api/books/:bookId/compliance/format-check", async (c) => {
    const body = await readJsonBody(c);
    const platform = parsePlatform(body.platform);
    if (!platform) return invalidPlatformResponse(c, body.platform);
    const bookId = c.req.param("bookId");
    const book = await ctx.state.loadBookConfig(bookId) as unknown as Record<string, unknown>;
    const chapters = await loadChapters(ctx, bookId, body);
    return c.json({ result: checkFormat(toFormatChapters(chapters), buildBookFormatConfig(book, body), platform) });
  });

  app.post("/api/books/:bookId/compliance/publish-readiness", async (c) => {
    const body = await readJsonBody(c);
    const platform = parsePlatform(body.platform);
    if (!platform) return invalidPlatformResponse(c, body.platform);
    const bookId = c.req.param("bookId");
    const book = await ctx.state.loadBookConfig(bookId) as unknown as Record<string, unknown>;
    const chapters = await loadChapters(ctx, bookId, body);
    const report = checkPublishReadiness(bookId, platform, toPublishChapters(chapters), buildBookFormatConfig(book, body));
    return c.json({
      report: {
        ...report,
        continuity: report.continuity ?? {
          status: "unknown",
          reason: "连续性指标尚未接入发布检查数据源。",
        },
      },
    });
  });

  app.post("/api/books/:bookId/compliance/ai-disclosure", async (c) => {
    const body = await readJsonBody(c);
    const platform = parsePlatform(body.platform);
    if (!platform) return invalidPlatformResponse(c, body.platform);
    const bookId = c.req.param("bookId");
    await ctx.state.loadBookConfig(bookId);
    const chapters = await loadChapters(ctx, bookId, body);
    const aiRatioReport = estimateBookAiRatio(bookId, toAiChapters(chapters), platform);
    return c.json({
      disclosure: generateAiDisclosure({
        bookId,
        platform,
        aiRatioReport,
        aiUsageTypes: Array.isArray(body.aiUsageTypes) ? body.aiUsageTypes.map(String) : undefined,
        modelNames: Array.isArray(body.modelNames) ? body.modelNames.map(String) : undefined,
        humanEditDescription: typeof body.humanEditDescription === "string" ? body.humanEditDescription : undefined,
      }),
    });
  });

  app.get("/api/compliance/dictionaries", (c) => c.json({
    dictionaries: SUPPORTED_PLATFORMS.map((platform) => dictionarySummary(platform, importedWords.length)),
  }));

  app.post("/api/compliance/dictionaries/import", async (c) => {
    const body = await readJsonBody(c);
    const source = Array.isArray(body.words) ? body.words : Array.isArray(body.dictionary) ? body.dictionary : [];
    const dictionary = normalizeSensitiveWords(source);
    importedWords.push(...dictionary);
    return c.json({ importedCount: dictionary.length, dictionary, totalCustomWordCount: importedWords.length });
  });

  return app;
}
