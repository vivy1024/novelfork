import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { Hono } from "hono";
import {
  analyzeDialogue,
  analyzeRhythm,
  buildConflictMap,
  buildPovDashboard,
  createKvRepository,
  detectToneDrift,
  generateChapterHooks,
  getDailyProgress,
  getProgressTrend,
  getStorageDatabase,
  type DialogueChapterType,
  type ProgressConfig,
  type StyleProfile,
} from "@vivy1024/novelfork-core";

import { requireModelForAiAction } from "../lib/ai-gate.js";
import { providerManager } from "../lib/provider-manager.js";
import type { RouterContext } from "./context.js";

const PROGRESS_CONFIG_KEY = "writing-tools:progress-config";
const DEFAULT_PROGRESS_CONFIG: ProgressConfig = { dailyTarget: 6000 };

type JsonContext = { readonly req: { json: <T>() => Promise<T> } };
type DateQueryOptions = { readonly today?: string; readonly totalChaptersWritten?: number };
type DateSumTrendQuery = { readonly days?: number; readonly today?: string };

type ChapterLookup = {
  readonly chapterNumber: number;
  readonly content: string;
  readonly filename: string;
};

export function createWritingToolsRouter(ctx: RouterContext): Hono {
  const app = new Hono();

  app.post("/api/books/:bookId/hooks/generate", async (c) => {
    const body = await readJsonBody(c);
    const sessionLlm = await ctx.getSessionLlm(c);
    const gate = requireModelForAiAction("ai-writing", providerManager.getRuntimeStatus());
    if (!gate.ok && !sessionLlm) {
      return c.json({ gate }, 409);
    }

    const bookId = c.req.param("bookId");
    const book = await ctx.state.loadBookConfig(bookId);
    const chapterNumber = await resolveChapterNumber(ctx, bookId, readPositiveInteger(body.chapterNumber));
    const chapterContent = typeof body.chapterContent === "string"
      ? body.chapterContent
      : (await readChapter(ctx, bookId, chapterNumber))?.content;

    if (!chapterContent) {
      return c.json({ error: "Chapter content not found" }, 404);
    }

    const pendingHooks = typeof body.pendingHooks === "string"
      ? body.pendingHooks
      : await readStoryFile(ctx, bookId, "pending_hooks.md");
    const pipelineConfig = await ctx.buildPipelineConfig({ ...(sessionLlm ?? {}) });
    const hooks = await generateChapterHooks({
      input: {
        chapterContent,
        chapterNumber,
        pendingHooks,
        ...(typeof body.nextChapterIntent === "string" ? { nextChapterIntent: body.nextChapterIntent } : {}),
        bookGenre: typeof body.bookGenre === "string" ? body.bookGenre : book.genre,
      },
      client: pipelineConfig.client,
      model: pipelineConfig.model,
    });

    return c.json({ hooks });
  });

  app.get("/api/books/:bookId/pov", async (c) => {
    const bookId = c.req.param("bookId");
    await ctx.state.loadBookConfig(bookId);
    const currentChapter = readPositiveInteger(c.req.query("currentChapter"))
      ?? await resolveChapterNumber(ctx, bookId, undefined);
    const dashboard = buildPovDashboard({
      characterMatrix: await readStoryFile(ctx, bookId, "character_matrix.md"),
      chapterSummaries: await readStoryFile(ctx, bookId, "chapter_summaries.md"),
      currentChapter,
      ...(readPositiveInteger(c.req.query("gapWarningThreshold")) ? { gapWarningThreshold: readPositiveInteger(c.req.query("gapWarningThreshold")) } : {}),
      ...(c.req.query("nextChapterIntent") ? { nextChapterIntent: c.req.query("nextChapterIntent") } : {}),
    });
    return c.json({ dashboard });
  });

  app.get("/api/progress", async (c) => {
    const storage = getStorageDatabase();
    const config = await loadProgressConfig(storage);
    const options: DateQueryOptions = {
      ...(c.req.query("today") ? { today: c.req.query("today") } : {}),
      ...(readPositiveInteger(c.req.query("totalChaptersWritten")) !== undefined
        ? { totalChaptersWritten: readPositiveInteger(c.req.query("totalChaptersWritten")) }
        : {}),
    };
    const trendOptions: DateSumTrendQuery = {
      ...(readPositiveInteger(c.req.query("days")) ? { days: readPositiveInteger(c.req.query("days")) } : {}),
      ...(options.today ? { today: options.today } : {}),
    };
    const progress = await getDailyProgress(storage, config, options);
    const trend = await getProgressTrend(storage, trendOptions.days ?? 30, trendOptions.today);
    return c.json({ config, progress, trend });
  });

  app.put("/api/progress/config", async (c) => {
    const storage = getStorageDatabase();
    const body = await readJsonBody(c);
    const current = await loadProgressConfig(storage);
    const config = normalizeProgressConfig(body, current);
    await createKvRepository(storage).set(PROGRESS_CONFIG_KEY, JSON.stringify(config));
    return c.json({ config });
  });

  app.post("/api/books/:bookId/chapters/:ch/rhythm", async (c) => {
    const body = await readJsonBody(c);
    const bookId = c.req.param("bookId");
    const chapterNumber = Number.parseInt(c.req.param("ch"), 10);
    if (!Number.isInteger(chapterNumber) || chapterNumber <= 0) {
      return c.json({ error: "Invalid chapter number" }, 400);
    }
    await ctx.state.loadBookConfig(bookId);
    const content = typeof body.content === "string"
      ? body.content
      : (await readChapter(ctx, bookId, chapterNumber))?.content;
    if (!content) return c.json({ error: "Chapter not found" }, 404);
    const referenceProfile = isRecord(body.referenceProfile)
      ? body.referenceProfile as unknown as StyleProfile
      : await readStyleProfile(ctx, bookId);
    return c.json({ analysis: analyzeRhythm(content, referenceProfile) });
  });

  app.post("/api/books/:bookId/chapters/:ch/dialogue", async (c) => {
    const body = await readJsonBody(c);
    const bookId = c.req.param("bookId");
    const chapterNumber = Number.parseInt(c.req.param("ch"), 10);
    if (!Number.isInteger(chapterNumber) || chapterNumber <= 0) {
      return c.json({ error: "Invalid chapter number" }, 400);
    }
    await ctx.state.loadBookConfig(bookId);
    const content = typeof body.content === "string"
      ? body.content
      : (await readChapter(ctx, bookId, chapterNumber))?.content;
    if (!content) return c.json({ error: "Chapter not found" }, 404);
    const chapterType = typeof body.chapterType === "string" ? body.chapterType as DialogueChapterType : undefined;
    return c.json({ analysis: analyzeDialogue(content, chapterType) });
  });

  app.get("/api/books/:bookId/health", async (c) => {
    const bookId = c.req.param("bookId");
    await ctx.state.loadBookConfig(bookId);
    const chaptersDir = join(ctx.state.bookDir(bookId), "chapters");
    const { readdir, readFile: rf } = await import("node:fs/promises");
    const files = await readdir(chaptersDir).catch(() => []);
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    let totalWords = 0;
    for (const f of mdFiles) {
      const content = await rf(join(chaptersDir, f), "utf-8").catch(() => "");
      totalWords += content.length;
    }
    return c.json({
      health: {
        totalChapters: mdFiles.length,
        totalWords,
        consistencyScore: 100,
        hookRecoveryRate: 0,
        pendingHooks: [],
        aiTasteAvg: 0,
        aiTasteTrend: [],
        pacingDiversityScore: 0,
        emotionCurve: [],
        sensitiveWordTotal: 0,
        stalledConflicts: [],
        hookDebtWarnings: [],
        fatigueWarnings: [],
        povGapWarnings: [],
      },
    });
  });

  app.get("/api/books/:bookId/conflicts/map", async (c) => {
    const bookId = c.req.param("bookId");
    await ctx.state.loadBookConfig(bookId);
    const storage = getStorageDatabase();
    const { createBibleConflictRepository } = await import("@vivy1024/novelfork-core");
    const conflicts = await createBibleConflictRepository(storage).listByBook(bookId);
    return c.json({ conflicts: buildConflictMap(conflicts) });
  });

  app.get("/api/books/:bookId/arcs", async (c) => {
    const bookId = c.req.param("bookId");
    await ctx.state.loadBookConfig(bookId);
    const storage = getStorageDatabase();
    const { createBibleCharacterArcRepository } = await import("@vivy1024/novelfork-core");
    const arcs = await createBibleCharacterArcRepository(storage).listByBook(bookId);
    return c.json({ arcs });
  });

  app.post("/api/books/:bookId/chapters/:ch/tone-check", async (c) => {
    const body = await readJsonBody(c);
    const bookId = c.req.param("bookId");
    const chapterNumber = Number.parseInt(c.req.param("ch"), 10);
    if (!Number.isInteger(chapterNumber) || chapterNumber <= 0) {
      return c.json({ error: "Invalid chapter number" }, 400);
    }
    await ctx.state.loadBookConfig(bookId);
    const content = typeof body.content === "string"
      ? body.content
      : (await readChapter(ctx, bookId, chapterNumber))?.content;
    if (!content) return c.json({ error: "Chapter not found" }, 404);
    const declaredTone = typeof body.declaredTone === "string" ? body.declaredTone : "冷峻质朴";
    const referenceProfile = isRecord(body.referenceProfile)
      ? body.referenceProfile as unknown as StyleProfile
      : await readStyleProfile(ctx, bookId);
    return c.json({ result: detectToneDrift(content, declaredTone, referenceProfile ?? undefined) });
  });

  return app;
}

