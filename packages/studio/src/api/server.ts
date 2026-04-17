import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import {
  StateManager,
  createLLMClient,
  createLogger,
  loadProjectConfig,
  pipelineEvents,
  type PipelineConfig,
  type ProjectConfig,
  type LogSink,
  type LogEntry,
} from "@actalk/inkos-core";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isSafeBookId } from "./safety.js";
import { ApiError } from "./errors.js";
import { readSessionFromCookie } from "./auth.js";
import { RunStore } from "./lib/run-store.js";
import {
  createRunsRouter,
  createAuthRouter,
  createStorageRouter,
  createSnapshotsRouter,
  createAIRouter,
  createAIRelayRouter,
  createDaemonRouter,
  createMCPRouter,
  createPipelineRouter,
  createWorkbenchRouter,
  createLorebookRouter,
  createSettingsRouter,
  createProvidersRouter,
  createAgentConfigRouter,
  createToolsRouter,
  createWorktreeRouter,
  createPoisonDetectorRouter,
  createRhythmRouter,
  createHooksCountdownRouter,
  createGoldenChaptersRouter,
  createChatRouter,
  createContextManagerRouter,
  createAdminRouter,
  createRoutinesRouter,
} from "./routes/index.js";
import type { RouterContext } from "./routes/index.js";
import type { Context } from "hono";

// --- Event bus for SSE (legacy, Phase 2 replaces with per-run) ---

type EventHandler = (event: string, data: unknown) => void;
const globalSubscribers = new Set<EventHandler>();

function broadcast(event: string, data: unknown): void {
  for (const handler of globalSubscribers) {
    handler(event, data);
  }
}

// Bridge core pipeline events → SSE
pipelineEvents.on((event) => {
  switch (event.type) {
    case "run:start":
      broadcast("pipeline:start", event.data);
      break;
    case "stage:update":
      broadcast("pipeline:stage", event.data);
      break;
    case "run:complete":
      broadcast("pipeline:complete", event.data);
      break;
  }
});

// --- INKOS_MODE ---

export type InkosMode = "standalone" | "relay";

function getInkosMode(): InkosMode {
  const raw = process.env.INKOS_MODE?.trim().toLowerCase();
  if (raw === "relay") return "relay";
  return "standalone";
}

// --- Server factory ---

