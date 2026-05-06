/**
 * Storage routes — mounted only in standalone mode.
 * ~30 endpoints: books CRUD, chapters, truth files, genres, project config,
 * exports, analytics, logs, doctor, fanfic read.
 */

import { Hono } from "hono";
import { readFile, readdir, access, stat, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  PipelineRunner,
  applyJingweiTemplate,
  computeAnalytics,
  createBookRepository,
  createStoryJingweiSectionRepository,
  getPreset,
  getStorageDatabase,
  registerBuiltinPresets,
  loadProjectConfig,
  type BookConfig,
  type JingweiTemplateSelection,
  type Preset,
} from "@vivy1024/novelfork-core";
import { ApiError, isMissingFileError } from "../errors.js";
import {
  buildDefaultBookSessionTitle,
  buildStudioBookConfig,
  buildStudioProjectInitRecord,
  type StudioBookConfigDraft,
  type StudioCreateBookBody,
  type StudioProjectInitRecord,
} from "../book-create.js";
import {
  persistStudioProjectInitRecord,
  prepareStudioBookProjectBootstrap,
  resolveStudioProjectRepositoryRoot,
  type PreparedStudioProjectBootstrap,
} from "../lib/project-bootstrap.js";
import { createBooksReadService } from "../lib/books-service.js";
import { createCandidateToolService } from "../lib/candidate-tool-service.js";
import { createCockpitService } from "../lib/cockpit-service.js";
import { createLlmRuntimeService } from "../lib/llm-runtime-service.js";
import { createNarrativeLineService } from "../lib/narrative-line-service.js";
import { createResourceCheckpointService } from "../lib/resource-checkpoint-service.js";
import { createResourceRewindService } from "../lib/resource-rewind-service.js";
import { createStorageDestructiveService } from "../lib/storage-destructive-service.js";
import { createStorageWriteService } from "../lib/storage-write-service.js";
import { createStoryFileReadService } from "../lib/story-file-service.js";
import { configureSessionToolExecutor, getSessionChatSnapshot } from "../lib/session-chat-service.js";
import { createSession } from "../lib/session-service.js";
import type { RouterContext } from "./context.js";

interface ProjectWorktreeOwnership {
  readonly repositoryRoot: string;
  readonly worktreeName: string;
}

interface BookCreateState {
  readonly status: "creating" | "error";
  readonly error?: string;
  readonly ownership?: ProjectWorktreeOwnership;
}

const MODEL_CONFIG_MISSING_PATTERNS: ReadonlyArray<RegExp> = [
  /NOVELFORK_LLM_API_KEY/i,
  /API key.*not set/i,
  /missing.*api[_ -]?key/i,
  /后端写作运行时尚未配置/i,
];

function isModelConfigMissingError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return MODEL_CONFIG_MISSING_PATTERNS.some((pattern) => pattern.test(message));
}

function normalizeJingweiTemplateSelection(
  selection: StudioCreateBookBody["jingweiTemplate"],
  genre: string,
): JingweiTemplateSelection {
  switch (selection?.templateId) {
    case "blank":
    case "basic":
    case "enhanced":
      return { templateId: selection.templateId };
    case "genre-recommended":
      return {
        templateId: "genre-recommended",
        genre: selection.genre ?? genre,
        selectedSectionKeys: selection.selectedSectionKeys ?? [],
      };
    default:
      return { templateId: "basic" };
  }
}

function buildJingweiSectionsManifest(
  selection: StudioCreateBookBody["jingweiTemplate"],
  genre: string,
): string {
  const applied = applyJingweiTemplate(normalizeJingweiTemplateSelection(selection, genre));
  return JSON.stringify({
    templateId: applied.templateId,
    ...(applied.sourceGenre ? { sourceGenre: applied.sourceGenre } : {}),
    sections: applied.sections,
  }, null, 2);
}

function presetSummaryLines(presets: ReadonlyArray<Preset>): string {
  return presets.map((preset) => `- ${preset.name}（${preset.id}）：${preset.description}`).join("\n");
}

