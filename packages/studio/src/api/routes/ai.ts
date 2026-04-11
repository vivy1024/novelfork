/**
 * AI routes — mounted in all modes (standalone + relay).
 * ~16 endpoints: write-next, draft, audit, revise, rewrite, detect, style,
 * radar, agent, imports, fanfic operations, legacy SSE.
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  PipelineRunner,
  createLLMClient,
} from "@actalk/inkos-core";
import { join } from "node:path";
import { readFile, readdir } from "node:fs/promises";
import type { RouterContext } from "./context.js";

type EventHandler = (event: string, data: unknown) => void;

export function createAIRouter(ctx: RouterContext): Hono {
  const app = new Hono();
  const { state, root, broadcast } = ctx;

  // Legacy SSE subscribers (will be replaced by per-run SSE in Phase 2)
  const subscribers = new Set<EventHandler>();

  function legacyBroadcast(event: string, data: unknown): void {
    broadcast(event, data);
    for (const handler of subscribers) {
      handler(event, data);
    }
  }

  // --- Write Next ---

  app.post("/api/books/:id/write-next", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<{ wordCount?: number }>().catch(() => ({ wordCount: undefined }));

    legacyBroadcast("write:start", { bookId: id });

    const sessionLlm = await ctx.getSessionLlm(c);
    const pipeline = new PipelineRunner(await ctx.buildPipelineConfig(sessionLlm));
    pipeline.writeNextChapter(id, body.wordCount).then(
      (result) => {
        legacyBroadcast("write:complete", { bookId: id, chapterNumber: result.chapterNumber, status: result.status, title: result.title, wordCount: result.wordCount });
      },
      (e) => {
        legacyBroadcast("write:error", { bookId: id, error: e instanceof Error ? e.message : String(e) });
      },
    );

    return c.json({ status: "writing", bookId: id });
  });

  // --- Draft ---

  app.post("/api/books/:id/draft", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<{ wordCount?: number; context?: string }>().catch(() => ({ wordCount: undefined, context: undefined }));

    legacyBroadcast("draft:start", { bookId: id });

    const sessionLlm = await ctx.getSessionLlm(c);
    const pipeline = new PipelineRunner(await ctx.buildPipelineConfig(sessionLlm));
    pipeline.writeDraft(id, body.context, body.wordCount).then(
      (result) => {
        legacyBroadcast("draft:complete", { bookId: id, chapterNumber: result.chapterNumber, title: result.title, wordCount: result.wordCount });
      },
      (e) => {
        legacyBroadcast("draft:error", { bookId: id, error: e instanceof Error ? e.message : String(e) });
      },
    );

    return c.json({ status: "drafting", bookId: id });
  });

  // --- Audit ---

  app.post("/api/books/:id/audit/:chapter", async (c) => {
    const id = c.req.param("id");
    const chapterNum = parseInt(c.req.param("chapter"), 10);
    const bookDir = state.bookDir(id);

    legacyBroadcast("audit:start", { bookId: id, chapter: chapterNum });
    try {
      const book = await state.loadBookConfig(id);
      const chaptersDir = join(bookDir, "chapters");
      const files = await readdir(chaptersDir);
      const paddedNum = String(chapterNum).padStart(4, "0");
      const match = files.find((f) => f.startsWith(paddedNum) && f.endsWith(".md"));
      if (!match) return c.json({ error: "Chapter not found" }, 404);

      const content = await readFile(join(chaptersDir, match), "utf-8");
      const currentConfig = await import("@actalk/inkos-core").then(m => m.loadProjectConfig(root, { requireApiKey: false }));
      const { ContinuityAuditor } = await import("@actalk/inkos-core");
      const auditor = new ContinuityAuditor({
        client: createLLMClient(currentConfig.llm),
        model: currentConfig.llm.model,
        projectRoot: root,
        bookId: id,
      });
      const result = await auditor.auditChapter(bookDir, content, chapterNum, book.genre);
      legacyBroadcast("audit:complete", { bookId: id, chapter: chapterNum, passed: result.passed });
      return c.json(result);
    } catch (e) {
      legacyBroadcast("audit:error", { bookId: id, error: String(e) });
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

    legacyBroadcast("revise:start", { bookId: id, chapter: chapterNum });
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
      legacyBroadcast("revise:complete", { bookId: id, chapter: chapterNum });
      return c.json(result);
    } catch (e) {
      legacyBroadcast("revise:error", { bookId: id, error: String(e) });
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

    legacyBroadcast("rewrite:start", { bookId: id, chapter: chapterNum });
    try {
      const rollbackTarget = chapterNum - 1;
      const discarded = await state.rollbackToChapter(id, rollbackTarget);
      const pipeline = new PipelineRunner(await ctx.buildPipelineConfig({
        externalContext: body.brief,
        ...(await ctx.getSessionLlm(c)),
      }));
      pipeline.writeNextChapter(id).then(
        (result) => legacyBroadcast("rewrite:complete", { bookId: id, chapterNumber: result.chapterNumber, title: result.title, wordCount: result.wordCount }),
        (e) => legacyBroadcast("rewrite:error", { bookId: id, error: e instanceof Error ? e.message : String(e) }),
      );
      return c.json({ status: "rewriting", bookId: id, chapter: chapterNum, rolledBackTo: rollbackTarget, discarded });
    } catch (e) {
      legacyBroadcast("rewrite:error", { bookId: id, error: String(e) });
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
      const { analyzeAITells } = await import("@actalk/inkos-core");
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
      const { analyzeAITells } = await import("@actalk/inkos-core");

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
      const { analyzeStyle } = await import("@actalk/inkos-core");
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

    legacyBroadcast("style:start", { bookId: id });
    try {
      const sessionLlm = await ctx.getSessionLlm(c);
      const pipeline = new PipelineRunner(await ctx.buildPipelineConfig(sessionLlm));
      const result = await pipeline.generateStyleGuide(id, text, sourceName ?? "unknown");
      legacyBroadcast("style:complete", { bookId: id });
      return c.json({ ok: true, result });
    } catch (e) {
      legacyBroadcast("style:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Import Chapters ---

  app.post("/api/books/:id/import/chapters", async (c) => {
    const id = c.req.param("id");
    const { text, splitRegex } = await c.req.json<{ text: string; splitRegex?: string }>();
    if (!text?.trim()) return c.json({ error: "text is required" }, 400);

    legacyBroadcast("import:start", { bookId: id, type: "chapters" });
    try {
      const { splitChapters } = await import("@actalk/inkos-core");
      const chapters = [...splitChapters(text, splitRegex)];

      const sessionLlm = await ctx.getSessionLlm(c);
      const pipeline = new PipelineRunner(await ctx.buildPipelineConfig(sessionLlm));
      const result = await pipeline.importChapters({ bookId: id, chapters });
      legacyBroadcast("import:complete", { bookId: id, type: "chapters", count: result.importedCount });
      return c.json(result);
    } catch (e) {
      legacyBroadcast("import:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Import Canon ---

  app.post("/api/books/:id/import/canon", async (c) => {
    const id = c.req.param("id");
    const { fromBookId } = await c.req.json<{ fromBookId: string }>();
    if (!fromBookId) return c.json({ error: "fromBookId is required" }, 400);

    legacyBroadcast("import:start", { bookId: id, type: "canon" });
    try {
      const sessionLlm = await ctx.getSessionLlm(c);
      const pipeline = new PipelineRunner(await ctx.buildPipelineConfig(sessionLlm));
      await pipeline.importCanon(id, fromBookId);
      legacyBroadcast("import:complete", { bookId: id, type: "canon" });
      return c.json({ ok: true });
    } catch (e) {
      legacyBroadcast("import:error", { bookId: id, error: String(e) });
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

    legacyBroadcast("fanfic:start", { bookId, title: body.title });
    try {
      const sessionLlm = await ctx.getSessionLlm(c);
      const pipeline = new PipelineRunner(await ctx.buildPipelineConfig(sessionLlm));
      await pipeline.initFanficBook(bookConfig, body.sourceText, body.sourceName ?? "source", (body.mode ?? "canon") as "canon");
      legacyBroadcast("fanfic:complete", { bookId });
      return c.json({ ok: true, bookId });
    } catch (e) {
      legacyBroadcast("fanfic:error", { bookId, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Fanfic Refresh ---

  app.post("/api/books/:id/fanfic/refresh", async (c) => {
    const id = c.req.param("id");
    const { sourceText, sourceName } = await c.req.json<{ sourceText: string; sourceName?: string }>();
    if (!sourceText?.trim()) return c.json({ error: "sourceText is required" }, 400);

    legacyBroadcast("fanfic:refresh:start", { bookId: id });
    try {
      const book = await state.loadBookConfig(id);
      const sessionLlm = await ctx.getSessionLlm(c);
      const pipeline = new PipelineRunner(await ctx.buildPipelineConfig(sessionLlm));
      await pipeline.importFanficCanon(id, sourceText, sourceName ?? "source", (book.fanficMode ?? "canon") as "canon");
      legacyBroadcast("fanfic:refresh:complete", { bookId: id });
      return c.json({ ok: true });
    } catch (e) {
      legacyBroadcast("fanfic:refresh:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Radar Scan ---

  app.post("/api/radar/scan", async (c) => {
    legacyBroadcast("radar:start", {});
    try {
      const sessionLlm = await ctx.getSessionLlm(c);
      const pipeline = new PipelineRunner(await ctx.buildPipelineConfig(sessionLlm));
      const result = await pipeline.runRadar();
      legacyBroadcast("radar:complete", { result });
      return c.json(result);
    } catch (e) {
      legacyBroadcast("radar:error", { error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Agent ---

  app.post("/api/agent", async (c) => {
    const { instruction } = await c.req.json<{ instruction: string }>();
    if (!instruction?.trim()) {
      return c.json({ error: "No instruction provided" }, 400);
    }

    legacyBroadcast("agent:start", { instruction });

    try {
      const { runAgentLoop } = await import("@actalk/inkos-core");

      const result = await runAgentLoop(
        await ctx.buildPipelineConfig(await ctx.getSessionLlm(c)),
        instruction
      );

      legacyBroadcast("agent:complete", { instruction, response: result });
      return c.json({ response: result });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      legacyBroadcast("agent:error", { instruction, error: msg });
      return c.json({ response: msg });
    }
  });

  // --- Legacy global SSE (kept for backward compat, Phase 2 removes) ---

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
