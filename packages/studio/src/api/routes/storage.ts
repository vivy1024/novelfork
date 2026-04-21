/**
 * Storage routes — mounted only in standalone mode.
 * ~30 endpoints: books CRUD, chapters, truth files, genres, project config,
 * exports, analytics, logs, doctor, fanfic read.
 */

import { Hono } from "hono";
import { readFile, readdir, access, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  PipelineRunner,
  computeAnalytics,
  loadProjectConfig,
} from "@vivy1024/novelfork-core";
import { ApiError } from "../errors.js";
import { buildStudioBookConfig, buildStudioProjectInitRecord } from "../book-create.js";
import type { RouterContext } from "./context.js";

const TRUTH_FILES = [
  "story_bible.md", "volume_outline.md", "current_state.md",
  "particle_ledger.md", "pending_hooks.md", "chapter_summaries.md",
  "subplot_board.md", "emotional_arcs.md", "character_matrix.md",
  "style_guide.md", "parent_canon.md", "fanfic_canon.md", "book_rules.md",
  "author_intent.md", "current_focus.md",
];

export function createStorageRouter(ctx: RouterContext): Hono {
  const app = new Hono();
  const { state, root, broadcast } = ctx;

  // Note: bookId validation middleware is registered globally in server.ts

  // In-memory book creation status tracking
  const bookCreateStatus = new Map<string, { status: "creating" | "error"; error?: string }>();

  // --- Books ---

  app.get("/api/books", async (c) => {
    const bookIds = await state.listBooks();
    const books = await Promise.all(
      bookIds.map(async (id) => {
        const book = await state.loadBookConfig(id);
        const nextChapter = await state.getNextChapterNumber(id);
        return { ...book, chaptersWritten: nextChapter - 1 };
      }),
    );
    return c.json({ books });
  });

  app.get("/api/books/:id", async (c) => {
    const id = c.req.param("id");
    try {
      const book = await state.loadBookConfig(id);
      const chapters = await state.loadChapterIndex(id);
      const nextChapter = await state.getNextChapterNumber(id);
      return c.json({ book, chapters, nextChapter });
    } catch {
      return c.json({ error: `Book "${id}" not found` }, 404);
    }
  });

  app.post("/api/books/create", async (c) => {
    const body = await c.req.json<{
      title: string;
      genre: string;
      language?: string;
      platform?: string;
      chapterWordCount?: number;
      targetChapters?: number;
      projectInit?: {
        repositorySource?: "new" | "existing" | "clone";
        workflowMode?: "outline-first" | "draft-first" | "serial-ops";
        templatePreset?: "genre-default" | "blank-slate" | "web-serial";
        repositoryPath?: string;
        cloneUrl?: string;
        gitBranch?: string;
        worktreeName?: string;
      };
      initializationPlan?: {
        phase: "project-create";
        nextStage: "book-create";
        readyToContinue: boolean;
        blockingField?: "repositoryPath" | "cloneUrl";
      };
    }>();

    const now = new Date().toISOString();
    const bookConfig = buildStudioBookConfig(body, now);
    const bookId = bookConfig.id;
    const bookDir = state.bookDir(bookId);

    try {
      await access(join(bookDir, "book.json"));
      await access(join(bookDir, "story", "story_bible.md"));
      return c.json({ error: `Book "${bookId}" already exists` }, 409);
    } catch {
      // The target book is not fully initialized yet, so creation can continue.
    }

    broadcast("book:creating", { bookId, title: body.title });
    bookCreateStatus.set(bookId, { status: "creating" });

    const sessionLlm = await ctx.getSessionLlm(c);
    const pipeline = new PipelineRunner(await ctx.buildPipelineConfig(sessionLlm));
    pipeline.initBook(bookConfig).then(
      async () => {
        if (body.projectInit) {
          try {
            const projectInitRecord = buildStudioProjectInitRecord(body, now);
            const { mkdir, writeFile: writeFileFs } = await import("node:fs/promises");
            await mkdir(bookDir, { recursive: true });
            await writeFileFs(
              join(bookDir, ".novelfork-project-init.json"),
              `${JSON.stringify(projectInitRecord, null, 2)}\n`,
              "utf-8",
            );
          } catch {
            // Keep book creation compatible even if the first-round init sidecar fails.
          }
        }
        bookCreateStatus.delete(bookId);
        broadcast("book:created", { bookId });
      },
      (e) => {
        const error = e instanceof Error ? e.message : String(e);
        bookCreateStatus.set(bookId, { status: "error", error });
        broadcast("book:error", { bookId, error });
      },
    );

    return c.json({ status: "creating", bookId });
  });

  app.get("/api/books/:id/create-status", async (c) => {
    const id = c.req.param("id");
    const status = bookCreateStatus.get(id);
    if (!status) {
      return c.json({ status: "missing" }, 404);
    }
    return c.json(status);
  });

  app.put("/api/books/:id", async (c) => {
    const id = c.req.param("id");
    const updates = await c.req.json<{
      chapterWordCount?: number;
      targetChapters?: number;
      status?: string;
      language?: string;
    }>();
    try {
      const book = await state.loadBookConfig(id);
      const updated = {
        ...book,
        ...(updates.chapterWordCount !== undefined ? { chapterWordCount: Number(updates.chapterWordCount) } : {}),
        ...(updates.targetChapters !== undefined ? { targetChapters: Number(updates.targetChapters) } : {}),
        ...(updates.status !== undefined ? { status: updates.status as typeof book.status } : {}),
        ...(updates.language !== undefined ? { language: updates.language as "zh" | "en" } : {}),
        updatedAt: new Date().toISOString(),
      };
      await state.saveBookConfig(id, updated);
      return c.json({ ok: true, book: updated });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.delete("/api/books/:id", async (c) => {
    const id = c.req.param("id");
    const bookDir = state.bookDir(id);
    try {
      const { rm } = await import("node:fs/promises");
      await rm(bookDir, { recursive: true, force: true });
      broadcast("book:deleted", { bookId: id });
      return c.json({ ok: true, bookId: id });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Chapters ---

  app.get("/api/books/:id/chapters/:num", async (c) => {
    const id = c.req.param("id");
    const num = parseInt(c.req.param("num"), 10);
    const bookDir = state.bookDir(id);
    const chaptersDir = join(bookDir, "chapters");

    try {
      const files = await readdir(chaptersDir);
      const paddedNum = String(num).padStart(4, "0");
      const match = files.find((f) => f.startsWith(paddedNum) && f.endsWith(".md"));
      if (!match) return c.json({ error: "Chapter not found" }, 404);
      const content = await readFile(join(chaptersDir, match), "utf-8");
      return c.json({ chapterNumber: num, filename: match, content });
    } catch {
      return c.json({ error: "Chapter not found" }, 404);
    }
  });

  app.put("/api/books/:id/chapters/:num", async (c) => {
    const id = c.req.param("id");
    const num = parseInt(c.req.param("num"), 10);
    const bookDir = state.bookDir(id);
    const chaptersDir = join(bookDir, "chapters");
    const { content } = await c.req.json<{ content: string }>();

    try {
      const files = await readdir(chaptersDir);
      const paddedNum = String(num).padStart(4, "0");
      const match = files.find((f) => f.startsWith(paddedNum) && f.endsWith(".md"));
      if (!match) return c.json({ error: "Chapter not found" }, 404);

      const { writeFile: writeFileFs } = await import("node:fs/promises");
      await writeFileFs(join(chaptersDir, match), content, "utf-8");
      return c.json({ ok: true, chapterNumber: num });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/books/:id/chapters/:num/approve", async (c) => {
    const id = c.req.param("id");
    const num = parseInt(c.req.param("num"), 10);

    try {
      const index = await state.loadChapterIndex(id);
      const updated = index.map((ch) =>
        ch.number === num ? { ...ch, status: "approved" as const } : ch,
      );
      await state.saveChapterIndex(id, updated);
      return c.json({ ok: true, chapterNumber: num, status: "approved" });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/books/:id/chapters/:num/reject", async (c) => {
    const id = c.req.param("id");
    const num = parseInt(c.req.param("num"), 10);

    try {
      const index = await state.loadChapterIndex(id);
      const target = index.find((ch) => ch.number === num);
      if (!target) {
        return c.json({ error: `Chapter ${num} not found` }, 404);
      }

      const rollbackTarget = num - 1;
      const discarded = await state.rollbackToChapter(id, rollbackTarget);
      return c.json({
        ok: true,
        chapterNumber: num,
        status: "rejected",
        rolledBackTo: rollbackTarget,
        discarded,
      });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Truth files ---

  app.get("/api/books/:id/truth/:file", async (c) => {
    const id = c.req.param("id");
    const file = c.req.param("file");

    if (!TRUTH_FILES.includes(file)) {
      return c.json({ error: "Invalid truth file" }, 400);
    }

    const bookDir = state.bookDir(id);
    try {
      const content = await readFile(join(bookDir, "story", file), "utf-8");
      return c.json({ file, content });
    } catch {
      return c.json({ file, content: null });
    }
  });

  app.put("/api/books/:id/truth/:file", async (c) => {
    const id = c.req.param("id");
    const file = c.req.param("file");
    if (!TRUTH_FILES.includes(file)) {
      return c.json({ error: "Invalid truth file" }, 400);
    }
    const { content } = await c.req.json<{ content: string }>();
    const bookDir = state.bookDir(id);
    const { writeFile: writeFileFs, mkdir: mkdirFs } = await import("node:fs/promises");
    await mkdirFs(join(bookDir, "story"), { recursive: true });
    await writeFileFs(join(bookDir, "story", file), content, "utf-8");
    return c.json({ ok: true });
  });

  app.get("/api/books/:id/truth", async (c) => {
    const id = c.req.param("id");
    const bookDir = state.bookDir(id);
    const storyDir = join(bookDir, "story");
    try {
      const files = await readdir(storyDir);
      const mdFiles = files.filter((f) => f.endsWith(".md") || f.endsWith(".json"));
      const result = await Promise.all(
        mdFiles.map(async (f) => {
          const content = await readFile(join(storyDir, f), "utf-8");
          return { name: f, size: content.length, preview: content.slice(0, 200) };
        }),
      );
      return c.json({ files: result });
    } catch {
      return c.json({ files: [] });
    }
  });

  // --- State Projections ---

  app.get("/api/books/:id/state", async (c) => {
    const id = c.req.param("id");
    const bookDir = state.bookDir(id);
    try {
      const { loadRuntimeStateSnapshot } = await import("@vivy1024/novelfork-core");
      const snapshot = await loadRuntimeStateSnapshot(bookDir);
      return c.json(snapshot);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Analytics ---

  app.get("/api/books/:id/analytics", async (c) => {
    const id = c.req.param("id");
    try {
      const chapters = await state.loadChapterIndex(id);
      return c.json(computeAnalytics(id, chapters));
    } catch {
      return c.json({ error: `Book "${id}" not found` }, 404);
    }
  });

  // --- Daily Writing Stats ---

  app.get("/api/daily-stats", async (c) => {
    const bookIds = await state.listBooks();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayMs = todayStart.getTime();

    let todayWords = 0;
    let todayChapters = 0;
    const recentDays: Map<string, number> = new Map();

    for (const bookId of bookIds) {
      const chaptersDir = join(state.bookDir(bookId), "chapters");
      try {
        const files = await readdir(chaptersDir);
        const mdFiles = files.filter((f) => f.endsWith(".md")).sort();
        for (const f of mdFiles) {
          const filePath = join(chaptersDir, f);
          const fileStat = await stat(filePath);
          const mtime = fileStat.mtimeMs;
          const dayKey = new Date(mtime).toISOString().slice(0, 10);
          const content = await readFile(filePath, "utf-8");
          const wc = content.replace(/\s+/g, "").length;

          recentDays.set(dayKey, (recentDays.get(dayKey) ?? 0) + wc);

          if (mtime >= todayMs) {
            todayWords += wc;
            todayChapters += 1;
          }
        }
      } catch {
        // no chapters dir
      }
    }

    // Last 7 days trend
    const trend: { date: string; words: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(todayMs - i * 86400000);
      const key = d.toISOString().slice(0, 10);
      trend.push({ date: key, words: recentDays.get(key) ?? 0 });
    }

    return c.json({ todayWords, todayChapters, trend });
  });

  // --- Genres ---

  app.get("/api/genres", async (c) => {
    const { listAvailableGenres, readGenreProfile } = await import("@vivy1024/novelfork-core");
    const rawGenres = await listAvailableGenres(root);
    const genres = await Promise.all(
      rawGenres.map(async (g) => {
        try {
          const { profile } = await readGenreProfile(root, g.id);
          return { ...g, language: profile.language ?? "zh" };
        } catch {
          return { ...g, language: "zh" };
        }
      }),
    );
    return c.json({ genres });
  });

  app.get("/api/genres/:id", async (c) => {
    const genreId = c.req.param("id");
    try {
      const { readGenreProfile } = await import("@vivy1024/novelfork-core");
      const { profile, body } = await readGenreProfile(root, genreId);
      return c.json({ profile, body });
    } catch (e) {
      return c.json({ error: String(e) }, 404);
    }
  });

  app.post("/api/genres/:id/copy", async (c) => {
    const genreId = c.req.param("id");
    if (/[/\\\0]/.test(genreId) || genreId.includes("..")) {
      throw new ApiError(400, "INVALID_GENRE_ID", `Invalid genre ID: "${genreId}"`);
    }
    try {
      const { getBuiltinGenresDir } = await import("@vivy1024/novelfork-core");
      const { mkdir: mkdirFs, copyFile } = await import("node:fs/promises");
      const builtinDir = getBuiltinGenresDir();
      const projectGenresDir = join(root, "genres");
      await mkdirFs(projectGenresDir, { recursive: true });
      await copyFile(join(builtinDir, `${genreId}.md`), join(projectGenresDir, `${genreId}.md`));
      return c.json({ ok: true, path: `genres/${genreId}.md` });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/genres/create", async (c) => {
    const body = await c.req.json<{
      id: string; name: string; language?: string;
      chapterTypes?: string[]; fatigueWords?: string[];
      numericalSystem?: boolean; powerScaling?: boolean; eraResearch?: boolean;
      pacingRule?: string; satisfactionTypes?: string[]; auditDimensions?: number[];
      body?: string;
    }>();

    if (!body.id || !body.name) {
      return c.json({ error: "id and name are required" }, 400);
    }
    if (/[/\\\0]/.test(body.id) || body.id.includes("..")) {
      throw new ApiError(400, "INVALID_GENRE_ID", `Invalid genre ID: "${body.id}"`);
    }

    const { writeFile: writeFileFs, mkdir: mkdirFs } = await import("node:fs/promises");
    const genresDir = join(root, "genres");
    await mkdirFs(genresDir, { recursive: true });

    const frontmatter = [
      "---",
      `name: ${body.name}`,
      `id: ${body.id}`,
      `language: ${body.language ?? "zh"}`,
      `chapterTypes: ${JSON.stringify(body.chapterTypes ?? [])}`,
      `fatigueWords: ${JSON.stringify(body.fatigueWords ?? [])}`,
      `numericalSystem: ${body.numericalSystem ?? false}`,
      `powerScaling: ${body.powerScaling ?? false}`,
      `eraResearch: ${body.eraResearch ?? false}`,
      `pacingRule: "${body.pacingRule ?? ""}"`,
      `satisfactionTypes: ${JSON.stringify(body.satisfactionTypes ?? [])}`,
      `auditDimensions: ${JSON.stringify(body.auditDimensions ?? [])}`,
      "---",
      "",
      body.body ?? "",
    ].join("\n");

    await writeFileFs(join(genresDir, `${body.id}.md`), frontmatter, "utf-8");
    return c.json({ ok: true, id: body.id });
  });

  app.put("/api/genres/:id", async (c) => {
    const genreId = c.req.param("id");
    if (/[/\\\0]/.test(genreId) || genreId.includes("..")) {
      throw new ApiError(400, "INVALID_GENRE_ID", `Invalid genre ID: "${genreId}"`);
    }

    const body = await c.req.json<{ profile: Record<string, unknown>; body: string }>();
    const { writeFile: writeFileFs, mkdir: mkdirFs } = await import("node:fs/promises");
    const genresDir = join(root, "genres");
    await mkdirFs(genresDir, { recursive: true });

    const p = body.profile;
    const frontmatter = [
      "---",
      `name: ${p.name ?? genreId}`,
      `id: ${p.id ?? genreId}`,
      `language: ${p.language ?? "zh"}`,
      `chapterTypes: ${JSON.stringify(p.chapterTypes ?? [])}`,
      `fatigueWords: ${JSON.stringify(p.fatigueWords ?? [])}`,
      `numericalSystem: ${p.numericalSystem ?? false}`,
      `powerScaling: ${p.powerScaling ?? false}`,
      `eraResearch: ${p.eraResearch ?? false}`,
      `pacingRule: "${p.pacingRule ?? ""}"`,
      `satisfactionTypes: ${JSON.stringify(p.satisfactionTypes ?? [])}`,
      `auditDimensions: ${JSON.stringify(p.auditDimensions ?? [])}`,
      "---",
      "",
      body.body ?? "",
    ].join("\n");

    await writeFileFs(join(genresDir, `${genreId}.md`), frontmatter, "utf-8");
    return c.json({ ok: true, id: genreId });
  });

  app.delete("/api/genres/:id", async (c) => {
    const genreId = c.req.param("id");
    if (/[/\\\0]/.test(genreId) || genreId.includes("..")) {
      throw new ApiError(400, "INVALID_GENRE_ID", `Invalid genre ID: "${genreId}"`);
    }

    const filePath = join(root, "genres", `${genreId}.md`);
    try {
      const { rm } = await import("node:fs/promises");
      await rm(filePath);
      return c.json({ ok: true, id: genreId });
    } catch (e) {
      return c.json({ error: `Genre "${genreId}" not found in project` }, 404);
    }
  });

  // --- Project config ---

  app.get("/api/project", async (c) => {
    const currentConfig = await loadProjectConfig(root, { requireApiKey: false });
    const raw = JSON.parse(await readFile(join(root, "novelfork.json"), "utf-8"));
    const languageExplicit = "language" in raw && raw.language !== "";

    return c.json({
      name: currentConfig.name,
      language: currentConfig.language,
      languageExplicit,
      model: currentConfig.llm.model,
      provider: currentConfig.llm.provider,
      baseUrl: currentConfig.llm.baseUrl,
      stream: currentConfig.llm.stream,
      temperature: currentConfig.llm.temperature,
      maxTokens: currentConfig.llm.maxTokens,
      daemon: currentConfig.daemon,
      detection: currentConfig.detection ?? null,
      llm: {
        thinkingBudget: currentConfig.llm.thinkingBudget,
        apiFormat: currentConfig.llm.apiFormat,
        extra: currentConfig.llm.extra,
        headers: currentConfig.llm.headers,
      },
    });
  });

  app.put("/api/project", async (c) => {
    const updates = await c.req.json<Record<string, unknown>>();
    const configPath = join(root, "novelfork.json");
    try {
      const raw = await readFile(configPath, "utf-8");
      const existing = JSON.parse(raw);
      if (updates.temperature !== undefined) existing.llm.temperature = updates.temperature;
      if (updates.maxTokens !== undefined) existing.llm.maxTokens = updates.maxTokens;
      if (updates.stream !== undefined) existing.llm.stream = updates.stream;
      if (updates.language === "zh" || updates.language === "en") existing.language = updates.language;
      // daemon 配置
      if (updates.daemon && typeof updates.daemon === "object") {
        existing.daemon = { ...existing.daemon, ...(updates.daemon as Record<string, unknown>) };
      }
      // detection 配置
      if (updates.detection && typeof updates.detection === "object") {
        existing.detection = { ...existing.detection, ...(updates.detection as Record<string, unknown>) };
      }
      // llm 高级参数
      if (updates.llm && typeof updates.llm === "object") {
        const llmUpdates = updates.llm as Record<string, unknown>;
        if (llmUpdates.thinkingBudget !== undefined) existing.llm.thinkingBudget = llmUpdates.thinkingBudget;
        if (llmUpdates.apiFormat !== undefined) existing.llm.apiFormat = llmUpdates.apiFormat;
        if (llmUpdates.extra !== undefined) existing.llm.extra = llmUpdates.extra;
        if (llmUpdates.headers !== undefined) existing.llm.headers = llmUpdates.headers;
      }
      const { writeFile: writeFileFs } = await import("node:fs/promises");
      await writeFileFs(configPath, JSON.stringify(existing, null, 2), "utf-8");
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/project/language", async (c) => {
    const { language } = await c.req.json<{ language: "zh" | "en" }>();
    const configPath = join(root, "novelfork.json");
    try {
      const raw = await readFile(configPath, "utf-8");
      const existing = JSON.parse(raw);
      existing.language = language;
      const { writeFile: writeFileFs } = await import("node:fs/promises");
      await writeFileFs(configPath, JSON.stringify(existing, null, 2), "utf-8");
      return c.json({ ok: true, language });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.get("/api/project/model-overrides", async (c) => {
    const raw = JSON.parse(await readFile(join(root, "novelfork.json"), "utf-8"));
    return c.json({ overrides: raw.modelOverrides ?? {} });
  });

  app.put("/api/project/model-overrides", async (c) => {
    const { overrides } = await c.req.json<{ overrides: Record<string, unknown> }>();
    const configPath = join(root, "novelfork.json");
    const raw = JSON.parse(await readFile(configPath, "utf-8"));
    raw.modelOverrides = overrides;
    const { writeFile: writeFileFs } = await import("node:fs/promises");
    await writeFileFs(configPath, JSON.stringify(raw, null, 2), "utf-8");
    return c.json({ ok: true });
  });

  app.get("/api/project/notify", async (c) => {
    const raw = JSON.parse(await readFile(join(root, "novelfork.json"), "utf-8"));
    return c.json({ channels: raw.notify ?? [] });
  });

  app.put("/api/project/notify", async (c) => {
    const { channels } = await c.req.json<{ channels: unknown[] }>();
    const configPath = join(root, "novelfork.json");
    const raw = JSON.parse(await readFile(configPath, "utf-8"));
    raw.notify = channels;
    const { writeFile: writeFileFs } = await import("node:fs/promises");
    await writeFileFs(configPath, JSON.stringify(raw, null, 2), "utf-8");
    return c.json({ ok: true });
  });

  // --- Export ---

  app.get("/api/books/:id/export", async (c) => {
    const id = c.req.param("id");
    const format = (c.req.query("format") ?? "txt") as string;
    const approvedOnly = c.req.query("approvedOnly") === "true";
    const bookDir = state.bookDir(id);
    const chaptersDir = join(bookDir, "chapters");

    try {
      const book = await state.loadBookConfig(id);
      const index = await state.loadChapterIndex(id);
      const approvedNums = new Set(
        approvedOnly ? index.filter((ch) => ch.status === "approved").map((ch) => ch.number) : [],
      );

      const files = await readdir(chaptersDir);
      const mdFiles = files.filter((f) => f.endsWith(".md") && /^\d{4}/.test(f)).sort();

      const filteredFiles = approvedOnly
        ? mdFiles.filter((f) => approvedNums.has(parseInt(f.slice(0, 4), 10)))
        : mdFiles;

      const contents = await Promise.all(
        filteredFiles.map((f) => readFile(join(chaptersDir, f), "utf-8")),
      );

      if (format === "epub") {
        const chapters = contents.map((content, i) => {
          const title = content.match(/^#\s+(.+)$/m)?.[1] ?? `Chapter ${i + 1}`;
          const html = content.split("\n").filter((l) => !l.startsWith("#")).map((l) => l.trim() ? `<p>${l}</p>` : "").join("\n");
          return { title, html };
        });
        const toc = chapters.map((ch, i) => `<li><a href="#ch${i}">${ch.title}</a></li>`).join("\n");
        const body = chapters.map((ch, i) => `<h2 id="ch${i}">${ch.title}</h2>\n${ch.html}`).join("\n<hr/>\n");
        const epub = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${book.title}</title><style>body{font-family:serif;max-width:40em;margin:auto;padding:2em;line-height:1.8}h2{margin-top:3em}</style></head><body><h1>${book.title}</h1><nav><ol>${toc}</ol></nav><hr/>${body}</body></html>`;
        return new Response(epub, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Content-Disposition": `attachment; filename="${id}.html"`,
          },
        });
      }
      if (format === "md") {
        const body = contents.join("\n\n---\n\n");
        return new Response(body, {
          headers: {
            "Content-Type": "text/markdown; charset=utf-8",
            "Content-Disposition": `attachment; filename="${id}.md"`,
          },
        });
      }
      // Default: txt
      const body = contents.join("\n\n");
      return new Response(body, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename="${id}.txt"`,
        },
      });
    } catch {
      return c.json({ error: "Export failed" }, 500);
    }
  });

  app.post("/api/books/:id/export-save", async (c) => {
    const id = c.req.param("id");
    const { format, approvedOnly } = await c.req.json<{ format?: string; approvedOnly?: boolean }>().catch(() => ({ format: "txt", approvedOnly: false }));
    const bookDir = state.bookDir(id);
    const chaptersDir = join(bookDir, "chapters");
    const fmt = format ?? "txt";

    try {
      const book = await state.loadBookConfig(id);
      const index = await state.loadChapterIndex(id);
      const approvedNums = new Set(
        approvedOnly ? index.filter((ch) => ch.status === "approved").map((ch) => ch.number) : [],
      );

      const files = await readdir(chaptersDir);
      const mdFiles = files.filter((f) => f.endsWith(".md") && /^\d{4}/.test(f)).sort();
      const filteredFiles = approvedOnly
        ? mdFiles.filter((f) => approvedNums.has(parseInt(f.slice(0, 4), 10)))
        : mdFiles;
      const contents = await Promise.all(
        filteredFiles.map((f) => readFile(join(chaptersDir, f), "utf-8")),
      );

      const { writeFile: writeFileFs } = await import("node:fs/promises");
      let outputPath: string;
      let body: string;

      if (fmt === "md") {
        body = contents.join("\n\n---\n\n");
        outputPath = join(bookDir, `${id}.md`);
      } else if (fmt === "epub") {
        const chapters = contents.map((content, i) => {
          const title = content.match(/^#\s+(.+)$/m)?.[1] ?? `Chapter ${i + 1}`;
          const html = content.split("\n").filter((l) => !l.startsWith("#")).map((l) => l.trim() ? `<p>${l}</p>` : "").join("\n");
          return { title, html };
        });
        const toc = chapters.map((ch, i) => `<li><a href="#ch${i}">${ch.title}</a></li>`).join("\n");
        const chapterHtml = chapters.map((ch, i) => `<h2 id="ch${i}">${ch.title}</h2>\n${ch.html}`).join("\n<hr/>\n");
        body = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${book.title}</title><style>body{font-family:serif;max-width:40em;margin:auto;padding:2em;line-height:1.8}h2{margin-top:3em}</style></head><body><h1>${book.title}</h1><nav><ol>${toc}</ol></nav><hr/>${chapterHtml}</body></html>`;
        outputPath = join(bookDir, `${id}.html`);
      } else {
        body = contents.join("\n\n");
        outputPath = join(bookDir, `${id}.txt`);
      }

      await writeFileFs(outputPath, body, "utf-8");
      return c.json({ ok: true, path: outputPath, format: fmt, chapters: filteredFiles.length });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Fanfic read ---

  app.get("/api/books/:id/fanfic", async (c) => {
    const id = c.req.param("id");
    const bookDir = state.bookDir(id);
    try {
      const content = await readFile(join(bookDir, "story", "fanfic_canon.md"), "utf-8");
      return c.json({ bookId: id, content });
    } catch {
      return c.json({ bookId: id, content: null });
    }
  });

  // --- Detect stats (local computation) ---

  app.get("/api/books/:id/detect/stats", async (c) => {
    const id = c.req.param("id");
    try {
      const { loadDetectionHistory, analyzeDetectionInsights } = await import("@vivy1024/novelfork-core");
      const bookDir = state.bookDir(id);
      const history = await loadDetectionHistory(bookDir);
      const insights = analyzeDetectionInsights(history);
      return c.json(insights);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Logs ---

  app.get("/api/logs", async (c) => {
    const logPath = join(root, "inkos.log");
    try {
      const content = await readFile(logPath, "utf-8");
      const lines = content.trim().split("\n").slice(-100);
      const entries = lines.map((line) => {
        try { return JSON.parse(line); } catch { return { message: line }; }
      });
      return c.json({ entries });
    } catch {
      return c.json({ entries: [] });
    }
  });

  // --- Doctor ---

  app.get("/api/doctor", async (c) => {
    const { existsSync } = await import("node:fs");
    const { GLOBAL_ENV_PATH, createLLMClient, chatCompletion } = await import("@vivy1024/novelfork-core");

    const checks = {
      projectConfig: existsSync(join(root, "novelfork.json")),
      projectEnv: existsSync(join(root, ".env")),
      globalEnv: existsSync(GLOBAL_ENV_PATH),
      booksDir: existsSync(join(root, "books")),
      llmConnected: false,
      bookCount: 0,
    };

    try {
      const books = await state.listBooks();
      checks.bookCount = books.length;
    } catch { /* ignore */ }

    try {
      const currentConfig = await loadProjectConfig(root, { requireApiKey: false });
      const client = createLLMClient(currentConfig.llm);
      await chatCompletion(client, currentConfig.llm.model, [{ role: "user", content: "ping" }], { maxTokens: 5 });
      checks.llmConnected = true;
    } catch { /* ignore */ }

    return c.json(checks);
  });

  return app;
}