function presetPromptLines(presets: ReadonlyArray<Preset>): string {
  return presets.map((preset) => `## ${preset.name}\n\n${preset.promptInjection}`).join("\n\n");
}

function resolveEnabledPresets(bookConfig: Pick<StudioBookConfigDraft, "enabledPresetIds">): ReadonlyArray<Preset> {
  return (bookConfig.enabledPresetIds ?? [])
    .map((id) => getPreset(id))
    .filter((preset): preset is Preset => Boolean(preset));
}

function buildPresetStoryFiles(language: "zh" | "en" | undefined, presets: ReadonlyArray<Preset>): ReadonlyArray<{ readonly name: string; readonly content: string }> {
  const tones = presets.filter((preset) => preset.category === "tone");
  const settingBases = presets.filter((preset) => preset.category === "setting-base");
  const logicRisks = presets.filter((preset) => preset.category === "logic-risk");
  const antiAi = presets.filter((preset) => preset.category === "anti-ai");
  const literary = presets.filter((preset) => preset.category === "literary");
  const rulePresets = [...logicRisks, ...antiAi, ...literary];

  if (language === "en") {
    return [
      {
        name: "book_rules.md",
        content: rulePresets.length
          ? `---\nversion: "1.0"\n---\n\n# Book Rules\n\n## Enabled writing presets\n\n${presetSummaryLines(rulePresets)}\n\n${presetPromptLines(rulePresets)}\n`
          : "---\nversion: \"1.0\"\n---\n\n# Book Rules\n\nRecord writing rules and constraints here.\n",
      },
      {
        name: "style_guide.md",
        content: tones.length
          ? `# Style Guide\n\n## Enabled tone presets\n\n${presetSummaryLines(tones)}\n\n${presetPromptLines(tones)}\n`
          : "# Style Guide\n\n",
      },
      {
        name: "setting_guide.md",
        content: settingBases.length
          ? `# Setting Guide\n\n## Enabled setting bases\n\n${presetSummaryLines(settingBases)}\n\n${presetPromptLines(settingBases)}\n`
          : "# Setting Guide\n\n",
      },
    ];
  }

  return [
    {
      name: "book_rules.md",
      content: rulePresets.length
        ? `---\nversion: "1.0"\n---\n\n# 写作规则\n\n## 已启用写作预设\n\n${presetSummaryLines(rulePresets)}\n\n${presetPromptLines(rulePresets)}\n`
        : "---\nversion: \"1.0\"\n---\n\n# 写作规则\n\n在这里记录本书的写作约束、禁忌和统一口径。\n",
    },
    {
      name: "style_guide.md",
      content: tones.length
        ? `# 文风指南\n\n## 已启用文风预设\n\n${presetSummaryLines(tones)}\n\n${presetPromptLines(tones)}\n`
        : "# 文风指南\n\n",
    },
    {
      name: "setting_guide.md",
      content: settingBases.length
        ? `# 设定指南\n\n## 已启用时代/社会基底\n\n${presetSummaryLines(settingBases)}\n\n${presetPromptLines(settingBases)}\n`
        : "# 设定指南\n\n",
    },
  ];
}

