/**
 * AI routes — mounted in all modes (standalone + relay).
 * ~16 endpoints: write-next, draft, audit, revise, rewrite, detect, style,
 * radar, agent, imports, fanfic operations, studio SSE.
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  PipelineRunner,
  createLLMClient,
  chatCompletion,
  fetchUrl,
  filterHooks,
  filterSummaries,
  filterSubplots,
  filterEmotionalArcs,
  filterCharacterMatrix,
  extractPOVFromOutline,
  filterMatrixByPOV,
  filterHooksByPOV,
} from "@vivy1024/novelfork-core";
import { join } from "node:path";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import {
  AUTHOR_REVIEW_FILES,
  buildRadarReviewMarkdown,
  buildWebCaptureReviewMarkdown,
  type AuthorMaterialPersistenceInfo,
  type AuthorWebCaptureInput,
  type AuthorWebCaptureResult,
} from "../../shared/author-materials.js";
import {
  logObservedAiError,
  logObservedAiSuccess,
} from "../lib/ai-request-observer.js";
import type { RouterContext } from "./context.js";

type EventHandler = (event: string, data: unknown) => void;

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissingLlmConfigError(error: unknown): boolean {
  const message = toErrorMessage(error);
  return /NOVELFORK_LLM_API_KEY/i.test(message)
    || /API key.*not set/i.test(message)
    || /missing.*api[_ -]?key/i.test(message)
    || /no\s+api[_ -]?key/i.test(message);
}

function structuredLlmConfigError() {
  return {
    code: "LLM_CONFIG_MISSING",
    message: "模型配置未完成，请先到管理中心配置 API Key 或选择可用网关。",
    hint: "打开管理中心 → 供应商，检查 API Key、Base URL 与模型配置。",
  };
}

function normalizeCapturedText(content: string, maxChars = 8000): string {
  return content.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, maxChars);
}

function deriveCaptureTitle(url: string, label: string | undefined, content: string): string {
  if (label?.trim()) return label.trim();
  const firstLine = content.split("\n").find((line) => line.trim().length > 0)?.trim();
  if (firstLine && firstLine.length <= 80) {
    return firstLine;
  }
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return url;
  }
}


async function persistAuthorReviewFile(options: {
  readonly state: RouterContext["state"];
  readonly bookId: string;
  readonly fileName: string;
  readonly content: string;
  readonly mode?: "replace" | "append";
}): Promise<AuthorMaterialPersistenceInfo> {
  const storyDir = join(options.state.bookDir(options.bookId), "story");
  await mkdir(storyDir, { recursive: true });
  const targetPath = join(storyDir, options.fileName);

  if (options.mode === "append") {
    let previous = "";
    try {
      previous = await readFile(targetPath, "utf-8");
    } catch {
      previous = "";
    }
    const merged = previous.trim()
      ? `${previous.trimEnd()}\n\n---\n\n${options.content.trim()}\n`
      : `${options.content.trim()}\n`;
    await writeFile(targetPath, merged, "utf-8");
  } else {
    await writeFile(targetPath, `${options.content.trim()}\n`, "utf-8");
  }

  return {
    bookId: options.bookId,
    file: options.fileName as AuthorMaterialPersistenceInfo["file"],
    path: `books/${options.bookId}/story/${options.fileName}`,
    savedAt: new Date().toISOString(),
  };
}

export function createAIRouter(ctx: RouterContext): Hono {
  const app = new Hono();
  const { state, root, broadcast } = ctx;

  // Studio SSE subscribers
  const subscribers = new Set<EventHandler>();

  function broadcastStudioEvent(event: string, data: unknown): void {
    broadcast(event, data);
    for (const handler of subscribers) {
      handler(event, data);
    }
  }

  // --- Write Next ---

  app.post("/api/books/:id/write-next", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<{ wordCount?: number }>().catch(() => ({ wordCount: undefined }));

    broadcastStudioEvent("write:start", { bookId: id });

    const sessionLlm = await ctx.getSessionLlm(c);
    const pipeline = new PipelineRunner(await ctx.buildPipelineConfig(sessionLlm));
    pipeline.writeNextChapter(id, body.wordCount).then(
      (result: any) => {
        broadcastStudioEvent("write:complete", { bookId: id, chapterNumber: result.chapterNumber, status: result.status, title: result.title, wordCount: result.wordCount });
      },
      (e: any) => {
        broadcastStudioEvent("write:error", { bookId: id, error: e instanceof Error ? e.message : String(e) });
      },
    );

    return c.json({ status: "writing", bookId: id });
  });

  // --- Draft ---

  app.post("/api/books/:id/draft", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<{ wordCount?: number; context?: string }>().catch(() => ({ wordCount: undefined, context: undefined }));

    broadcastStudioEvent("draft:start", { bookId: id });

    const sessionLlm = await ctx.getSessionLlm(c);
    const pipeline = new PipelineRunner(await ctx.buildPipelineConfig(sessionLlm));
    pipeline.writeDraft(id, body.context, body.wordCount).then(
      (result: any) => {
        broadcastStudioEvent("draft:complete", { bookId: id, chapterNumber: result.chapterNumber, title: result.title, wordCount: result.wordCount });
      },
      (e: any) => {
        broadcastStudioEvent("draft:error", { bookId: id, error: e instanceof Error ? e.message : String(e) });
      },
    );

    return c.json({ status: "drafting", bookId: id });
  });

  // --- Audit ---

  app.post("/api/books/:id/audit/:chapter", async (c) => {
    const id = c.req.param("id");
    const chapterNum = parseInt(c.req.param("chapter"), 10);
    const bookDir = state.bookDir(id);

    broadcastStudioEvent("audit:start", { bookId: id, chapter: chapterNum });
    try {
      const book = await state.loadBookConfig(id);
      const chaptersDir = join(bookDir, "chapters");
      const files = await readdir(chaptersDir);
      const paddedNum = String(chapterNum).padStart(4, "0");
      const match = files.find((f) => f.startsWith(paddedNum) && f.endsWith(".md"));
      if (!match) return c.json({ error: "Chapter not found" }, 404);

      const content = await readFile(join(chaptersDir, match), "utf-8");
      const currentConfig = await import("@vivy1024/novelfork-core").then(m => m.loadProjectConfig(root, { requireApiKey: false }));
      const { ContinuityAuditor } = await import("@vivy1024/novelfork-core");
      const auditor = new ContinuityAuditor({
        client: createLLMClient(currentConfig.llm),
        model: currentConfig.llm.model,
        projectRoot: root,
        bookId: id,
      });
      const result = await auditor.auditChapter(bookDir, content, chapterNum, book.genre);
      broadcastStudioEvent("audit:complete", { bookId: id, chapter: chapterNum, passed: result.passed });
      return c.json(result);
    } catch (e) {
      broadcastStudioEvent("audit:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Revise ---

  app.post("/api/books/:id/revise/:chapter", async (c) => {
    const id = c.req.param("id");
    const chapterNum = parseInt(c.req.param("chapter"), 10);
    const body: { mode?: string; brief?: string } = await c.req
      .json<{ mode?: string; brief?: string }>()
      .catch(() => ({ mode: "spot-fix" }));

    broadcastStudioEvent("revise:start", { bookId: id, chapter: chapterNum });
    try {
      const pipeline = new PipelineRunner(await ctx.buildPipelineConfig({
        externalContext: body.brief,
        ...(await ctx.getSessionLlm(c)),
      }));
      const result = await pipeline.reviseDraft(
        id,
        chapterNum,
        (body.mode ?? "spot-fix") as "spot-fix" | "polish" | "rewrite" | "rework" | "anti-detect",
      );
      broadcastStudioEvent("revise:complete", { bookId: id, chapter: chapterNum });
      return c.json(result);
    } catch (e) {
      broadcastStudioEvent("revise:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Rewrite ---

  app.post("/api/books/:id/rewrite/:chapter", async (c) => {
    const id = c.req.param("id");
    const chapterNum = parseInt(c.req.param("chapter"), 10);
    const body: { brief?: string } = await c.req
      .json<{ brief?: string }>()
      .catch(() => ({}));

    broadcastStudioEvent("rewrite:start", { bookId: id, chapter: chapterNum });
    try {
      const rollbackTarget = chapterNum - 1;
      const discarded = await state.rollbackToChapter(id, rollbackTarget);
      const pipeline = new PipelineRunner(await ctx.buildPipelineConfig({
        externalContext: body.brief,
        ...(await ctx.getSessionLlm(c)),
      }));
      pipeline.writeNextChapter(id).then(
        (result: any) => broadcastStudioEvent("rewrite:complete", { bookId: id, chapterNumber: result.chapterNumber, title: result.title, wordCount: result.wordCount }),
        (e: any) => broadcastStudioEvent("rewrite:error", { bookId: id, error: e instanceof Error ? e.message : String(e) }),
      );
      return c.json({ status: "rewriting", bookId: id, chapter: chapterNum, rolledBackTo: rollbackTarget, discarded });
    } catch (e) {
      broadcastStudioEvent("rewrite:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Resync ---

  app.post("/api/books/:id/resync/:chapter", async (c) => {
    const id = c.req.param("id");
    const chapterNum = parseInt(c.req.param("chapter"), 10);
    const body: { brief?: string } = await c.req
      .json<{ brief?: string }>()
      .catch(() => ({}));

    try {
      const pipeline = new PipelineRunner(await ctx.buildPipelineConfig({
        externalContext: body.brief,
        ...(await ctx.getSessionLlm(c)),
      }));
      const result = await pipeline.resyncChapterArtifacts(id, chapterNum);
      return c.json(result);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Detect (single chapter) ---

  app.post("/api/books/:id/detect/:chapter", async (c) => {
    const id = c.req.param("id");
    const chapterNum = parseInt(c.req.param("chapter"), 10);
    const bookDir = state.bookDir(id);

    try {
      const chaptersDir = join(bookDir, "chapters");
      const files = await readdir(chaptersDir);
      const paddedNum = String(chapterNum).padStart(4, "0");
      const match = files.find((f) => f.startsWith(paddedNum) && f.endsWith(".md"));
      if (!match) return c.json({ error: "Chapter not found" }, 404);

      const content = await readFile(join(chaptersDir, match), "utf-8");
      const { analyzeAITells } = await import("@vivy1024/novelfork-core");
      const result = analyzeAITells(content);
      return c.json({ chapterNumber: chapterNum, ...result });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Detect All ---

  app.post("/api/books/:id/detect-all", async (c) => {
    const id = c.req.param("id");
    const bookDir = state.bookDir(id);

    try {
      const chaptersDir = join(bookDir, "chapters");
      const files = await readdir(chaptersDir);
      const mdFiles = files.filter((f) => f.endsWith(".md") && /^\d{4}/.test(f)).sort();
      const { analyzeAITells } = await import("@vivy1024/novelfork-core");

      const results = await Promise.all(
        mdFiles.map(async (f) => {
          const num = parseInt(f.slice(0, 4), 10);
          const content = await readFile(join(chaptersDir, f), "utf-8");
          const result = analyzeAITells(content);
          return { chapterNumber: num, filename: f, ...result };
        }),
      );
      return c.json({ bookId: id, results });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Style Analyze ---

  app.post("/api/style/analyze", async (c) => {
    const { text, sourceName } = await c.req.json<{ text: string; sourceName: string }>();
    if (!text?.trim()) return c.json({ error: "text is required" }, 400);

    try {
      const { analyzeStyle } = await import("@vivy1024/novelfork-core");
      const profile = analyzeStyle(text, sourceName ?? "unknown");
      return c.json(profile);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Style Import ---

  app.post("/api/books/:id/style/import", async (c) => {
    const id = c.req.param("id");
    const { text, sourceName } = await c.req.json<{ text: string; sourceName: string }>();

    broadcastStudioEvent("style:start", { bookId: id });
    try {
      const sessionLlm = await ctx.getSessionLlm(c);
      const pipeline = new PipelineRunner(await ctx.buildPipelineConfig(sessionLlm));
      const result = await pipeline.generateStyleGuide(id, text, sourceName ?? "unknown");
      broadcastStudioEvent("style:complete", { bookId: id });
      return c.json({ ok: true, result });
    } catch (e) {
      broadcastStudioEvent("style:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Import Chapters ---

  app.post("/api/books/:id/import/chapters", async (c) => {
    const id = c.req.param("id");
    const { text, splitRegex } = await c.req.json<{ text: string; splitRegex?: string }>();
    if (!text?.trim()) return c.json({ error: "text is required" }, 400);

    broadcastStudioEvent("import:start", { bookId: id, type: "chapters" });
    try {
      const { splitChapters } = await import("@vivy1024/novelfork-core");
      const chapters = [...splitChapters(text, splitRegex)];

      const sessionLlm = await ctx.getSessionLlm(c);
      const pipeline = new PipelineRunner(await ctx.buildPipelineConfig(sessionLlm));
      const result = await pipeline.importChapters({ bookId: id, chapters });
      broadcastStudioEvent("import:complete", { bookId: id, type: "chapters", count: result.importedCount });
      return c.json(result);
    } catch (e) {
      broadcastStudioEvent("import:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Import Canon ---

  app.post("/api/books/:id/import/canon", async (c) => {
    const id = c.req.param("id");
    const { fromBookId } = await c.req.json<{ fromBookId: string }>();
    if (!fromBookId) return c.json({ error: "fromBookId is required" }, 400);

    broadcastStudioEvent("import:start", { bookId: id, type: "canon" });
    try {
      const sessionLlm = await ctx.getSessionLlm(c);
      const pipeline = new PipelineRunner(await ctx.buildPipelineConfig(sessionLlm));
      await pipeline.importCanon(id, fromBookId);
      broadcastStudioEvent("import:complete", { bookId: id, type: "canon" });
      return c.json({ ok: true });
    } catch (e) {
      broadcastStudioEvent("import:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Fanfic Init ---

  app.post("/api/fanfic/init", async (c) => {
    const body = await c.req.json<{
      title: string; sourceText: string; sourceName?: string;
      mode?: string; genre?: string; platform?: string;
      targetChapters?: number; chapterWordCount?: number; language?: string;
    }>();
    if (!body.title || !body.sourceText) {
      return c.json({ error: "title and sourceText are required" }, 400);
    }

    const now = new Date().toISOString();
    const bookId = body.title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, "-").replace(/-+/g, "-").slice(0, 30);

    const bookConfig = {
      id: bookId,
      title: body.title,
      platform: (body.platform ?? "other") as "other",
      genre: (body.genre ?? "other") as "xuanhuan",
      status: "outlining" as const,
      targetChapters: body.targetChapters ?? 100,
      chapterWordCount: body.chapterWordCount ?? 3000,
      fanficMode: (body.mode ?? "canon") as "canon",
      ...(body.language ? { language: body.language as "zh" | "en" } : {}),
      createdAt: now,
      updatedAt: now,
    };

    broadcastStudioEvent("fanfic:start", { bookId, title: body.title });
    try {
      const sessionLlm = await ctx.getSessionLlm(c);
      const pipeline = new PipelineRunner(await ctx.buildPipelineConfig(sessionLlm));
      await pipeline.initFanficBook(bookConfig, body.sourceText, body.sourceName ?? "source", (body.mode ?? "canon") as "canon");
      broadcastStudioEvent("fanfic:complete", { bookId });
      return c.json({ ok: true, bookId });
    } catch (e) {
      broadcastStudioEvent("fanfic:error", { bookId, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Fanfic Refresh ---

  app.post("/api/books/:id/fanfic/refresh", async (c) => {
    const id = c.req.param("id");
    const { sourceText, sourceName } = await c.req.json<{ sourceText: string; sourceName?: string }>();
    if (!sourceText?.trim()) return c.json({ error: "sourceText is required" }, 400);

    broadcastStudioEvent("fanfic:refresh:start", { bookId: id });
    try {
      const book = await state.loadBookConfig(id);
      const sessionLlm = await ctx.getSessionLlm(c);
      const pipeline = new PipelineRunner(await ctx.buildPipelineConfig(sessionLlm));
      await pipeline.importFanficCanon(id, sourceText, sourceName ?? "source", (book.fanficMode ?? "canon") as "canon");
      broadcastStudioEvent("fanfic:refresh:complete", { bookId: id });
      return c.json({ ok: true });
    } catch (e) {
      broadcastStudioEvent("fanfic:refresh:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Radar Scan ---

  app.post("/api/radar/scan", async (c) => {
    const body = await c.req.json<{ bookId?: string }>().catch(() => ({} as { bookId?: string }));
    const targetBookId = body.bookId?.trim() || undefined;

    if (targetBookId) {
      try {
        await state.loadBookConfig(targetBookId);
      } catch {
        return c.json({ error: `Book "${targetBookId}" not found` }, 404);
      }
    }

    broadcastStudioEvent("radar:start", { bookId: targetBookId });
    try {
      const sessionLlm = await ctx.getSessionLlm(c);
      const pipeline = new PipelineRunner(await ctx.buildPipelineConfig(sessionLlm));
      const result = await pipeline.runRadar();

      let persisted: AuthorMaterialPersistenceInfo | undefined;
      if (targetBookId) {
        const savedAt = new Date().toISOString();
        persisted = await persistAuthorReviewFile({
          state,
          bookId: targetBookId,
          fileName: AUTHOR_REVIEW_FILES.radar,
          content: buildRadarReviewMarkdown(result, savedAt),
          mode: "replace",
        });
      }

      const response = persisted ? { ...result, persisted } : result;
      broadcastStudioEvent("radar:complete", { result: response, bookId: targetBookId });
      return c.json(response);
    } catch (e) {
      const message = toErrorMessage(e);
      broadcastStudioEvent("radar:error", { error: message, bookId: targetBookId });
      if (isMissingLlmConfigError(e)) {
        return c.json({ error: structuredLlmConfigError() }, 400);
      }
      return c.json({ error: message }, 500);
    }
  });

  // --- Authorized web capture for author materials ---

  app.post("/api/books/:id/materials/web-capture", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<AuthorWebCaptureInput>().catch(() => ({ url: "" } as AuthorWebCaptureInput));
    const sourceUrl = body.url?.trim();
    if (!sourceUrl) {
      return c.json({ error: "url is required" }, 400);
    }

    try {
      await state.loadBookConfig(id);
    } catch {
      return c.json({ error: `Book "${id}" not found` }, 404);
    }

    broadcastStudioEvent("import:start", { bookId: id, type: "web-capture", url: sourceUrl });
    try {
      const content = normalizeCapturedText(await fetchUrl(sourceUrl, 8000), 8000);
      const lines = content.split("\n").map((line) => line.trim()).filter(Boolean);
      const excerpt = lines.slice(0, 3).join(" ").slice(0, 280);
      const capture: AuthorWebCaptureResult = {
        title: deriveCaptureTitle(sourceUrl, body.label, content),
        excerpt,
        content,
        sourceUrl,
        label: body.label?.trim() || undefined,
        perspective: body.perspective ?? "reference",
        notes: body.notes?.trim() || undefined,
        capturedAt: new Date().toISOString(),
      };

      const persisted = await persistAuthorReviewFile({
        state,
        bookId: id,
        fileName: AUTHOR_REVIEW_FILES.webCapture,
        content: buildWebCaptureReviewMarkdown(capture),
        mode: "append",
      });

      const response = { capture, persisted };
      broadcastStudioEvent("import:complete", { bookId: id, type: "web-capture", persisted });
      return c.json(response);
    } catch (e) {
      const message = toErrorMessage(e);
      broadcastStudioEvent("import:error", { bookId: id, type: "web-capture", error: message });
      return c.json({ error: message }, 500);
    }
  });

  // --- Agent ---

  app.post("/api/agent", async (c) => {
    const { instruction } = await c.req.json<{ instruction: string }>();
    if (!instruction?.trim()) {
      return c.json({ error: "No instruction provided" }, 400);
    }

    broadcastStudioEvent("agent:start", { instruction });

    try {
      const { runAgentLoop } = await import("@vivy1024/novelfork-core");

      const result = await runAgentLoop(
        await ctx.buildPipelineConfig(await ctx.getSessionLlm(c)),
        instruction
      );

      broadcastStudioEvent("agent:complete", { instruction, response: result });
      return c.json({ response: result });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      broadcastStudioEvent("agent:error", { instruction, error: msg });
      return c.json({ response: msg });
    }
  });

  // --- Selection Transform (lightweight text-in → text-out) ---

  const TRANSFORM_MODES = ["polish", "condense", "expand", "audit"] as const;
  type TransformMode = (typeof TRANSFORM_MODES)[number];

  const TRANSFORM_PROMPTS: Record<TransformMode, string> = {
    polish:
      "你是一位专业小说编辑。请润色以下文本，保留原意和风格，优化措辞和节奏感。只返回润色后的文本，不要解释。",
    condense:
      "你是一位专业小说编辑。请精简以下文本，去除冗余，保留核心信息。只返回精简后的文本。",
    expand:
      "你是一位专业小说编辑。请扩写以下文本，增加场景细节、感官描写或对话。只返回扩写后的文本。",
    audit:
      "你是一位连续性审计员。请审查以下文本片段，找出逻辑矛盾、人物性格不一致、时间线错误等问题。以 JSON 数组返回问题列表。",
  };

  app.post("/api/ai/transform", async (c) => {
    const body = await c.req
      .json<{ text: string; surrounding: string; mode: string; bookId?: string; sessionId?: string; chapterNumber?: number }>()
      .catch(() => ({ text: "", surrounding: "", mode: "", bookId: undefined, sessionId: undefined, chapterNumber: undefined }));

    if (!body.text?.trim()) {
      return c.json({ error: "text is required" }, 400);
    }
    if (!TRANSFORM_MODES.includes(body.mode as TransformMode)) {
      return c.json(
        { error: `mode must be one of: ${TRANSFORM_MODES.join(", ")}` },
        400,
      );
    }

    const mode = body.mode as TransformMode;

    const startedAt = Date.now();
    let pipelineLogger: Awaited<ReturnType<typeof ctx.buildPipelineConfig>>["logger"] | undefined;
    let provider: string | undefined;
    let modelId: string | undefined;

    try {
      const sessionLlm = await ctx.getSessionLlm(c);
      const config = await ctx.buildPipelineConfig(sessionLlm);
      pipelineLogger = config.logger;
      provider = config.client.provider;
      modelId = config.model;

      const messages = [
        { role: "system" as const, content: TRANSFORM_PROMPTS[mode] },
        {
          role: "user" as const,
          content: `### 上下文\n${body.surrounding}\n\n### 需要处理的选中文本\n${body.text}`,
        },
      ];

      const response = await chatCompletion(config.client, config.model, messages);
      logObservedAiSuccess(pipelineLogger, {
        endpoint: "/api/ai/transform",
        requestKind: `transform:${mode}`,
        narrator: "studio.ai.transform",
        provider,
        model: modelId,
        method: "POST",
        bookId: body.bookId,
        sessionId: body.sessionId,
        chapterNumber: body.chapterNumber,
      }, startedAt, {
        content: response.content,
        usage: response.usage,
      });
      return c.json({ result: response.content, mode });
    } catch (e) {
      logObservedAiError(pipelineLogger, {
        endpoint: "/api/ai/transform",
        requestKind: `transform:${mode}`,
        narrator: "studio.ai.transform",
        provider,
        model: modelId,
        method: "POST",
        bookId: body.bookId,
        sessionId: body.sessionId,
        chapterNumber: body.chapterNumber,
      }, startedAt, e);
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Context Assembly (for ContextPanel) ---

  const TRUTH_LABEL_MAP: Record<string, string> = {
    "story_bible.md": "故事经纬",
    "volume_outline.md": "卷大纲",
    "current_state.md": "当前状态",
    "particle_ledger.md": "粒子台账",
    "pending_hooks.md": "悬念钩子",
    "chapter_summaries.md": "章节摘要",
    "subplot_board.md": "支线看板",
    "emotional_arcs.md": "情感弧线",
    "character_matrix.md": "角色矩阵",
    "style_guide.md": "文风指南",
    "parent_canon.md": "母本设定",
    "fanfic_canon.md": "同人设定",
    "book_rules.md": "书籍规则",
    "author_intent.md": "作者意图",
    "current_focus.md": "当前焦点",
  };

  const CONTEXT_BUDGET_MAX = 8000;

  function estimateTokens(content: string): number {
    return Math.ceil(content.length / 2);
  }

  async function loadTruthFile(storyDir: string, filename: string): Promise<string | null> {
    try {
      return await readFile(join(storyDir, filename), "utf-8");
    } catch {
      return null;
    }
  }

  app.post("/api/ai/context-assembly", async (c) => {
    const body = await c.req
      .json<{ bookId: string; chapterNumber: number; povCharacter?: string }>()
      .catch(() => ({ bookId: "", chapterNumber: 1, povCharacter: undefined }));

    if (!body.bookId) {
      return c.json({ error: "bookId is required" }, 400);
    }

    try {
      const bookDir = state.bookDir(body.bookId);
      const storyDir = join(bookDir, "story");

      const filenames = Object.keys(TRUTH_LABEL_MAP);
      const rawContents = await Promise.all(
        filenames.map((f) => loadTruthFile(storyDir, f)),
      );

      // Build a map of filename → raw content
      const contentMap = new Map<string, string>();
      for (let i = 0; i < filenames.length; i++) {
        const raw = rawContents[i];
        if (raw && raw.trim()) {
          contentMap.set(filenames[i]!, raw);
        }
      }

      // Load outline for POV extraction and character filtering
      const outline = contentMap.get("volume_outline.md") ?? "";
      const summaries = contentMap.get("chapter_summaries.md") ?? "";

      // Determine POV character
      const pov = body.povCharacter ?? extractPOVFromOutline(outline, body.chapterNumber);

      // Apply filters to each truth file
      const entries: Array<{
        source: string;
        label: string;
        content: string;
        tokens: number;
        active: boolean;
      }> = [];

      for (const [filename, raw] of contentMap) {
        let filtered = raw;

        switch (filename) {
          case "pending_hooks.md":
            filtered = filterHooks(raw);
            if (pov) filtered = filterHooksByPOV(filtered, pov, summaries);
            break;
          case "chapter_summaries.md":
            filtered = filterSummaries(raw, body.chapterNumber);
            break;
          case "subplot_board.md":
            filtered = filterSubplots(raw);
            break;
          case "emotional_arcs.md":
            filtered = filterEmotionalArcs(raw, body.chapterNumber);
            break;
          case "character_matrix.md":
            filtered = filterCharacterMatrix(raw, outline);
            if (pov) filtered = filterMatrixByPOV(filtered, pov);
            break;
          default:
            // No special filter; use raw content
            break;
        }

        entries.push({
          source: filename,
          label: TRUTH_LABEL_MAP[filename] ?? filename,
          content: filtered,
          tokens: estimateTokens(filtered),
          active: true,
        });
      }

      const totalTokens = entries.reduce((sum, e) => sum + e.tokens, 0);

      return c.json({
        entries,
        totalTokens,
        budgetMax: CONTEXT_BUDGET_MAX,
      });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Intelligent Outline ---

  const OUTLINE_PROMPTS: Record<string, string> = {
    generate: [
      "你是一位专业小说大纲策划师。根据提供的章节摘要、故事经纬和现有大纲，生成或更新章节大纲。",
      "规则：",
      "1. 已写章节标记为 done，当前正在写的标记为 current，未来计划的标记为 planned",
      "2. 每个节点包含：chapter（章节号）、title（标题）、summary（一句话概要）、status、pov（视角角色，可选）、notes（备注，可选）",
      "3. 保持与现有内容一致，planned 章节基于情节走向合理推测",
      "4. 返回纯 JSON，格式：{ \"nodes\": [...], \"message\": \"概要说明\" }",
    ].join("\n"),
    check: [
      "你是一位连续性审核员。对比章节大纲与实际章节内容，找出不一致之处。",
      "规则：",
      "1. 检查标题、POV、情节是否与大纲匹配",
      "2. 在 notes 字段标注发现的问题",
      "3. 有问题的章节在 notes 中用「⚠️」开头",
      "4. 返回纯 JSON，格式：{ \"nodes\": [...], \"message\": \"检查结果概要\" }",
    ].join("\n"),
    suggest: [
      "你是一位小说情节顾问。根据已有章节和大纲，建议接下来一章的内容。",
      "规则：",
      "1. 只返回 1-3 个 planned 节点作为建议",
      "2. 考虑悬念钩子、角色弧线、节奏感",
      "3. summary 要具体到场景和冲突",
      "4. 返回纯 JSON，格式：{ \"nodes\": [...], \"message\": \"建议理由\" }",
    ].join("\n"),
  };

  app.post("/api/ai/outline", async (c) => {
    const body = await c.req
      .json<{ bookId: string; action: string }>()
      .catch(() => ({ bookId: "", action: "" }));

    if (!body.bookId) {
      return c.json({ error: "bookId is required" }, 400);
    }

    const validActions = ["generate", "check", "suggest"];
    if (!validActions.includes(body.action)) {
      return c.json({ error: `action must be one of: ${validActions.join(", ")}` }, 400);
    }

    const startedAt = Date.now();
    let pipelineLogger: Awaited<ReturnType<typeof ctx.buildPipelineConfig>>["logger"] | undefined;
    let provider: string | undefined;
    let modelId: string | undefined;

    try {
      const bookDir = state.bookDir(body.bookId);
      const storyDir = join(bookDir, "story");

      // Load truth files for context
      const [outline, summaries, bible, currentState, hooks] = await Promise.all([
        loadTruthFile(storyDir, "volume_outline.md"),
        loadTruthFile(storyDir, "chapter_summaries.md"),
        loadTruthFile(storyDir, "story_bible.md"),
        loadTruthFile(storyDir, "current_state.md"),
        loadTruthFile(storyDir, "pending_hooks.md"),
      ]);

      // Load chapter list for context
      const chaptersDir = join(bookDir, "chapters");
      let chapterFiles: string[] = [];
      try {
        const files = await readdir(chaptersDir);
        chapterFiles = files.filter((f) => f.endsWith(".md") && /^\d{4}/.test(f)).sort();
      } catch {
        // No chapters dir yet
      }

      const contextParts = [
        outline ? `### 现有大纲\n${outline}` : "### 现有大纲\n（无）",
        summaries ? `### 章节摘要\n${summaries}` : "",
        bible ? `### 故事经纬（摘要）\n${bible.slice(0, 2000)}` : "",
        currentState ? `### 当前状态\n${currentState}` : "",
        hooks ? `### 悬念钩子\n${hooks.slice(0, 1000)}` : "",
        `### 已有章节文件\n${chapterFiles.length > 0 ? chapterFiles.join(", ") : "（无）"}`,
      ].filter(Boolean);

      const systemPrompt = OUTLINE_PROMPTS[body.action]!;
      const sessionLlm = await ctx.getSessionLlm(c);
      const config = await ctx.buildPipelineConfig(sessionLlm);
      pipelineLogger = config.logger;
      provider = config.client.provider;
      modelId = config.model;

      const messages = [
        { role: "system" as const, content: systemPrompt },
        { role: "user" as const, content: contextParts.join("\n\n") },
      ];

      const response = await chatCompletion(config.client, config.model, messages);

      // Parse JSON from response, handling markdown code blocks
      let content = response.content.trim();
      const codeBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
      if (codeBlockMatch) {
        content = codeBlockMatch[1]!.trim();
      }

      logObservedAiSuccess(pipelineLogger, {
        endpoint: "/api/ai/outline",
        requestKind: `outline:${body.action}`,
        narrator: "studio.ai.outline",
        provider,
        model: modelId,
        method: "POST",
        bookId: body.bookId,
      }, startedAt, {
        content,
        usage: response.usage,
      });

      const parsed = JSON.parse(content) as { nodes: unknown[]; message?: string };
      return c.json(parsed);
    } catch (e) {
      logObservedAiError(pipelineLogger, {
        endpoint: "/api/ai/outline",
        requestKind: `outline:${body.action}`,
        narrator: "studio.ai.outline",
        provider,
        model: modelId,
        method: "POST",
        bookId: body.bookId,
      }, startedAt, e);
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Inline Completion (ghost text / Tab completion) ---

  app.post("/api/ai/complete", async (c) => {
    const body = await c.req.json<{ text: string; surrounding: string; bookId?: string; sessionId?: string; chapterNumber?: number }>().catch(() => ({ text: "", surrounding: "", bookId: undefined, sessionId: undefined, chapterNumber: undefined }));
    if (!body.text?.trim() && !body.surrounding?.trim()) {
      return c.json({ error: "text or surrounding is required" }, 400);
    }

    const sessionLlm = await ctx.getSessionLlm(c);
    const config = await ctx.buildPipelineConfig(sessionLlm);

    const systemPrompt = "你是一位小说续写助手。根据上下文，自然地续写下一句话（30-80字）。只返回续写内容，不要解释，不要重复已有文本。保持风格一致。";

    return streamSSE(c, async (stream) => {
      const startedAt = Date.now();
      try {
        const messages = [
          { role: "system" as const, content: systemPrompt },
          { role: "user" as const, content: `### 上下文\n${body.surrounding}\n\n### 当前段落末尾\n${body.text}` },
        ];

        const response = await chatCompletion(config.client, config.model, messages);
        const fullText = response.content;
        logObservedAiSuccess(config.logger, {
          endpoint: "/api/ai/complete",
          requestKind: "inline-complete",
          narrator: "studio.ai.complete",
          provider: config.client.provider,
          model: config.model,
          method: "POST",
          bookId: body.bookId,
          sessionId: body.sessionId,
          chapterNumber: body.chapterNumber,
        }, startedAt, {
          content: fullText,
          usage: response.usage,
        });

        // Split response into chunks to simulate streaming
        const chunkSize = 4;
        for (let i = 0; i < fullText.length; i += chunkSize) {
          const chunk = fullText.slice(i, i + chunkSize);
          await stream.writeSSE({
            event: "chunk",
            data: JSON.stringify({ text: chunk, done: false, streamSource: "chunked-buffer" }),
          });
        }
        await stream.writeSSE({
          event: "chunk",
          data: JSON.stringify({ text: "", done: true, streamSource: "chunked-buffer" }),
        });
      } catch (e) {
        logObservedAiError(config.logger, {
          endpoint: "/api/ai/complete",
          requestKind: "inline-complete",
          narrator: "studio.ai.complete",
          provider: config.client.provider,
          model: config.model,
          method: "POST",
          bookId: body.bookId,
          sessionId: body.sessionId,
          chapterNumber: body.chapterNumber,
        }, startedAt, e);
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({ error: String(e) }),
        });
      }
    });
  });

  // --- Studio global SSE feed ---

  app.get("/api/events", (c) => {
    return streamSSE(c, async (stream) => {
      const handler: EventHandler = (event, data) => {
        stream.writeSSE({ event, data: JSON.stringify(data) });
      };
      subscribers.add(handler);

      const keepAlive = setInterval(() => {
        stream.writeSSE({ event: "ping", data: "" });
      }, 30000);

      stream.onAbort(() => {
        subscribers.delete(handler);
        clearInterval(keepAlive);
      });

      // Block until aborted
      await new Promise(() => {});
    });
  });

  return app;
}