async function readJsonBody(c: JsonContext): Promise<Record<string, unknown>> {
  return c.req.json<Record<string, unknown>>().catch(() => ({}));
}

async function readChapter(ctx: RouterContext, bookId: string, chapterNumber: number): Promise<ChapterLookup | null> {
  const chaptersDir = join(ctx.state.bookDir(bookId), "chapters");
  const files = await readdir(chaptersDir).catch(() => []);
  const padded = String(chapterNumber).padStart(4, "0");
  const filename = files.find((file) => file.startsWith(padded) && file.endsWith(".md"));
  if (!filename) return null;
  const content = await readFile(join(chaptersDir, filename), "utf-8").catch(() => "");
  return content ? { chapterNumber, content, filename } : null;
}

async function resolveChapterNumber(ctx: RouterContext, bookId: string, explicit: number | undefined): Promise<number> {
  if (explicit !== undefined) return explicit;
  const index = await ctx.state.loadChapterIndex(bookId).catch(() => []);
  const numbers = index.map((chapter) => chapter.number).filter((value) => Number.isInteger(value) && value > 0);
  return Math.max(0, ...numbers);
}

async function readStoryFile(ctx: RouterContext, bookId: string, fileName: string): Promise<string> {
  return readFile(join(ctx.state.bookDir(bookId), "story", fileName), "utf-8").catch(() => "");
}

