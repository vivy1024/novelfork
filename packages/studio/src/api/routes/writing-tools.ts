import { appendFile, mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { Hono } from "hono";
import {
  analyzeDialogue,
  analyzeRhythm,
  analyzeSensitiveWords,
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
import { analyzeRhythm as analyzeBookRhythm } from "../lib/rhythm-analyzer.js";

import { requireModelForAiAction } from "../lib/ai-gate.js";
import { ProviderRuntimeStore } from "../lib/provider-runtime-store.js";
import { buildRuntimeProviderStatus } from "../lib/runtime-model-pool.js";
import type { RouterContext } from "./context.js";

const PROGRESS_CONFIG_KEY = "writing-tools:progress-config";
const DEFAULT_PROGRESS_CONFIG: ProgressConfig = { dailyTarget: 6000 };

type JsonContext = { readonly req: { json: <T>() => Promise<T> } };
type DateQueryOptions = { readonly today?: string; readonly totalChaptersWritten?: number };
type DateSumTrendQuery = { readonly days?: number; readonly today?: string };

type GeneratedHookPayload = {
  readonly id: string;
  readonly style: string;
  readonly text: string;
  readonly rationale: string;
  readonly retentionEstimate: string;
  readonly relatedHookIds?: readonly string[];
};

type MeasuredMetric = {
  readonly status: "measured";
  readonly value: number;
  readonly source: string;
};

type UnknownMetric = {
  readonly status: "unknown";
  readonly reason: string;
};

type BookHealthWarning = {
  readonly type: string;
  readonly message: string;
};

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
    const providerStore = ctx.providerStore ?? new ProviderRuntimeStore();
    const gate = requireModelForAiAction("ai-writing", await buildRuntimeProviderStatus(providerStore));
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

  app.post("/api/books/:bookId/hooks/apply", async (c) => {
    const body = await readJsonBody(c);
    const bookId = c.req.param("bookId");
    await ctx.state.loadBookConfig(bookId);

    const chapterNumber = readPositiveInteger(body.chapterNumber);
    if (chapterNumber === undefined) {
      return c.json({ error: "Invalid chapter number" }, 400);
    }

    const hook = normalizeGeneratedHook(body.hook);
    if (!hook) {
      return c.json({ error: "Invalid hook payload" }, 400);
    }

    const storyDir = join(ctx.state.bookDir(bookId), "story");
    await mkdir(storyDir, { recursive: true });
    await appendFile(join(storyDir, "pending_hooks.md"), formatPendingHookEntry(hook, chapterNumber), "utf-8");

    return c.json({ persisted: true, file: "pending_hooks.md", hookId: hook.id });
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
    const book = await ctx.state.loadBookConfig(bookId);
    const chapters = await readBookChapters(ctx, bookId);
    const storage = getStorageDatabase();
    const config = await loadProgressConfig(storage);
    const progress = await getDailyProgress(storage, config);
    const { createBibleConflictRepository, createFilterReportRepository } = await import("@vivy1024/novelfork-core");
    const conflicts = await createBibleConflictRepository(storage).listByBook(bookId);
    const language = isRecord(book) && book.language === "en" ? "en" : "zh";
    const sensitiveWordCount = chapters.reduce((total, chapter) => total + countSensitiveHits(chapter.content, language), 0);
    const warnings = buildHealthWarnings(sensitiveWordCount, conflicts.length);

    const consistencyScore = await computeConsistencyScore(ctx, bookId);
    const hookRecoveryRate = await computeHookRecoveryRate(ctx, bookId);
    const aiTasteMean = await computeAiTasteMean(createFilterReportRepository, storage, bookId);
    const rhythmDiversity = computeRhythmDiversity(chapters);

    return c.json({
      health: {
        totalChapters: measuredMetric(chapters.length, "chapter-files"),
        totalWords: measuredMetric(chapters.reduce((total, chapter) => total + countContentWords(chapter.content), 0), "chapter-files"),
        dailyWords: measuredMetric(progress.today.written, "writing-log"),
        dailyTarget: measuredMetric(progress.today.target, "progress-config"),
        sensitiveWordCount: measuredMetric(sensitiveWordCount, "sensitive-word-scan"),
        knownConflictCount: measuredMetric(conflicts.length, "bible-conflicts"),
        consistencyScore,
        hookRecoveryRate,
        aiTasteMean,
        rhythmDiversity,
        warnings,
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

async function readBookChapters(ctx: RouterContext, bookId: string): Promise<ChapterLookup[]> {
  const chaptersDir = join(ctx.state.bookDir(bookId), "chapters");
  const files = await readdir(chaptersDir).catch(() => []);
  const chapters: ChapterLookup[] = [];
  for (const filename of files.filter((file) => file.endsWith(".md")).sort()) {
    const content = await readFile(join(chaptersDir, filename), "utf-8").catch(() => "");
    const chapterNumber = readPositiveInteger(filename.match(/^(\d+)/)?.[1]) ?? chapters.length + 1;
    chapters.push({ chapterNumber, filename, content });
  }
  return chapters;
}

function measuredMetric(value: number, source: string): MeasuredMetric {
  return { status: "measured", value, source };
}

function unknownMetric(reason: string): UnknownMetric {
  return { status: "unknown", reason };
}

function countContentWords(content: string): number {
  return content.replace(/\s+/g, "").length;
}

function countSensitiveHits(content: string, language: "zh" | "en"): number {
  return analyzeSensitiveWords(content, undefined, language).found.reduce((total, hit) => total + hit.count, 0);
}

function buildHealthWarnings(sensitiveWordCount: number, knownConflictCount: number): BookHealthWarning[] {
  const warnings: BookHealthWarning[] = [];
  if (sensitiveWordCount > 0) {
    warnings.push({ type: "敏感词", message: `检测到 ${sensitiveWordCount} 处敏感词命中` });
  }
  if (knownConflictCount > 0) {
    warnings.push({ type: "矛盾", message: `已登记 ${knownConflictCount} 个矛盾条目，请结合矛盾地图判断状态` });
  }
  return warnings;
}

function normalizeGeneratedHook(value: unknown): GeneratedHookPayload | null {
  if (!isRecord(value)) return null;
  const id = readRequiredText(value.id);
  const text = readRequiredText(value.text);
  if (!id || !text) return null;
  const style = readRequiredText(value.style) ?? "unknown";
  const rationale = readRequiredText(value.rationale) ?? "未提供";
  const retentionEstimate = readRequiredText(value.retentionEstimate) ?? "unknown";
  const relatedHookIds = Array.isArray(value.relatedHookIds)
    ? value.relatedHookIds.map((item) => typeof item === "string" ? normalizeLine(item) : "").filter(Boolean)
    : undefined;

  return {
    id,
    style,
    text,
    rationale,
    retentionEstimate,
    ...(relatedHookIds && relatedHookIds.length > 0 ? { relatedHookIds } : {}),
  };
}

function formatPendingHookEntry(hook: GeneratedHookPayload, chapterNumber: number): string {
  return [
    "",
    "",
    `## ${hook.id}`,
    "- status: open",
    `- chapter: ${chapterNumber}`,
    `- style: ${hook.style}`,
    `- retention: ${hook.retentionEstimate}`,
    `- text: ${hook.text}`,
    `- rationale: ${hook.rationale}`,
    ...(hook.relatedHookIds?.length ? [`- related: ${hook.relatedHookIds.join(", ")}`] : []),
  ].join("\n");
}

function readRequiredText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = normalizeLine(value);
  return text ? text : null;
}

function normalizeLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
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

async function computeConsistencyScore(ctx: RouterContext, bookId: string): Promise<MeasuredMetric | null> {
  try {
    const index = await ctx.state.loadChapterIndex(bookId).catch(() => []);
    const chaptersWithAudit = index.filter((ch) => {
      const record = ch as Record<string, unknown>;
      return Array.isArray(record.auditIssues);
    });
    if (chaptersWithAudit.length === 0) return null;
    const totalIssues = chaptersWithAudit.reduce((sum, ch) => {
      const record = ch as Record<string, unknown>;
      return sum + (Array.isArray(record.auditIssues) ? (record.auditIssues as unknown[]).length : 0);
    }, 0);
    const score = Math.max(0, 1 - totalIssues / chaptersWithAudit.length);
    return measuredMetric(Math.round(score * 1000) / 1000, "chapter-audit-issues");
  } catch {
    return null;
  }
}

async function computeHookRecoveryRate(ctx: RouterContext, bookId: string): Promise<MeasuredMetric | null> {
  try {
    const content = await readStoryFile(ctx, bookId, "pending_hooks.md");
    if (!content.trim()) return null;
    const hookEntries = content.split(/^## /m).filter((section) => section.trim().length > 0);
    if (hookEntries.length === 0) return null;
    const statusPattern = /- status:\s*(\S+)/i;
    let total = 0;
    let recovered = 0;
    for (const entry of hookEntries) {
      const match = statusPattern.exec(entry);
      if (!match) continue;
      total += 1;
      const status = match[1]?.toLowerCase() ?? "";
      if (status === "resolved" || status === "closed" || status === "recovered") {
        recovered += 1;
      }
    }
    if (total === 0) return null;
    return measuredMetric(Math.round((recovered / total) * 1000) / 1000, "pending-hooks-md");
  } catch {
    return null;
  }
}

async function computeAiTasteMean(
  createFilterReportRepository: (storage: ReturnType<typeof getStorageDatabase>) => { listByBook: (bookId: string) => Promise<ReadonlyArray<{ aiTasteScore: number; chapterNumber: number }>> },
  storage: ReturnType<typeof getStorageDatabase>,
  bookId: string,
): Promise<MeasuredMetric | null> {
  try {
    const rows = await createFilterReportRepository(storage).listByBook(bookId);
    if (rows.length === 0) return null;
    const latestByChapter = new Map<number, number>();
    for (const row of rows) {
      if (!latestByChapter.has(row.chapterNumber)) {
        latestByChapter.set(row.chapterNumber, row.aiTasteScore);
      }
    }
    if (latestByChapter.size === 0) return null;
    const scores = [...latestByChapter.values()];
    const avg = Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
    return measuredMetric(avg, "filter-reports");
  } catch {
    return null;
  }
}

function computeRhythmDiversity(chapters: ChapterLookup[]): MeasuredMetric | null {
  const validChapters = chapters.filter((ch) => ch.content.trim().length > 0);
  if (validChapters.length < 2) return null;
  try {
    const analysis = analyzeBookRhythm(validChapters.map((ch) => ({ number: ch.chapterNumber, content: ch.content })));
    if (analysis.chapters.length < 2) return null;
    const typeCounts = new Map<string, number>();
    for (const ch of analysis.chapters) {
      typeCounts.set(ch.type, (typeCounts.get(ch.type) ?? 0) + 1);
    }
    const total = analysis.chapters.length;
    const typeCount = typeCounts.size;
    const maxTypes = 3;
    const distributionScore = typeCount / maxTypes;
    const evenness = typeCount <= 1 ? 0 : (() => {
      let entropy = 0;
      for (const count of typeCounts.values()) {
        const p = count / total;
        if (p > 0) entropy -= p * Math.log2(p);
      }
      return entropy / Math.log2(typeCount);
    })();
    const diversity = Math.round(distributionScore * 0.5 * 1000 + evenness * 0.5 * 1000) / 1000;
    return measuredMetric(Math.min(1, diversity), "rhythm-analysis");
  } catch {
    return null;
  }
}