export function createStudioServer(initialConfig: ProjectConfig, root: string) {
  const app = new Hono();
  const state = new StateManager(root);
  const runStore = new RunStore();
  const mode = getInkosMode();
  let cachedConfig = initialConfig;

  app.use("/*", cors());

  // Structured error handler
  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return c.json({ error: { code: error.code, message: error.message } }, error.status as 400);
    }
    return c.json(
      { error: { code: "INTERNAL_ERROR", message: "Unexpected server error." } },
      500,
    );
  });

  // BookId validation middleware — global (ai.ts also has /api/books/:id/* routes)
  app.use("/api/books/:id/*", async (c, next) => {
    const bookId = c.req.param("id");
    if (!isSafeBookId(bookId)) {
      throw new ApiError(400, "INVALID_BOOK_ID", `Invalid book ID: "${bookId}"`);
    }
    await next();
  });
  app.use("/api/books/:id", async (c, next) => {
    const bookId = c.req.param("id");
    if (!isSafeBookId(bookId)) {
      throw new ApiError(400, "INVALID_BOOK_ID", `Invalid book ID: "${bookId}"`);
    }
    await next();
  });

  // Logger sink that broadcasts to SSE
  const sseSink: LogSink = {
    write(entry: LogEntry): void {
      broadcast("log", { level: entry.level, tag: entry.tag, message: entry.message });
    },
  };

  async function loadCurrentProjectConfig(
    options?: { readonly requireApiKey?: boolean },
  ): Promise<ProjectConfig> {
    const freshConfig = await loadProjectConfig(root, options);
    cachedConfig = freshConfig;
    return freshConfig;
  }

  async function getSessionLlm(c: Context): Promise<{ apiKey: string; baseUrl: string; model?: string; provider?: string } | undefined> {
    try {
      const session = await readSessionFromCookie(c);
      if (!session?.llmApiKey) return undefined;
      return {
        apiKey: session.llmApiKey,
        baseUrl: session.llmBaseUrl ?? "",
        model: session.llmModel,
        provider: session.llmProvider,
      };
    } catch {
      // SESSION_SECRET not configured — standalone mode, no session
      return undefined;
    }
  }

  async function buildPipelineConfig(
    overrides?: Partial<Pick<PipelineConfig, "externalContext">> & { apiKey?: string; baseUrl?: string; model?: string; provider?: string },
  ): Promise<PipelineConfig> {
    const hasSessionLlm = Boolean(overrides?.apiKey);
    const currentConfig = await loadCurrentProjectConfig({ requireApiKey: !hasSessionLlm });
    const llm = hasSessionLlm
      ? {
          ...currentConfig.llm,
          apiKey: overrides!.apiKey!,
          baseUrl: overrides!.baseUrl || currentConfig.llm.baseUrl,
          ...(overrides!.model ? { model: overrides!.model } : {}),
          ...(overrides!.provider ? { provider: overrides!.provider as typeof currentConfig.llm.provider } : {}),
        }
      : currentConfig.llm;
    const logger = createLogger({ tag: "studio", sinks: [sseSink] });
    return {
      client: createLLMClient(llm),
      model: llm.model,
      projectRoot: root,
      defaultLLMConfig: llm,
      modelOverrides: currentConfig.modelOverrides,
      notifyChannels: currentConfig.notify,
      logger,
      onStreamProgress: (progress) => {
        if (progress.status === "streaming") {
          broadcast("llm:progress", {
            elapsedMs: progress.elapsedMs,
            totalChars: progress.totalChars,
            chineseChars: progress.chineseChars,
          });
        }
      },
      externalContext: overrides?.externalContext,
    };
  }

  // --- Shared router context ---
  const ctx: RouterContext = {
    state,
    root,
    broadcast,
    buildPipelineConfig,
    getSessionLlm,
    runStore,
  };

  // --- Route mounting by mode ---

  // Auth — all modes
  app.route("", createAuthRouter());

  // Per-run SSE + management — all modes
  app.route("", createRunsRouter(runStore));

  if (mode === "standalone") {
    // Workbench routes — sandboxed file operations for IDE layout
    const workbenchToken = process.env.INKOS_WORKBENCH_TOKEN;
    app.route("", createWorkbenchRouter(root, workbenchToken));

    // AI operations + legacy SSE — standalone uses book-id based routes
    app.route("", createAIRouter(ctx));

    // Storage routes (books CRUD, chapters, truth, genres, config, export, logs, doctor)
    app.route("", createStorageRouter(ctx));

    // Snapshots routes (chapter version control)
    app.route("", createSnapshotsRouter(ctx));

    // Daemon scheduler
    app.route("", createDaemonRouter(ctx));

    // MCP Server management
    app.route("", createMCPRouter(root));

    // Lorebook / World Info
    app.route("", createLorebookRouter(root));

    // Pipeline visualization
    app.route("/api/pipeline", createPipelineRouter(ctx));

    // Settings management
    app.route("/api/settings", createSettingsRouter());

    // AI Providers management
    app.route("/api/providers", createProvidersRouter());

    // Agent configuration
    app.route("/api/agent/config", createAgentConfigRouter());

    // Tools API
    app.route("/api/tools", createToolsRouter());

    // Worktree management
    app.route("/api/worktree", createWorktreeRouter());

    // Poison detector
    app.route("", createPoisonDetectorRouter(ctx));

    // Rhythm analysis
    app.route("", createRhythmRouter(ctx));

    // Hooks countdown
    app.route("/api/hooks", createHooksCountdownRouter(ctx));

    // Golden chapters analysis
    app.route("", createGoldenChaptersRouter(ctx));

    // Chat interface
    app.route("", createChatRouter(ctx));

    // Context manager
    app.route("", createContextManagerRouter(ctx));

    // Admin panel
    app.route("/api/admin", createAdminRouter());

    // Routines system
    app.route("/api/routines", createRoutinesRouter());
  } else {
    // Relay mode — snapshot-based AI endpoints only
    app.route("", createAIRelayRouter(ctx));
  }

  return app;
}

