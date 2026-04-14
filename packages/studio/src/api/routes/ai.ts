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
  chatCompletion,
  filterHooks,
  filterSummaries,
  filterSubplots,
  filterEmotionalArcs,
  filterCharacterMatrix,
  extractPOVFromOutline,
  filterMatrixByPOV,
  filterHooksByPOV,
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
      .json<{ text: string; surrounding: string; mode: string }>()
      .catch(() => ({ text: "", surrounding: "", mode: "" }));

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

    try {
      const sessionLlm = await ctx.getSessionLlm(c);
      const config = await ctx.buildPipelineConfig(sessionLlm);

      const messages = [
        { role: "system" as const, content: TRANSFORM_PROMPTS[mode] },
        {
          role: "user" as const,
          content: `### 上下文\n${body.surrounding}\n\n### 需要处理的选中文本\n${body.text}`,
        },
      ];

      const response = await chatCompletion(config.client, config.model, messages);
      return c.json({ result: response.content, mode });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Context Assembly (for ContextPanel) ---

  const TRUTH_LABEL_MAP: Record<string, string> = {
    "story_bible.md": "故事圣经",
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

  // --- Inline Completion (ghost text / Tab completion) ---

  app.post("/api/ai/complete", async (c) => {
    const body = await c.req.json<{ text: string; surrounding: string }>().catch(() => ({ text: "", surrounding: "" }));
    if (!body.text?.trim() && !body.surrounding?.trim()) {
      return c.json({ error: "text or surrounding is required" }, 400);
    }

    const sessionLlm = await ctx.getSessionLlm(c);
    const config = await ctx.buildPipelineConfig(sessionLlm);

    const systemPrompt = "你是一位小说续写助手。根据上下文，自然地续写下一句话（30-80字）。只返回续写内容，不要解释，不要重复已有文本。保持风格一致。";

    return streamSSE(c, async (stream) => {
      try {
        const messages = [
          { role: "system" as const, content: systemPrompt },
          { role: "user" as const, content: `### 上下文\n${body.surrounding}\n\n### 当前段落末尾\n${body.text}` },
        ];

        const response = await chatCompletion(config.client, config.model, messages);

        // Split response into chunks to simulate streaming
        const fullText = response.content;
        const chunkSize = 4;
        for (let i = 0; i < fullText.length; i += chunkSize) {
          const chunk = fullText.slice(i, i + chunkSize);
          await stream.writeSSE({
            event: "chunk",
            data: JSON.stringify({ text: chunk, done: false }),
          });
        }
        await stream.writeSSE({
          event: "chunk",
          data: JSON.stringify({ text: "", done: true }),
        });
      } catch (e) {
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({ error: String(e) }),
        });
      }
    });
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