function localStoryFiles(
  language?: "zh" | "en",
  presets: ReadonlyArray<Preset> = [],
): ReadonlyArray<{ readonly name: string; readonly content: string }> {
  const presetFiles = buildPresetStoryFiles(language, presets);
  const presetFileByName = new Map(presetFiles.map((file) => [file.name, file]));

  if (language === "en") {
    return [
      { name: "story_bible.md", content: "# Story Jingwei\n\nLocal book scaffold. Add characters, events, settings, chapter summaries, foreshadowing, iconic scenes, and core memories here.\n" },
      { name: "volume_outline.md", content: "# Volume Outline\n\nDraft the volume structure here.\n" },
      presetFileByName.get("book_rules.md")!,
      { name: "current_state.md", content: "# Current State\n\nNo chapters have been written yet.\n" },
      { name: "pending_hooks.md", content: "# Pending Hooks\n\nTrack unresolved hooks here.\n" },
      { name: "chapter_summaries.md", content: "# Chapter Summaries\n\n" },
      { name: "subplot_board.md", content: "# Subplot Board\n\n" },
      { name: "emotional_arcs.md", content: "# Emotional Arcs\n\n" },
      { name: "character_matrix.md", content: "# Character Matrix\n\n" },
      presetFileByName.get("style_guide.md")!,
      presetFileByName.get("setting_guide.md")!,
    ];
  }

  return [
    { name: "story_bible.md", content: "# 故事经纬\n\n本地书籍已创建。可以在这里维护人物、事件、设定、章节摘要、伏笔、名场面与核心记忆。\n" },
    { name: "volume_outline.md", content: "# 分卷大纲\n\n在这里整理分卷与主线推进。\n" },
    presetFileByName.get("book_rules.md")!,
    { name: "current_state.md", content: "# 当前状态\n\n尚未写入章节。\n" },
    { name: "pending_hooks.md", content: "# 待处理伏笔\n\n在这里记录尚未回收的伏笔。\n" },
    { name: "chapter_summaries.md", content: "# 章节摘要\n\n" },
    { name: "subplot_board.md", content: "# 支线看板\n\n" },
    { name: "emotional_arcs.md", content: "# 情绪弧线\n\n" },
    { name: "character_matrix.md", content: "# 人物矩阵\n\n" },
    presetFileByName.get("style_guide.md")!,
    presetFileByName.get("setting_guide.md")!,
  ];
}

async function syncLocalBookScaffoldToSqlite(
  bookConfig: Pick<BookConfig, "id" | "title" | "genre" | "createdAt" | "updatedAt">,
  jingweiTemplate?: StudioCreateBookBody["jingweiTemplate"],
): Promise<void> {
  const storage = getStorageDatabase();
  const timestamp = new Date(bookConfig.createdAt);
  const updatedAt = new Date(bookConfig.updatedAt);
  const bookRepo = createBookRepository(storage);
  const existingBook = await bookRepo.getById(bookConfig.id);
  if (existingBook) {
    await bookRepo.update(bookConfig.id, {
      name: bookConfig.title,
      bibleMode: "dynamic",
      currentChapter: 0,
      updatedAt,
    });
  } else {
    await bookRepo.create({
      id: bookConfig.id,
      name: bookConfig.title,
      bibleMode: "dynamic",
      currentChapter: 0,
      createdAt: timestamp,
      updatedAt,
    });
  }

  const appliedTemplate = applyJingweiTemplate(normalizeJingweiTemplateSelection(jingweiTemplate, bookConfig.genre));
  const sectionRepo = createStoryJingweiSectionRepository(storage);
  const existingSectionKeys = new Set((await sectionRepo.listByBook(bookConfig.id)).map((section) => section.key));
  for (const section of appliedTemplate.sections) {
    if (existingSectionKeys.has(section.key)) continue;
    await sectionRepo.create({
      id: crypto.randomUUID(),
      bookId: bookConfig.id,
      key: section.key,
      name: section.name,
      description: section.description,
      icon: null,
      order: section.order,
      enabled: section.enabled,
      showInSidebar: section.showInSidebar,
      participatesInAi: section.participatesInAi,
      defaultVisibility: section.defaultVisibility,
      fieldsJson: section.fieldsJson,
      builtinKind: section.builtinKind ?? null,
      sourceTemplate: section.sourceTemplate ?? appliedTemplate.templateId,
      createdAt: timestamp,
      updatedAt,
    });
    existingSectionKeys.add(section.key);
  }
}

