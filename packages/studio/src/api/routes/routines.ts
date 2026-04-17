/**
 * Routines API 路由
 */

import { Hono } from "hono";
import {
  loadGlobalRoutines,
  saveGlobalRoutines,
  loadProjectRoutines,
  saveProjectRoutines,
  mergeRoutines,
  resetRoutines,
} from "../lib/routines-service.js";
import type { Routines } from "../../types/routines.js";

export function createRoutinesRouter() {
  const app = new Hono();

  /**
   * GET /api/routines/global
   * 获取全局配置
   */
  app.get("/global", async (c) => {
    try {
      const routines = await loadGlobalRoutines();
      return c.json({ routines });
    } catch (error) {
      console.error("Failed to load global routines:", error);
      return c.json({ error: "Failed to load global routines" }, 500);
    }
  });

  /**
   * PUT /api/routines/global
   * 保存全局配置
   */
  app.put("/global", async (c) => {
    try {
      const routines = await c.req.json<Routines>();
      await saveGlobalRoutines(routines);
      return c.json({ success: true });
    } catch (error) {
      console.error("Failed to save global routines:", error);
      return c.json({ error: "Failed to save global routines" }, 500);
    }
  });

  /**
   * GET /api/routines/project
   * 获取项目配置
   */
  app.get("/project", async (c) => {
    try {
      const projectRoot = c.req.query("root");
      if (!projectRoot) {
        return c.json({ error: "Project root is required" }, 400);
      }

      const routines = await loadProjectRoutines(projectRoot);
      return c.json({ routines });
    } catch (error) {
      console.error("Failed to load project routines:", error);
      return c.json({ error: "Failed to load project routines" }, 500);
    }
  });

  /**
   * PUT /api/routines/project
   * 保存项目配置
   */
  app.put("/project", async (c) => {
    try {
      const projectRoot = c.req.query("root");
      if (!projectRoot) {
        return c.json({ error: "Project root is required" }, 400);
      }

      const routines = await c.req.json<Routines>();
      await saveProjectRoutines(projectRoot, routines);
      return c.json({ success: true });
    } catch (error) {
      console.error("Failed to save project routines:", error);
      return c.json({ error: "Failed to save project routines" }, 500);
    }
  });

  /**
   * GET /api/routines/merged
   * 获取合并后的配置（全局 + 项目）
   */
  app.get("/merged", async (c) => {
    try {
      const projectRoot = c.req.query("root");

      const globalRoutines = await loadGlobalRoutines();
      const projectRoutines = projectRoot
        ? await loadProjectRoutines(projectRoot)
        : null;

      const merged = mergeRoutines(globalRoutines, projectRoutines);
      return c.json({ routines: merged });
    } catch (error) {
      console.error("Failed to load merged routines:", error);
      return c.json({ error: "Failed to load merged routines" }, 500);
    }
  });

  /**
   * POST /api/routines/reset
   * 重置配置为默认值
   */
  app.post("/reset", async (c) => {
    try {
      const body = await c.req.json<{ scope: "global" | "project"; projectRoot?: string }>();
      const { scope, projectRoot } = body;

      if (scope !== "global" && scope !== "project") {
        return c.json({ error: "Invalid scope" }, 400);
      }

      if (scope === "project" && !projectRoot) {
        return c.json({ error: "Project root is required" }, 400);
      }

      const routines = await resetRoutines(scope, projectRoot);
      return c.json({ routines });
    } catch (error) {
      console.error("Failed to reset routines:", error);
      return c.json({ error: "Failed to reset routines" }, 500);
    }
  });

  return app;
}
