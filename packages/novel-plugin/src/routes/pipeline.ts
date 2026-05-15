import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { RouterContext } from "./context.js";
import { pipelineEvents } from "../engine/pipeline/pipeline-events.js";

interface PipelineStage {
  readonly name: string;
  readonly status: "waiting" | "running" | "completed" | "failed";
  readonly agent?: string;
  readonly model?: string;
  readonly startTime?: number;
  readonly endTime?: number;
  readonly tokenUsage?: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
  readonly toolCalls?: ReadonlyArray<{
    readonly name: string;
    readonly timestamp: number;
    readonly duration?: number;
    readonly result?: string;
  }>;
  readonly error?: string;
}

interface PipelineRun {
  readonly runId: string;
  readonly bookId: string;
  readonly bookTitle: string;
  readonly status: "running" | "completed" | "failed";
  readonly startTime: number;
  readonly endTime?: number;
  readonly stages: ReadonlyArray<PipelineStage>;
}

const PROCESS_MEMORY_PIPELINE_STATE = {
  persistence: "process-memory" as const,
  persistenceLabel: "当前进程临时运行状态",
  persistenceDescription: "Pipeline route 的 run/stage 状态保存在当前 Studio 服务进程中；服务刷新或重启后会丢失，正式持久化将接入 RunStore。",
};

const pipelineRuns = new Map<string, PipelineRun>();

function withPipelinePersistence<T extends object>(value: T): T & typeof PROCESS_MEMORY_PIPELINE_STATE {
  return { ...value, ...PROCESS_MEMORY_PIPELINE_STATE };
}

function withPipelineRunPersistence(run: PipelineRun) {
  return withPipelinePersistence({
    ...run,
    stages: run.stages.map((stage) => withPipelinePersistence(stage)),
  });
}

/** Resolve book directory — set when createPipelineRouter is called */
let resolveBookDir: ((bookId: string) => string) | null = null;

/** Persist a completed/failed run to disk so it survives restarts */
async function persistRunToDisk(run: PipelineRun): Promise<void> {
  if (!resolveBookDir) return;
  try {
    const bookDir = resolveBookDir(run.bookId);
    const dir = join(bookDir, ".novelfork");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "last-pipeline-run.json"), JSON.stringify(run, null, 2), "utf-8");
  } catch {
    // Non-fatal — persistence is best-effort
  }
}

/** Try to load a persisted run from disk */
async function loadPersistedRun(runId: string): Promise<PipelineRun | null> {
  if (!resolveBookDir) return null;
  // We don't know which book the runId belongs to, so we can't look it up by runId alone.
  // Instead, scan all runs in memory first (handled by caller).
  // This function is called with a known bookId context from the route.
  return null;
}

/** Try to load the last persisted run for a specific book */
async function loadLastRunForBook(bookDir: string): Promise<PipelineRun | null> {
  try {
    const raw = await readFile(join(bookDir, ".novelfork", "last-pipeline-run.json"), "utf-8");
    return JSON.parse(raw) as PipelineRun;
  } catch {
    return null;
  }
}

// Listen to pipeline events from core
pipelineEvents.on((event) => {
  if (event.type === "run:start") {
    createPipelineRun(event.data.runId, event.data.bookId, event.data.bookTitle);
  } else if (event.type === "stage:update") {
    updatePipelineStage(event.data.runId, event.data.stageName, event.data);
  } else if (event.type === "run:complete") {
    completePipelineRun(event.data.runId, event.data.status);
  }
});

