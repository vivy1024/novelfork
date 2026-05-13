/**
 * Storage routes — mounted only in standalone mode.
 * ~30 endpoints: books CRUD, chapters, jingwei files, genres, project config,
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
import { registerPluginTools, registerPluginAgentPresets } from "../lib/session-tool-registry.js";
import { NOVEL_SESSION_TOOL_DEFINITIONS, NOVEL_AGENT_PRESETS } from "../lib/session-tool-registry-novel.js";
import { createSession, listSessions, deleteSession } from "../lib/session-service.js";
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
      jingweiMode: "dynamic",
      currentChapter: 0,
      updatedAt,
    });
  } else {
    await bookRepo.create({
      id: bookConfig.id,
      name: bookConfig.title,
      jingweiMode: "dynamic",
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

  // 动态注册小说插件工具与 Agent 预设
  registerPluginTools(NOVEL_SESSION_TOOL_DEFINITIONS);
  registerPluginAgentPresets(NOVEL_AGENT_PRESETS);

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
      // 文件存在，但检查数据库中是否也存在（可能是删除书后文件残留）
      const existingBook = await state.loadBookConfig(bookId).catch(() => null);
      if (existingBook) {
        return c.json({ error: `Book "${bookId}" already exists` }, 409);
      }
      // 文件残留但数据库中已删除 → 允许重新创建（覆盖旧文件）
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

      // Create 5 fixed Agent sessions bound to this book
      // 先检查是否已有该 bookId 的 sessions（防止重复创建导致重复 agent 会话）
      const BOOK_AGENTS = [
        { agentId: "writer", title: `📝 写书 — ${body.title}`, sessionMode: "chat" as const },
        { agentId: "hooks", title: `🎣 伏笔 — ${body.title}`, sessionMode: "chat" as const },
        { agentId: "chapter-hooks", title: `🪝 章末钩子 — ${body.title}`, sessionMode: "chat" as const },
        { agentId: "auditor", title: `🔍 审校 — ${body.title}`, sessionMode: "chat" as const },
        { agentId: "outline", title: `📋 大纲与经纬 — ${body.title}`, sessionMode: "chat" as const },
      ];

      // Resolve the actual working directory for Agent sessions
      // 始终使用仓库根目录作为工作目录，让 AI 能访问整个项目
      // worktree 子目录仅用于子代理隔离场景（由 EnterWorktree 工具管理）
      const sessionWorktree = body.projectInit?.repositorySource === "existing" && body.projectInit?.repositoryPath
        ? body.projectInit.repositoryPath
        : preparedProjectBootstrap?.bootstrap.repositoryRoot
          ?? preparedProjectBootstrap?.bootstrap.worktreePath
          ?? undefined;

      // 检查是否已有该 book 的 agent sessions（防止重复创建时产生重复会话）
      const existingSessions = await listSessions({ projectId: bookId });
      const existingAgentIds = new Set(existingSessions.map((s) => s.agentId).filter(Boolean));

      const agentsToCreate = BOOK_AGENTS.filter((agent) => !existingAgentIds.has(agent.agentId));

      const createdSessions = agentsToCreate.length > 0
        ? await Promise.all(
            agentsToCreate.map((agent) =>
              createSession({
                title: agent.title,
                agentId: agent.agentId,
                sessionMode: agent.sessionMode,
                projectId: bookId,
                worktree: sessionWorktree,
                sessionConfig: { permissionMode: "edit" },
              }),
            ),
          )
        : [];
      const defaultSession = createdSessions.find((s) => s.agentId === "writer")
        ?? existingSessions.find((s) => s.agentId === "writer")
        ?? createdSessions[0]
        ?? existingSessions[0];
      if (!defaultSession) {
        throw new ApiError(500, "BOOK_CREATE_NO_DEFAULT_SESSION", "No writer session available for book.");
      }
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

  // --- Guided Setup (新书引导式创作设定) ---

  app.post("/api/books/:id/guided-setup", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<{
      answers: Record<string, { mode: "preset" | "custom" | "random"; value: string }>;
    }>();

    try {
      const book = await state.loadBookConfig(id);
      const answers = body.answers;

      // 更新 book.json 中的基础字段
      const updates: Record<string, unknown> = {};
      if (answers.genre && answers.genre.mode !== "random") {
        updates.genre = answers.genre.value;
      }
      if (answers.platform && answers.platform.mode !== "random") {
        updates.platform = answers.platform.value;
      }
      if (answers.chapterWordCount && answers.chapterWordCount.mode !== "random") {
        const parsed = parseInt(answers.chapterWordCount.value, 10);
        if (!isNaN(parsed) && parsed > 0) updates.chapterWordCount = parsed;
      }

      if (Object.keys(updates).length > 0) {
        await storageWriteService.updateBook(id, updates as { chapterWordCount?: number; targetChapters?: number; status?: string; language?: string });
      }

      // 将故事设定写入经纬文件集
      const storyDir = join(state.bookDir(id), "story");

      // 确保 story 目录存在
      await mkdir(storyDir, { recursive: true });

      // 1. story_bible.md — 故事经纬
      const bibleLines: string[] = ["# 故事经纬\n"];
      const fieldLabels: Record<string, string> = {
        genre: "题材",
        premise: "核心前提",
        protagonist: "主角设定",
        goldenFinger: "金手指",
        worldModel: "世界观",
        powerSystem: "力量体系",
        tone: "基调与文风",
        writingPhilosophy: "创作方式",
        platform: "目标平台",
        aiTasteLevel: "AI 味容忍度",
      };

      for (const [field, label] of Object.entries(fieldLabels)) {
        const answer = answers[field];
        if (answer && answer.mode !== "random" && answer.value.trim()) {
          bibleLines.push(`## ${label}\n`);
          bibleLines.push(`${answer.value.trim()}\n`);
        } else {
          bibleLines.push(`## ${label}\n`);
          bibleLines.push(`*（待 AI 生成）*\n`);
        }
      }
      await writeFile(join(storyDir, "story_bible.md"), bibleLines.join("\n"), "utf-8");

      // 2. book_rules.md — 书籍规则（从题材和文风推导）
      const rulesLines: string[] = ["# 书籍规则\n"];
      const genre = answers.genre?.value ?? "通用";
      const tone = answers.tone?.value ?? "";
      const platform = answers.platform?.value ?? "";
      const aiTaste = answers.aiTasteLevel?.value ?? "中等";

      rulesLines.push("## 基本约束\n");
      rulesLines.push(`- 题材：${genre}\n`);
      if (tone) rulesLines.push(`- 文风基调：${tone}\n`);
      if (platform) rulesLines.push(`- 目标平台：${platform}\n`);
      rulesLines.push(`- AI 味容忍度：${aiTaste}\n`);
      rulesLines.push("\n## 写作规则\n");
      rulesLines.push("- 每章字数目标：" + (updates.chapterWordCount ?? 3000) + " 字\n");
      rulesLines.push("- 禁止连续 3 个 <40 字短段并列连排\n");
      rulesLines.push("- 伏笔兑现必须有 ≥60 字具体段落（advance/resolve）\n");
      rulesLines.push("- 对话不超过章节篇幅的 40%\n");
      rulesLines.push("\n## 连续性规则\n");
      rulesLines.push("- 角色名称前后一致\n");
      rulesLines.push("- 时间线不矛盾\n");
      rulesLines.push("- 已死角色不复活（除非有明确设定支持）\n");
      await writeFile(join(storyDir, "book_rules.md"), rulesLines.join("\n"), "utf-8");

      // 3. volume_outline.md — 卷大纲骨架（仅"建筑师派"）
      const writingPhilosophy = answers.writingPhilosophy?.value ?? "";
      if (writingPhilosophy !== "花园派") {
        const outlineLines: string[] = ["# 卷大纲\n"];
        outlineLines.push("## 第一卷\n");
        outlineLines.push("### 核心冲突\n");
        if (answers.premise?.value) {
          outlineLines.push(`${answers.premise.value.trim()}\n`);
        } else {
          outlineLines.push("*（待规划）*\n");
        }
        outlineLines.push("\n### 章节规划\n");
        outlineLines.push("- 第 1 章：开篇（引入主角、建立世界观）\n");
        outlineLines.push("- 第 2 章：日常（展示主角日常、埋下伏笔）\n");
        outlineLines.push("- 第 3 章：变故（打破日常的事件）\n");
        outlineLines.push("- 第 4-5 章：应对（主角面对变故的反应）\n");
        outlineLines.push("- 第 6-8 章：发展（主角成长、获得金手指/机遇）\n");
        outlineLines.push("- 第 9-10 章：第一卷高潮（首个大冲突解决）\n");
        outlineLines.push("\n### 主角弧线\n");
        if (answers.protagonist?.value) {
          outlineLines.push(`起点：${answers.protagonist.value.trim()}\n`);
        }
        outlineLines.push("终点：*（待规划）*\n");
        await writeFile(join(storyDir, "volume_outline.md"), outlineLines.join("\n"), "utf-8");
      }

      // 4. current_state.md — 初始状态
      const stateLines: string[] = ["# 当前状态\n"];
      stateLines.push("## 进度\n");
      stateLines.push("- 当前章节：第 0 章（尚未开始）\n");
      stateLines.push("- 当前卷：第一卷\n");
      stateLines.push("\n## 世界状态\n");
      if (answers.worldModel?.value) {
        stateLines.push(`${answers.worldModel.value.trim()}\n`);
      } else {
        stateLines.push("*（待第一章建立）*\n");
      }
      stateLines.push("\n## 角色状态\n");
      if (answers.protagonist?.value) {
        stateLines.push(`- 主角：${answers.protagonist.value.trim()}\n`);
      } else {
        stateLines.push("- 主角：*（待设定）*\n");
      }
      stateLines.push("\n## 活跃伏笔\n");
      stateLines.push("*（暂无）*\n");
      await writeFile(join(storyDir, "current_state.md"), stateLines.join("\n"), "utf-8");

      // 根据题材自动启用对应预设
      const GENRE_TO_PRESET: Record<string, string[]> = {
        "玄幻": ["xuanhuan-bloodline"],
        "仙侠": ["classical-travel-xianxia"],
        "都市": ["institutional-cultivation-satire"],
        "科幻": ["near-future-hard-scifi"],
        "末日": ["apocalypse-survival"],
        "穿越": ["transmigration-knowledge"],
        "重生": ["rebirth-revenge"],
        "系统流": ["system-flow-growth"],
        "无限流": ["infinite-flow-survival"],
        "悬疑": ["industrial-occult-mystery"],
        "武侠": ["wuxia-jianghu"],
        "官场": ["politics-career"],
        "游戏": ["game-esports"],
        "赘婿": ["son-in-law-reveal"],
        "克苏鲁": ["cthulhu-investigator"],
        "赛博朋克": ["cyberpunk-street"],
        "修真": ["cultivation-hardcore"],
        "灵异": ["supernatural-detective"],
        "种田": ["farming-development"],
        "军事": ["military-tactics"],
        "诡秘": ["occult-sequence"],
        "轻小说": ["light-novel-campus"],
        "体育": ["sports-competition"],
        "同人": ["fanfiction-crossover"],
        "历史": ["historical-governance"],
      };
      const setupGenre = answers.genre?.value ?? "";
      const presetIds = GENRE_TO_PRESET[setupGenre] ?? [];
      if (presetIds.length > 0) {
        await storageWriteService.updateBook(id, { enabledPresetIds: presetIds });
      }

      broadcast("book:updated", { bookId: id });

      // 异步调用 LLM 丰富经纬内容（不阻塞响应）
      void (async () => {
        try {
          const { loadUserConfig } = await import("../lib/user-config-service.js");
          const config = await loadUserConfig();
          const defaultModel = config.modelDefaults?.defaultSessionModel;
          if (!defaultModel) return; // 无模型配置，跳过 AI 生成

          const { generateSessionReply } = await import("../lib/llm-runtime-service.js");
          const [providerId, modelId] = defaultModel.includes(":") ? defaultModel.split(":") : ["", defaultModel];

          // 将向导答案格式化为 prompt
          const contextParts: string[] = [];
          for (const [field, label] of Object.entries(fieldLabels)) {
            const answer = answers[field];
            if (answer && answer.mode !== "random" && answer.value.trim()) {
              contextParts.push(`${label}：${answer.value.trim()}`);
            }
          }
          if (contextParts.length === 0) return; // 全部跳过，无需生成

          const userPrompt = `基于以下创作设定，生成一份详细的故事经纬（story_bible.md）。要求：
1. 扩展世界观细节（地理/历史/社会结构）
2. 丰富主角设定（性格/背景/动机/成长方向）
3. 设计 2-3 个重要配角（各有独立动机）
4. 明确力量体系的层级和规则
5. 提出 3-5 个初始伏笔种子

用户设定：
${contextParts.join("\n")}

请直接输出 Markdown 格式的故事经纬内容，用 ## 二级标题分区。`;

          const result = await generateSessionReply({
            sessionConfig: { providerId, modelId, permissionMode: "read", reasoningEffort: "low" },
            messages: [
              { type: "message", role: "system", content: "你是一个专业的网文世界观架构师。根据用户提供的创作方向，生成详细、具体、可直接用于写作的故事经纬。输出纯 Markdown，不要解释。" },
              { type: "message", role: "user", content: userPrompt },
            ],
            tools: [],
          });

          if (result.success && result.type === "message" && result.content?.trim()) {
            await writeFile(join(storyDir, "story_bible.md"), result.content.trim(), "utf-8");
            broadcast("book:updated", { bookId: id });
            console.log(JSON.stringify({ component: "guided-setup", event: "ai-enrich-complete", bookId: id }));
          }
        } catch (err) {
          console.log(JSON.stringify({ component: "guided-setup", event: "ai-enrich-failed", bookId: id, error: err instanceof Error ? err.message : String(err) }));
        }
      })();

      return c.json({ ok: true, bookId: id });
    } catch (e) {
      if (isMissingFileError(e)) {
        return c.json({ error: `Book "${id}" not found` }, 404);
      }
      return c.json({ error: String(e) }, 500);
    }
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
      // 级联删除书籍关联的 Agent session
      try {
        const bookSessions = await listSessions({ projectId: id });
        for (const session of bookSessions) {
          await deleteSession(session.id);
        }
      } catch { /* session cleanup failure is non-fatal */ }
      broadcast("book:deleted", { bookId: id });
      return c.json({ ok: result.ok, bookId: id });
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

  // --- Jingwei files ---

  app.get("/api/books/:id/truth/:file", async (c) => {
    const id = c.req.param("id");
    const file = c.req.param("file");
    const result = await storyFileReadService.readJingweiFile(id, file);
    if ("error" in result) {
      return c.json({ error: result.error }, 400);
    }
    return c.json(result);
  });

  app.get("/api/books/:id/jingwei-files/:file", async (c) => {
    const id = c.req.param("id");
    const file = c.req.param("file");
    const result = await storyFileReadService.readJingweiFile(id, file);
    if ("error" in result) {
      return c.json({ error: result.error }, 400);
    }
    return c.json(result);
  });

  app.put("/api/books/:id/truth/:file", async (c) => {
    const id = c.req.param("id");
    const file = c.req.param("file");
    const { content, sessionId, messageId, toolUseId } = await c.req.json<{ content: string; sessionId?: string; messageId?: string; toolUseId?: string }>();
    const result = await storageWriteService.writeJingweiFile(id, file, content, { sessionId, messageId, toolUseId });
    if ("error" in result) {
      return c.json({ error: result.error }, 400);
    }
    return c.json(result);
  });

  app.delete("/api/books/:id/jingwei-files/:file", async (c) => {
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
    return c.json(await storyFileReadService.listJingweiFiles(id));
  });

  app.get("/api/books/:id/jingwei-files", async (c) => {
    const id = c.req.param("id");
    return c.json(await storyFileReadService.listJingweiFiles(id));
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

  app.get("/api/books/:id/checkpoints", async (c) => {
    const id = c.req.param("id");
    const bookDir = state.bookDir(id);
    const indexPath = join(bookDir, ".novelfork", "checkpoints", "index.json");
    try {
      const raw = await readFile(indexPath, "utf-8");
      const checkpoints = JSON.parse(raw) as unknown[];
      return c.json({ checkpoints: Array.isArray(checkpoints) ? checkpoints : [] });
    } catch {
      return c.json({ checkpoints: [] });
    }
  });

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

      if (format === "docx") {
        const { generateDocx } = await import("../lib/docx-generator.js");
        const chapters = contents.map((content, i) => {
          const title = content.match(/^#\s+(.+)$/m)?.[1] ?? `第${i + 1}章`;
          return { title, content };
        });
        const docxBuf = generateDocx(chapters, book.title);
        return new Response(docxBuf.buffer as ArrayBuffer, {
          headers: {
            "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "Content-Disposition": `attachment; filename="${id}.docx"`,
          },
        });
      }
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

      if (fmt === "docx") {
        const { generateDocx } = await import("../lib/docx-generator.js");
        const docxChapters = contents.map((content, i) => {
          const title = content.match(/^#\s+(.+)$/m)?.[1] ?? `第${i + 1}章`;
          return { title, content };
        });
        const docxBuf = generateDocx(docxChapters, book.title);
        outputPath = join(bookDir, `${id}.docx`);
        await writeFileFs(outputPath, docxBuf);
        return c.json({ ok: true, path: outputPath, format: fmt, chapters: filteredFiles.length });
      }

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
