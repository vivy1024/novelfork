/**
 * 终端管理 API 路由
 *
 * GET    /api/terminals      — 列出所有终端（running / exited 分组）
 * DELETE /api/terminals/:id  — 清理已退出的终端记录
 */

import { Hono } from "hono";

import { TerminalStore } from "../lib/terminal-store.js";

/** 全局单例 — 供 Terminal 工具和其他模块共享 */
let globalTerminalStore: TerminalStore | null = null;

export function getTerminalStore(): TerminalStore {
  if (!globalTerminalStore) {
    globalTerminalStore = new TerminalStore();
  }
  return globalTerminalStore;
}

/** 允许测试注入自定义 store */
export function createTerminalsRouter(store?: TerminalStore) {
  const terminalStore = store ?? getTerminalStore();
  const app = new Hono();

  // GET /  → 列出所有终端
  app.get("/", (c) => {
    const { running, exited } = terminalStore.list();
    return c.json({ running, exited });
  });

  // DELETE /:id  → 清理已退出的终端
  app.delete("/:id", (c) => {
    const id = c.req.param("id");
    const result = terminalStore.remove(id);

    if (!result.removed) {
      const status = result.reason === "still_running" ? 409 : 404;
      const message =
        result.reason === "still_running"
          ? "终端仍在运行，无法清理"
          : "终端不存在";
      return c.json({ error: message }, status);
    }

    return c.json({ ok: true });
  });

  return app;
}