async function writeLocalBookScaffold(
  state: RouterContext["state"],
  bookConfig: StudioBookConfigDraft,
  jingweiTemplate?: StudioCreateBookBody["jingweiTemplate"],
): Promise<void> {
  const bookDir = state.bookDir(bookConfig.id);
  const storyDir = join(bookDir, "story");
  const chaptersDir = join(bookDir, "chapters");

  await mkdir(storyDir, { recursive: true });
  await mkdir(chaptersDir, { recursive: true });
  await writeFile(join(bookDir, "book.json"), JSON.stringify(bookConfig, null, 2), "utf-8");
  await Promise.all(
    localStoryFiles(bookConfig.language, resolveEnabledPresets(bookConfig)).map((file) => writeFile(join(storyDir, file.name), file.content, "utf-8")),
  );
  await writeFile(join(storyDir, "jingwei_sections.json"), buildJingweiSectionsManifest(jingweiTemplate, bookConfig.genre), "utf-8");
  await writeFile(join(chaptersDir, "index.json"), JSON.stringify([], null, 2), "utf-8");
  await syncLocalBookScaffoldToSqlite(bookConfig, jingweiTemplate);
}

function normalizeOwnershipPath(targetPath: string): string {
  return resolve(targetPath).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function resolveProjectWorktreeOwnership(
  record: Pick<StudioProjectInitRecord, "repositorySource" | "repositoryPath" | "cloneUrl" | "worktreeName" | "bootstrap">,
  studioRoot: string,
): ProjectWorktreeOwnership | null {
  if (!record.worktreeName) {
    return null;
  }

  if (record.bootstrap?.repositoryRoot) {
    return {
      repositoryRoot: record.bootstrap.repositoryRoot,
      worktreeName: record.worktreeName,
    };
  }

  return {
    repositoryRoot: resolveStudioProjectRepositoryRoot(record, studioRoot),
    worktreeName: record.worktreeName,
  };
}

function hasSameOwnership(left: ProjectWorktreeOwnership, right: ProjectWorktreeOwnership): boolean {
  return left.worktreeName === right.worktreeName
    && normalizeOwnershipPath(left.repositoryRoot) === normalizeOwnershipPath(right.repositoryRoot);
}

async function findConflictingBookOwner(
  studioRoot: string,
  requestedBookId: string,
  requestedOwnership: ProjectWorktreeOwnership | null,
  bookCreateStatus: Map<string, BookCreateState>,
): Promise<string | null> {
  if (!requestedOwnership) {
    return null;
  }

  for (const [bookId, status] of bookCreateStatus.entries()) {
    if (
      bookId !== requestedBookId
      && status.status === "creating"
      && status.ownership
      && hasSameOwnership(status.ownership, requestedOwnership)
    ) {
      return bookId;
    }
  }

  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(join(studioRoot, "books"), { withFileTypes: true });
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === requestedBookId) {
      continue;
    }

    try {
      const raw = await readFile(join(studioRoot, "books", entry.name, ".novelfork-project-init.json"), "utf-8");
      const record = JSON.parse(raw) as StudioProjectInitRecord;
      const existingOwnership = resolveProjectWorktreeOwnership(record, studioRoot);
      if (existingOwnership && hasSameOwnership(existingOwnership, requestedOwnership)) {
        return entry.name;
      }
    } catch (error) {
      if (isMissingFileError(error)) {
        continue;
      }
      throw error;
    }
  }

  return null;
}

