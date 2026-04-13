import { Router } from "express";
import type { RouterContext } from "./context.js";

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

// In-memory storage for pipeline runs (temporary implementation)
const pipelineRuns = new Map<string, PipelineRun>();

export function createPipelineRouter(ctx: RouterContext): Router {
  const router = Router();

  // Get pipeline run status
  router.get("/:runId/status", (req, res) => {
    const { runId } = req.params;
    const run = pipelineRuns.get(runId);

    if (!run) {
      return res.status(404).json({ error: "Pipeline run not found" });
    }

    res.json(run);
  });

  // Get all stages for a pipeline run
  router.get("/:runId/stages", (req, res) => {
    const { runId } = req.params;
    const run = pipelineRuns.get(runId);

    if (!run) {
      return res.status(404).json({ error: "Pipeline run not found" });
    }

    res.json({ stages: run.stages });
  });

  // Get a specific stage
  router.get("/:runId/stages/:stageId", (req, res) => {
    const { runId, stageId } = req.params;
    const run = pipelineRuns.get(runId);

    if (!run) {
      return res.status(404).json({ error: "Pipeline run not found" });
    }

    const stageIndex = parseInt(stageId, 10);
    const stage = run.stages[stageIndex];

    if (!stage) {
      return res.status(404).json({ error: "Stage not found" });
    }

    res.json(stage);
  });

  // SSE endpoint for real-time pipeline events
  router.get("/:runId/events", (req, res) => {
    const { runId } = req.params;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    // Send initial connection event
    res.write(`event: connected\ndata: ${JSON.stringify({ runId })}\n\n`);

    // Poll for updates and send to client
    const interval = setInterval(() => {
      const run = pipelineRuns.get(runId);
      if (!run) {
        clearInterval(interval);
        res.end();
        return;
      }

      // Send stage updates
      res.write(`event: pipeline:update\ndata: ${JSON.stringify(run)}\n\n`);

      // Close connection if pipeline is done
      if (run.status === "completed" || run.status === "failed") {
        clearInterval(interval);
        res.write(`event: pipeline:done\ndata: ${JSON.stringify({ status: run.status })}\n\n`);
        res.end();
      }
    }, 1000);

    req.on("close", () => {
      clearInterval(interval);
    });
  });

  // List all pipeline runs (for debugging)
  router.get("/", (req, res) => {
    const runs = Array.from(pipelineRuns.values());
    res.json({ runs });
  });

  return router;
}

// Helper functions for pipeline runner to update state
export function createPipelineRun(
  runId: string,
  bookId: string,
  bookTitle: string
): void {
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

  pipelineRuns.set(runId, {
    ...run,
    status,
    endTime: Date.now(),
  });
}
