/**
 * Daemon routes — mounted only in standalone mode.
 * 3 endpoints: status, start, stop.
 */

import { Hono } from "hono";
import type { RouterContext } from "./context.js";

export function createDaemonRouter(ctx: RouterContext): Hono {
  const app = new Hono();

  let schedulerInstance: import("@vivy1024/novelfork-core").Scheduler | null = null;

  app.get("/api/daemon", (c) => {
    return c.json({
      running: schedulerInstance?.isRunning ?? false,
    });
  });

  app.post("/api/daemon/start", async (c) => {
    if (schedulerInstance?.isRunning) {
      return c.json({ error: "Daemon already running" }, 400);
    }
    try {
      const { Scheduler, loadProjectConfig } = await import("@vivy1024/novelfork-core");
      const currentConfig = await loadProjectConfig(ctx.root);
      const scheduler = new Scheduler({
        ...(await ctx.buildPipelineConfig()),
        radarCron: currentConfig.daemon.schedule.radarCron,
        writeCron: currentConfig.daemon.schedule.writeCron,
        maxConcurrentBooks: currentConfig.daemon.maxConcurrentBooks,
        chaptersPerCycle: currentConfig.daemon.chaptersPerCycle,
        retryDelayMs: currentConfig.daemon.retryDelayMs,
        cooldownAfterChapterMs: currentConfig.daemon.cooldownAfterChapterMs,
        maxChaptersPerDay: currentConfig.daemon.maxChaptersPerDay,
        onChapterComplete: (bookId: any, chapter: any, status: any) => {
          ctx.broadcast("daemon:chapter", { bookId, chapter, status });
        },
        onError: (bookId: any, error: any) => {
          ctx.broadcast("daemon:error", { bookId, error: error.message });
        },
      });
      schedulerInstance = scheduler;
      ctx.broadcast("daemon:started", {});
      void scheduler.start().catch((e: any) => {
        const error = e instanceof Error ? e : new Error(String(e));
        if (schedulerInstance === scheduler) {
          scheduler.stop();
          schedulerInstance = null;
          ctx.broadcast("daemon:stopped", {});
        }
        ctx.broadcast("daemon:error", { bookId: "scheduler", error: error.message });
      });
      return c.json({ ok: true, running: true });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/daemon/stop", (c) => {
    if (!schedulerInstance?.isRunning) {
      return c.json({ error: "Daemon not running" }, 400);
    }
    schedulerInstance.stop();
    schedulerInstance = null;
    ctx.broadcast("daemon:stopped", {});
    return c.json({ ok: true, running: false });
  });

  return app;
}