export function createPipelineRouter(ctx: RouterContext): Hono {
  // Store the book directory resolver for persistence
  resolveBookDir = ctx.state.bookDir.bind(ctx.state);
  const app = new Hono();

  // Get pipeline run status
  app.get("/:runId/status", async (c) => {
    const runId = c.req.param("runId");
    const run = pipelineRuns.get(runId);

    if (!run) {
      // Try to find persisted run by scanning all books
      // The runId might match a persisted last-pipeline-run.json
      // For now, return 404 — the /book/:bookId/last-run endpoint handles disk fallback
      return c.json({ error: "Pipeline run not found", ...PROCESS_MEMORY_PIPELINE_STATE }, 404);
    }

    return c.json(withPipelineRunPersistence(run));
  });

  // Get last pipeline run for a specific book (with disk fallback)
  app.get("/book/:bookId/last-run", async (c) => {
    const bookId = c.req.param("bookId");

    // Check in-memory runs first
    for (const run of pipelineRuns.values()) {
      if (run.bookId === bookId) {
        return c.json(withPipelineRunPersistence(run));
      }
    }

    // Fall back to persisted file
    if (resolveBookDir) {
      try {
        const bookDir = resolveBookDir(bookId);
        const persisted = await loadLastRunForBook(bookDir);
        if (persisted) {
          return c.json(withPipelineRunPersistence(persisted));
        }
      } catch {
        // Book dir doesn't exist or file unreadable
      }
    }

    return c.json({ error: "No pipeline run found for this book", ...PROCESS_MEMORY_PIPELINE_STATE }, 404);
  });

  // Get all stages for a pipeline run
  app.get("/:runId/stages", (c) => {
    const runId = c.req.param("runId");
    const run = pipelineRuns.get(runId);

    if (!run) {
      return c.json({ error: "Pipeline run not found", ...PROCESS_MEMORY_PIPELINE_STATE }, 404);
    }

    return c.json({ stages: run.stages.map((stage) => withPipelinePersistence(stage)), ...PROCESS_MEMORY_PIPELINE_STATE });
  });

  // Get a specific stage
  app.get("/:runId/stages/:stageId", (c) => {
    const runId = c.req.param("runId");
    const stageId = c.req.param("stageId");
    const run = pipelineRuns.get(runId);

    if (!run) {
      return c.json({ error: "Pipeline run not found", ...PROCESS_MEMORY_PIPELINE_STATE }, 404);
    }

    const stageIndex = parseInt(stageId, 10);
    const stage = run.stages[stageIndex];

    if (!stage) {
      return c.json({ error: "Stage not found", ...PROCESS_MEMORY_PIPELINE_STATE }, 404);
    }

    return c.json(withPipelinePersistence(stage));
  });

  // SSE endpoint for real-time pipeline events
  app.get("/:runId/events", (c) => {
    const runId = c.req.param("runId");

    return streamSSE(c, async (stream) => {
      // Send initial connection event
      await stream.writeSSE({
        event: "connected",
        data: JSON.stringify({ runId, ...PROCESS_MEMORY_PIPELINE_STATE }),
      });

      const interval = setInterval(async () => {
        const run = pipelineRuns.get(runId);
        if (!run) {
          clearInterval(interval);
          return;
        }

        await stream.writeSSE({
          event: "pipeline:update",
          data: JSON.stringify(withPipelineRunPersistence(run)),
        });

        if (run.status === "completed" || run.status === "failed") {
          clearInterval(interval);
          await stream.writeSSE({
            event: "pipeline:done",
            data: JSON.stringify({ status: run.status, ...PROCESS_MEMORY_PIPELINE_STATE }),
          });
        }
      }, 1000);

      stream.onAbort(() => {
        clearInterval(interval);
      });

      // Block until aborted
      await new Promise(() => {});
    });
  });

  // List all pipeline runs (for debugging)
  app.get("/", (c) => {
    const runs = Array.from(pipelineRuns.values()).map((run) => withPipelineRunPersistence(run));
    return c.json({ runs, ...PROCESS_MEMORY_PIPELINE_STATE });
  });

  return app;
}

// Helper functions for pipeline runner to update state
export function createPipelineRun(
  runId: string,
  bookId: string,
  bookTitle: string
): void {
  // Cap at 100 entries — evict oldest completed/failed runs first
  if (pipelineRuns.size >= 100) {
    for (const [key, run] of pipelineRuns) {
      if (run.status === "completed" || run.status === "failed") {
        pipelineRuns.delete(key);
        break;
      }
    }
  }

  const run: PipelineRun = {
    runId,
    bookId,
    bookTitle,
    status: "running",
    startTime: Date.now(),
    stages: [
      { name: "plan", status: "waiting" },
      { name: "compose", status: "waiting" },
      { name: "write", status: "waiting" },
      { name: "normalize", status: "waiting" },
      { name: "settle", status: "waiting" },
      { name: "audit", status: "waiting" },
      { name: "revise", status: "waiting" },
    ],
  };
  pipelineRuns.set(runId, run);
}

export function updatePipelineStage(
  runId: string,
  stageName: string,
  update: Partial<PipelineStage>
): void {
  const run = pipelineRuns.get(runId);
  if (!run) return;

  const stageIndex = run.stages.findIndex((s) => s.name === stageName);
  if (stageIndex === -1) return;

  const updatedStages = [...run.stages];
  updatedStages[stageIndex] = { ...updatedStages[stageIndex], ...update };

  pipelineRuns.set(runId, { ...run, stages: updatedStages });
}

export function completePipelineRun(
  runId: string,
  status: "completed" | "failed"
): void {
  const run = pipelineRuns.get(runId);
  if (!run) return;

  const completedRun: PipelineRun = {
    ...run,
    status,
    endTime: Date.now(),
  };
  pipelineRuns.set(runId, completedRun);

  // Persist to disk (fire-and-forget)
  void persistRunToDisk(completedRun);

  // Evict from memory after 1 hour to prevent unbounded growth
  setTimeout(() => pipelineRuns.delete(runId), 3600_000);
}
