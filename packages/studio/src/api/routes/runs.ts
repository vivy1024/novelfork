import { Hono } from "hono";
import type { RunStore } from "../lib/run-store.js";
import { isTerminalRunStatus } from "../lib/run-store.js";
import { createRunEventStream } from "../lib/sse.js";

export function createRunsRouter(runStore: RunStore): Hono {
  const app = new Hono();

  app.get("/api/runs/events", () => {
    const runId = "__all__";
    const initialEvent = { type: "snapshot" as const, runId, runs: runStore.list() };

    return createRunEventStream(
      initialEvent,
      (send) =>
        runStore.subscribeAll(() => {
          send({ type: "snapshot", runId, runs: runStore.list() });
        }),
      () => false,
    );
  });

  // Per-run SSE stream using upstream createRunEventStream
  app.get("/api/runs/:runId/events", (c) => {
    const runId = c.req.param("runId");
    const run = runStore.get(runId);
    if (!run) {
      return c.json({ error: "Run not found" }, 404);
    }

    const initialEvent = { type: "snapshot" as const, runId, run };

    return createRunEventStream(
      initialEvent,
      (send) => runStore.subscribe(runId, send),
      (event) =>
        event.type === "status" &&
        event.status !== undefined &&
        isTerminalRunStatus(event.status),
    );
  });

  // Cancel a running operation — mark as failed
  app.delete("/api/runs/:runId", (c) => {
    const runId = c.req.param("runId");
    const run = runStore.get(runId);
    if (!run) {
      return c.json({ error: "Run not found" }, 404);
    }
    if (run.status === "succeeded" || run.status === "failed") {
      return c.json({ error: "Run already terminal" }, 409);
    }
    runStore.fail(runId, "Cancelled by user");
    return c.json({ ok: true, runId });
  });

  // Get run status
  app.get("/api/runs/:runId", (c) => {
    const runId = c.req.param("runId");
    const run = runStore.get(runId);
    if (!run) {
      return c.json({ error: "Run not found" }, 404);
    }
    return c.json(run);
  });

  // List all runs
  app.get("/api/runs", (c) => {
    return c.json(runStore.list());
  });

  return app;
}
