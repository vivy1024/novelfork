import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { RunStore } from "../run-store.js";

export function createRunsRouter(runStore: RunStore): Hono {
  const app = new Hono();

  // Per-run SSE — replaces global /api/events for AI operation progress
  // Supports Last-Event-ID for reconnect deduplication
  app.get("/api/runs/:runId/events", (c) => {
    const runId = c.req.param("runId");
    const run = runStore.getRun(runId);
    if (!run) {
      return c.json({ error: "Run not found" }, 404);
    }

    return streamSSE(c, async (stream) => {
      const lastEventId = c.req.header("Last-Event-ID");

      // Replay missed events on reconnect
      const missed = runStore.getEventsSince(runId, lastEventId ?? undefined);
      for (const event of missed) {
        await stream.writeSSE({
          event: event.event,
          data: JSON.stringify(event.data),
          id: event.eventId,
        });
      }

      // Stream future events
      const unsubscribe = runStore.subscribe(runId, async (event) => {
        await stream.writeSSE({
          event: event.event,
          data: JSON.stringify(event.data),
          id: event.eventId,
        });
      });

      // Keep-alive ping
      const keepAlive = setInterval(() => {
        stream.writeSSE({ event: "ping", data: "" });
      }, 30_000);

      stream.onAbort(() => {
        unsubscribe();
        clearInterval(keepAlive);
      });

      await new Promise(() => {});
    });
  });

  // Cancel a running operation
  app.delete("/api/runs/:runId", (c) => {
    const runId = c.req.param("runId");
    const cancelled = runStore.cancel(runId);
    if (!cancelled) {
      return c.json({ error: "Run not found or already terminal" }, 404);
    }
    return c.json({ ok: true, runId });
  });

  // Get run status
  app.get("/api/runs/:runId", (c) => {
    const runId = c.req.param("runId");
    const run = runStore.getRun(runId);
    if (!run) {
      return c.json({ error: "Run not found" }, 404);
    }
    return c.json({
      runId: run.runId,
      bookId: run.bookId,
      operation: run.operation,
      status: run.status,
    });
  });

  return app;
}