async function readStyleProfile(ctx: RouterContext, bookId: string): Promise<StyleProfile | undefined> {
  const raw = await readStoryFile(ctx, bookId, "style_profile.json");
  if (!raw.trim()) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed as unknown as StyleProfile : undefined;
  } catch {
    return undefined;
  }
}

async function loadProgressConfig(storage: ReturnType<typeof getStorageDatabase>): Promise<ProgressConfig> {
  const raw = await createKvRepository(storage).get(PROGRESS_CONFIG_KEY);
  if (!raw) return DEFAULT_PROGRESS_CONFIG;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? normalizeProgressConfig(parsed, DEFAULT_PROGRESS_CONFIG) : DEFAULT_PROGRESS_CONFIG;
  } catch {
    return DEFAULT_PROGRESS_CONFIG;
  }
}

function normalizeProgressConfig(value: Record<string, unknown>, fallback: ProgressConfig): ProgressConfig {
  const dailyTarget = readPositiveInteger(value.dailyTarget) ?? fallback.dailyTarget;
  return {
    dailyTarget,
    ...(readPositiveInteger(value.weeklyTarget) !== undefined ? { weeklyTarget: readPositiveInteger(value.weeklyTarget) } : fallback.weeklyTarget ? { weeklyTarget: fallback.weeklyTarget } : {}),
    ...(readPositiveInteger(value.totalChaptersTarget) !== undefined ? { totalChaptersTarget: readPositiveInteger(value.totalChaptersTarget) } : fallback.totalChaptersTarget ? { totalChaptersTarget: fallback.totalChaptersTarget } : {}),
    ...(readPositiveInteger(value.avgWordsPerChapter) !== undefined ? { avgWordsPerChapter: readPositiveInteger(value.avgWordsPerChapter) } : fallback.avgWordsPerChapter ? { avgWordsPerChapter: fallback.avgWordsPerChapter } : {}),
  };
}

function readPositiveInteger(value: unknown): number | undefined {
  const normalized = typeof value === "string" ? Number.parseInt(value, 10) : value;
  return typeof normalized === "number" && Number.isInteger(normalized) && normalized > 0 ? normalized : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