// --- Standalone runner ---

export async function startStudioServer(
  root: string,
  port = 4567,
  options?: { readonly staticDir?: string },
): Promise<void> {
  // Auto-init project directory if inkos.json doesn't exist (Zeabur / Docker deployment)
  const { existsSync: existsSyncInit } = await import("node:fs");
  const { mkdir: mkdirInit, writeFile: writeFileInit } = await import("node:fs/promises");
  const configPathInit = join(root, "inkos.json");
  if (!existsSyncInit(configPathInit)) {
    console.log(`inkos.json not found in ${root}, auto-initializing...`);
    await mkdirInit(root, { recursive: true });
    await mkdirInit(join(root, "books"), { recursive: true });
    const defaultConfig = {
      name: "inkos-studio",
      version: "0.1.0",
      language: process.env.INKOS_DEFAULT_LANGUAGE ?? "zh",
      llm: {
        provider: process.env.INKOS_LLM_PROVIDER ?? "openai",
        baseUrl: process.env.INKOS_LLM_BASE_URL ?? "",
        model: process.env.INKOS_LLM_MODEL ?? "gpt-4o",
      },
      notify: [],
      daemon: {
        schedule: { radarCron: "0 */6 * * *", writeCron: "*/15 * * * *" },
        maxConcurrentBooks: 3,
      },
    };
    await writeFileInit(configPathInit, JSON.stringify(defaultConfig, null, 2), "utf-8");
    console.log("Auto-initialized project at", root);
  }

  // Multi-user mode: don't require global API key at startup.
  const config = await loadProjectConfig(root, { requireApiKey: false });

  const mode = getInkosMode();
  console.log(`InkOS mode: ${mode}`);

  const app = createStudioServer(config, root);

  // Serve frontend static files — single process for API + frontend
  if (options?.staticDir) {
    const { readFile: readFileFs } = await import("node:fs/promises");
    const { join: joinPath } = await import("node:path");
    const { existsSync } = await import("node:fs");

    // Serve static assets (js, css, etc.)
    app.get("/assets/*", async (c) => {
      const filePath = joinPath(options.staticDir!, c.req.path);
      try {
        const content = await readFileFs(filePath);
        const ext = filePath.split(".").pop() ?? "";
        const contentTypes: Record<string, string> = {
          js: "application/javascript",
          css: "text/css",
          svg: "image/svg+xml",
          png: "image/png",
          ico: "image/x-icon",
          json: "application/json",
        };
        return new Response(content, {
          headers: { "Content-Type": contentTypes[ext] ?? "application/octet-stream" },
        });
      } catch {
        return c.notFound();
      }
    });

    // SPA fallback
    const indexPath = joinPath(options.staticDir!, "index.html");
    if (existsSync(indexPath)) {
      const indexHtml = await readFileFs(indexPath, "utf-8");
      app.get("*", (c) => {
        if (c.req.path.startsWith("/api/")) return c.notFound();
        return c.html(indexHtml);
      });
    }
  }

  console.log(`InkOS Studio running on http://localhost:${port}`);

  // Create HTTP server for WebSocket support
  const server = createServer();
  setupAdminWebSocket(server);

  // Use @hono/node-server with custom server
  serve({ fetch: app.fetch, port, createServer: () => server });
}
