/**
 * Daemon routes — mounted only in standalone mode.
 * 3 endpoints: status, start, stop.
 */

import { resolve } from "node:path";
import { Hono } from "hono";
import type { RouterContext } from "./context.js";

interface DaemonRuntimeState {
  schedulerInstance: import("@vivy1024/novelfork-core").Scheduler | null;
  recentEvents: DaemonEvent[];
}

export interface DaemonEvent {
  readonly timestamp: string;
  readonly event: string;
  readonly level: "info" | "error";
  readonly message: string;
}

export interface AdminDaemonSnapshot {
  readonly running: boolean;
  readonly refreshedAt: string;
  readonly refreshHintMs: number;
  readonly schedule: {
    readonly radarCron: string;
    readonly writeCron: string;
  };
  readonly limits: {
    readonly maxConcurrentBooks: number;
    readonly chaptersPerCycle: number | null;
    readonly retryDelayMs: number | null;
    readonly cooldownAfterChapterMs: number | null;
    readonly maxChaptersPerDay: number | null;
  };
  readonly recentEvents: ReadonlyArray<DaemonEvent>;
  readonly capabilities: {
    readonly start: boolean;
    readonly stop: boolean;
    readonly terminal: false;
    readonly container: false;
  };
}

const MAX_DAEMON_EVENTS = 30;
const daemonStates = new Map<string, DaemonRuntimeState>();

function getDaemonState(root: string): DaemonRuntimeState {
  const normalizedRoot = resolve(root);
  const existing = daemonStates.get(normalizedRoot);
  if (existing) {
    return existing;
  }

  const created: DaemonRuntimeState = {
    schedulerInstance: null,
    recentEvents: [],
  };
  daemonStates.set(normalizedRoot, created);
  return created;
}

function appendDaemonEvent(root: string, event: Omit<DaemonEvent, "timestamp">) {
  const state = getDaemonState(root);
  state.recentEvents.push({
    timestamp: new Date().toISOString(),
    ...event,
  });

  if (state.recentEvents.length > MAX_DAEMON_EVENTS) {
    state.recentEvents.splice(0, state.recentEvents.length - MAX_DAEMON_EVENTS);
  }
}

function isSchedulerRunning(root: string): boolean {
  return getDaemonState(root).schedulerInstance?.isRunning ?? false;
}

async function loadDaemonConfig(root: string) {
  const { loadProjectConfig } = await import("@vivy1024/novelfork-core");
  return loadProjectConfig(root, { requireApiKey: false });
}

export async function getDaemonAdminSnapshot(root: string): Promise<AdminDaemonSnapshot> {
  const state = getDaemonState(root);
  const config = await loadDaemonConfig(root);

  return {
    running: state.schedulerInstance?.isRunning ?? false,
    refreshedAt: new Date().toISOString(),
    refreshHintMs: state.schedulerInstance?.isRunning ? 5_000 : 15_000,
    schedule: {
      radarCron: config.daemon.schedule.radarCron,
      writeCron: config.daemon.schedule.writeCron,
    },
    limits: {
      maxConcurrentBooks: config.daemon.maxConcurrentBooks,
      chaptersPerCycle: config.daemon.chaptersPerCycle ?? null,
      retryDelayMs: config.daemon.retryDelayMs ?? null,
      cooldownAfterChapterMs: config.daemon.cooldownAfterChapterMs ?? null,
      maxChaptersPerDay: config.daemon.maxChaptersPerDay ?? null,
    },
    recentEvents: state.recentEvents.slice().reverse(),
    capabilities: {
      start: !isSchedulerRunning(root),
      stop: isSchedulerRunning(root),
      terminal: false,
      container: false,
    },
  };
}

export async function startDaemon(ctx: RouterContext): Promise<void> {
  const state = getDaemonState(ctx.root);

  if (state.schedulerInstance?.isRunning) {
    throw new Error("Daemon already running");
  }

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
      appendDaemonEvent(ctx.root, {
        event: "chapter-complete",
        level: "info",
        message: `${bookId} 第 ${String(chapter)} 章完成：${String(status)}`,
      });
      ctx.broadcast("daemon:chapter", { bookId, chapter, status });
    },
    onError: (bookId: any, error: any) => {
      const message = error instanceof Error ? error.message : String(error);
      appendDaemonEvent(ctx.root, {
        event: "error",
        level: "error",
        message: `${String(bookId)}：${message}`,
      });
      ctx.broadcast("daemon:error", { bookId, error: message });
    },
  });

  state.schedulerInstance = scheduler;
  appendDaemonEvent(ctx.root, {
    event: "started",
    level: "info",
    message: `守护进程已启动（radar ${currentConfig.daemon.schedule.radarCron} / write ${currentConfig.daemon.schedule.writeCron}）`,
  });
  ctx.broadcast("daemon:started", {});

  void scheduler.start().catch((error: unknown) => {
    const normalized = error instanceof Error ? error : new Error(String(error));
    if (state.schedulerInstance === scheduler) {
      scheduler.stop();
      state.schedulerInstance = null;
      appendDaemonEvent(ctx.root, {
        event: "stopped",
        level: "info",
        message: "守护进程因异常退出已停止",
      });
      ctx.broadcast("daemon:stopped", {});
    }
    appendDaemonEvent(ctx.root, {
      event: "error",
      level: "error",
      message: normalized.message,
    });
    ctx.broadcast("daemon:error", { bookId: "scheduler", error: normalized.message });
  });
}

export function stopDaemon(ctx: RouterContext): void {
  const state = getDaemonState(ctx.root);

  if (!state.schedulerInstance?.isRunning) {
    throw new Error("Daemon not running");
  }

  state.schedulerInstance.stop();
  state.schedulerInstance = null;
  appendDaemonEvent(ctx.root, {
    event: "stopped",
    level: "info",
    message: "守护进程已停止",
  });
  ctx.broadcast("daemon:stopped", {});
}

export function createDaemonRouter(ctx: RouterContext): Hono {
  const app = new Hono();

  app.get("/api/daemon", (c) => {
    return c.json({
      running: isSchedulerRunning(ctx.root),
    });
  });

  app.post("/api/daemon/start", async (c) => {
    try {
      await startDaemon(ctx);
      return c.json({ ok: true, running: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message === "Daemon already running" ? 400 : 500;
      return c.json({ error: message }, status as 400 | 500);
    }
  });

  app.post("/api/daemon/stop", (c) => {
    try {
      stopDaemon(ctx);
      return c.json({ ok: true, running: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message === "Daemon not running" ? 400 : 500;
      return c.json({ error: message }, status as 400 | 500);
    }
  });

  return app;
}