export function createStorageRouter(ctx: RouterContext): Hono {
  const app = new Hono();
  const { state, root, broadcast } = ctx;
  const booksReadService = createBooksReadService({
    state,
    syncBookScaffold: (bookConfig) => syncLocalBookScaffoldToSqlite(bookConfig as Pick<BookConfig, "id" | "title" | "genre" | "createdAt" | "updatedAt">),
  });
  const storyFileReadService = createStoryFileReadService({ resolveBookDir: state.bookDir.bind(state) });
  const resourceCheckpointService = createResourceCheckpointService({ bookDir: state.bookDir.bind(state) });
  const resourceRewindService = createResourceRewindService({ bookDir: state.bookDir.bind(state) });
  const storageWriteService = createStorageWriteService({ state, checkpoint: resourceCheckpointService });
  const storageDestructiveService = createStorageDestructiveService({
    state,
    deleteBookRecord: (bookId) => getStorageDatabase().sqlite.prepare(`DELETE FROM "book" WHERE "id" = ?`).run(bookId),
  });
  const cockpitService = createCockpitService({ state, providerStore: ctx.providerStore });
  const candidateService = createCandidateToolService({ root, runtimeService: createLlmRuntimeService(ctx.providerStore ? { store: ctx.providerStore } : {}) });
  const narrativeService = createNarrativeLineService({ state, checkpoint: resourceCheckpointService });
  configureSessionToolExecutor({ cockpitService, candidateService, narrativeService });

  // Note: bookId validation middleware is registered globally in server.ts

  // In-memory book creation status tracking
  const bookCreateStatus = new Map<string, BookCreateState>();

  // --- Books ---

  app.get("/api/books", async (c) => {
    return c.json(await booksReadService.listBooks());
  });

  app.get("/api/books/:id", async (c) => {
    const id = c.req.param("id");
    try {
      return c.json(await booksReadService.getBookDetail(id));
    } catch {
      return c.json({ error: `Book "${id}" not found` }, 404);
    }
  });

  app.post("/api/books/create", async (c) => {
    const body = await c.req.json<StudioCreateBookBody>();

    registerBuiltinPresets();

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

    if (bookCreateStatus.get(bookId)?.status === "creating") {
      return c.json({ error: `Book "${bookId}" is already being created` }, 409);
    }

    const requestedOwnership = body.projectInit
      ? resolveProjectWorktreeOwnership(buildStudioProjectInitRecord(body, now), root)
      : null;
    const conflictingOwnerBookId = await findConflictingBookOwner(root, bookId, requestedOwnership, bookCreateStatus);
    if (conflictingOwnerBookId) {
      throw new ApiError(
        409,
        "PROJECT_BOOTSTRAP_WORKTREE_CONFLICT",
        `Worktree "${requestedOwnership?.worktreeName}" is already owned by book "${conflictingOwnerBookId}" in repository "${requestedOwnership?.repositoryRoot}".`,
      );
    }

    broadcast("book:creating", { bookId, title: body.title });
    bookCreateStatus.set(bookId, { status: "creating", ...(requestedOwnership ? { ownership: requestedOwnership } : {}) });

    let preparedProjectBootstrap: PreparedStudioProjectBootstrap | undefined;
    try {
      preparedProjectBootstrap = await prepareStudioBookProjectBootstrap(body, now, { root });
      if (preparedProjectBootstrap) {
        await persistStudioProjectInitRecord(bookDir, preparedProjectBootstrap.projectInitRecord);
      }

      const defaultSession = await createSession({
        title: buildDefaultBookSessionTitle(body.title, body.language),
        agentId: "writer",
        sessionMode: "chat",
        projectId: bookId,
        worktree: preparedProjectBootstrap?.projectInitRecord.worktreeName ?? body.projectInit?.worktreeName,
        sessionConfig: {
          permissionMode: "edit",
        },
      });
      const defaultSessionSnapshot = await getSessionChatSnapshot(defaultSession.id);
      if (!defaultSessionSnapshot) {
        throw new ApiError(500, "BOOK_CREATE_DEFAULT_SESSION_SNAPSHOT_FAILED", "Default writing session snapshot was not ready.");
      }

      const scaffoldLocalBook = async (cause: unknown): Promise<void> => {
        const error = cause instanceof Error ? cause.message : String(cause);
        await writeLocalBookScaffold(state, bookConfig, body.jingweiTemplate);
        bookCreateStatus.delete(bookId);
        broadcast("book:created", { bookId, aiInitializationSkipped: true, reason: "model-not-configured", error });
      };

      try {
        const sessionLlm = await ctx.getSessionLlm(c);
        const pipeline = new PipelineRunner(await ctx.buildPipelineConfig(sessionLlm));
        const runtimeBookConfig: BookConfig = {
          ...bookConfig,
          ...(bookConfig.enabledPresetIds ? { enabledPresetIds: [...bookConfig.enabledPresetIds] } : {}),
        };
        pipeline.initBook(runtimeBookConfig).then(
          async () => {
            bookCreateStatus.delete(bookId);
            broadcast("book:created", { bookId });
          },
          (e) => {
            if (isModelConfigMissingError(e)) {
              void scaffoldLocalBook(e).catch((scaffoldError) => {
                const error = scaffoldError instanceof Error ? scaffoldError.message : String(scaffoldError);
                bookCreateStatus.set(bookId, { status: "error", error });
                broadcast("book:error", { bookId, error });
              });
              return;
            }

            const error = e instanceof Error ? e.message : String(e);
            bookCreateStatus.set(bookId, { status: "error", error });
            broadcast("book:error", { bookId, error });
          },
        );
      } catch (error) {
        if (!isModelConfigMissingError(error)) {
          throw error;
        }
        await scaffoldLocalBook(error);
      }

      return c.json({ status: "creating", bookId, defaultSession, defaultSessionSnapshot });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      bookCreateStatus.set(bookId, { status: "error", error: message });
      broadcast("book:error", { bookId, error: message });
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError(500, "BOOK_CREATE_BOOTSTRAP_FAILED", message);
    }
  });

  app.get("/api/books/:id/create-status", async (c) => {
    const id = c.req.param("id");
    const status = bookCreateStatus.get(id);
    if (!status) {
      return c.json({ status: "missing" }, 404);
    }
    return c.json(status);
  });

  app.get("/api/books/:id/cockpit/snapshot", async (c) => {
    const id = c.req.param("id");
    const snapshot = await cockpitService.getSnapshot({
      bookId: id,
      includeModelStatus: c.req.query("includeModelStatus") !== "false",
    });
    return c.json(snapshot, snapshot.status === "missing" ? 404 : 200);
  });

  app.get("/api/books/:id/cockpit/open-hooks", async (c) => {
    const id = c.req.param("id");
    const result = await cockpitService.listOpenHooks({ bookId: id, limit: Number(c.req.query("limit")) });
    return c.json(result, result.status === "missing" ? 404 : 200);
  });

  app.get("/api/books/:id/cockpit/recent-candidates", async (c) => {
    const id = c.req.param("id");
    const result = await cockpitService.listRecentCandidates({ bookId: id, limit: Number(c.req.query("limit")) });
    return c.json(result, result.status === "missing" ? 404 : 200);
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
      return c.json(await storageWriteService.updateBook(id, updates));
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.delete("/api/books/:id", async (c) => {
    const id = c.req.param("id");
    try {
      const result = await storageDestructiveService.deleteBook(id);
      broadcast("book:deleted", { bookId: id });
      return c.json({ ok: result.ok, bookId: result.bookId });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Chapters ---

  app.post("/api/books/:id/chapters", async (c) => {
    const id = c.req.param("id");
    try {
      const body: { title?: string; afterChapterNumber?: number } = await c.req.json<{ title?: string; afterChapterNumber?: number }>().catch(() => ({}));
      return c.json(await storageWriteService.createChapter(id, body), 201);
    } catch (error) {
      if (isMissingFileError(error)) {
        return c.json({ error: `Book "${id}" not found` }, 404);
      }
      return c.json({ error: String(error) }, 500);
    }
  });

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
    const { content, sessionId, messageId, toolUseId } = await c.req.json<{ content: string; sessionId?: string; messageId?: string; toolUseId?: string }>();

    try {
      const result = await storageWriteService.updateChapterContent(id, num, content, { sessionId, messageId, toolUseId });
      if ("error" in result) return c.json({ error: result.error }, 404);
      return c.json(result);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.delete("/api/books/:id/chapters/:num", async (c) => {
    const id = c.req.param("id");
    const num = parseInt(c.req.param("num"), 10);

    try {
      const result = await storageDestructiveService.deleteChapter(id, num);
      if ("error" in result) return c.json({ error: result.error }, 404);
      return c.json({ ok: result.ok, chapterNumber: result.chapterNumber });
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
    const result = await storyFileReadService.readTruthFile(id, file);
    if ("error" in result) {
      return c.json({ error: result.error }, 400);
    }
    return c.json(result);
  });

  app.get("/api/books/:id/truth-files/:file", async (c) => {
    const id = c.req.param("id");
    const file = c.req.param("file");
    const result = await storyFileReadService.readTruthFile(id, file);
    if ("error" in result) {
      return c.json({ error: result.error }, 400);
    }
    return c.json(result);
  });

  app.put("/api/books/:id/truth/:file", async (c) => {
    const id = c.req.param("id");
    const file = c.req.param("file");
    const { content, sessionId, messageId, toolUseId } = await c.req.json<{ content: string; sessionId?: string; messageId?: string; toolUseId?: string }>();
    const result = await storageWriteService.writeTruthFile(id, file, content, { sessionId, messageId, toolUseId });
    if ("error" in result) {
      return c.json({ error: result.error }, 400);
    }
    return c.json(result);
  });

  app.delete("/api/books/:id/truth-files/:file", async (c) => {
    const id = c.req.param("id");
    const file = c.req.param("file");
    try {
      const result = await storageDestructiveService.deleteStoryFile(id, file);
      if ("error" in result) return c.json({ error: result.error }, 400);
      return c.json({ ok: result.ok, file: result.file });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.delete("/api/books/:id/story-files/:file", async (c) => {
    const id = c.req.param("id");
    const file = c.req.param("file");
    try {
      const result = await storageDestructiveService.deleteStoryFile(id, file);
      if ("error" in result) return c.json({ error: result.error }, 400);
      return c.json({ ok: result.ok, file: result.file });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.get("/api/books/:id/truth", async (c) => {
    const id = c.req.param("id");
    return c.json(await storyFileReadService.listTruthFiles(id));
  });

  app.get("/api/books/:id/truth-files", async (c) => {
    const id = c.req.param("id");
    return c.json(await storyFileReadService.listTruthFiles(id));
  });

  app.get("/api/books/:id/story-files", async (c) => {
    const id = c.req.param("id");
    return c.json(await storyFileReadService.listStoryFiles(id));
  });

  app.get("/api/books/:id/story-files/:file", async (c) => {
    const id = c.req.param("id");
    const file = c.req.param("file");
    const result = await storyFileReadService.readStoryFile(id, file);
    if ("error" in result) {
      return c.json({ error: result.error }, 400);
    }
    return c.json(result);
  });

  // --- Checkpoint Rewind ---

  app.get("/api/books/:id/checkpoints/:checkpointId/rewind/preview", async (c) => {
    const id = c.req.param("id");
    const checkpointId = c.req.param("checkpointId");
    const result = await resourceRewindService.previewRewind({ bookId: id, checkpointId });
    return c.json(result, result.ok ? 200 : 404);
  });

  app.post("/api/books/:id/checkpoints/:checkpointId/rewind/apply", async (c) => {
    const id = c.req.param("id");
    const checkpointId = c.req.param("checkpointId");
    const body = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}));
    const expectedCurrentHashes = typeof body.expectedCurrentHashes === "object" && body.expectedCurrentHashes !== null
      ? Object.fromEntries(Object.entries(body.expectedCurrentHashes as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
      : undefined;
    const confirmationDecision = typeof body.confirmationDecision === "object" && body.confirmationDecision !== null ? body.confirmationDecision as never : undefined;
    const result = await resourceRewindService.applyRewind({
      bookId: id,
      checkpointId,
      ...(expectedCurrentHashes ? { expectedCurrentHashes } : {}),
      ...(confirmationDecision ? { confirmationDecision } : {}),
    });
    const status = result.ok
      ? result.status === "pending-confirmation" ? 202 : 200
      : result.error === "checkpoint-not-found" ? 404 : 409;
    return c.json(result, status);
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

  app.post("/api/books/:id/export", async (c) => {
    const id = c.req.param("id");
    const body: { format?: unknown; approvedOnly?: boolean } = await c.req.json<{ format?: unknown; approvedOnly?: boolean }>().catch(() => ({}));
    try {
      const result = await storageWriteService.buildExport(id, body);
      if ("error" in result) return c.json({ error: result.error }, 400);
      return c.json(result);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

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
    const logPath = join(root, "novelfork.log");
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
