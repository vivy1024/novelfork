import { Hono } from "hono";
import { loadUserConfig, updateUserConfig } from "../lib/user-config-service.js";
import { collectMetrics } from "../lib/metrics-service.js";
import type { UserConfig } from "../../types/settings.js";

export function createSettingsRouter() {
  const app = new Hono();

  // 获取完整用户配置
  app.get("/user", async (c) => {
    try {
      const config = await loadUserConfig();
      return c.json(config);
    } catch (error) {
      console.error("Failed to load user config:", error);
      return c.json({ error: "Failed to load user config" }, 500);
    }
  });

  // 更新用户配置（部分更新）
  app.put("/user", async (c) => {
    try {
      const partial = await c.req.json<Partial<UserConfig>>();
      const updated = await updateUserConfig(partial);
      return c.json(updated);
    } catch (error) {
      console.error("Failed to update user config:", error);
      return c.json({ error: "Failed to update user config" }, 500);
    }
  });

  // 获取主题配置
  app.get("/theme", async (c) => {
    try {
      const config = await loadUserConfig();
      return c.json({ theme: config.preferences.theme });
    } catch (error) {
      console.error("Failed to load theme:", error);
      return c.json({ error: "Failed to load theme" }, 500);
    }
  });

  // 更新主题配置
  app.put("/theme", async (c) => {
    try {
      const { theme } = await c.req.json<{ theme: "light" | "dark" | "auto" }>();
      const updated = await updateUserConfig({
        preferences: { theme } as any,
      });
      return c.json({ theme: updated.preferences.theme });
    } catch (error) {
      console.error("Failed to update theme:", error);
      return c.json({ error: "Failed to update theme" }, 500);
    }
  });

  // 获取编辑器配置
  app.get("/editor", async (c) => {
    try {
      const config = await loadUserConfig();
      return c.json({
        fontSize: config.preferences.fontSize,
        fontFamily: config.preferences.fontFamily,
        lineHeight: config.preferences.editorLineHeight,
        tabSize: config.preferences.editorTabSize,
        autoSave: config.preferences.autoSave,
        autoSaveDelay: config.preferences.autoSaveDelay,
      });
    } catch (error) {
      console.error("Failed to load editor config:", error);
      return c.json({ error: "Failed to load editor config" }, 500);
    }
  });

  // 更新编辑器配置
  app.put("/editor", async (c) => {
    try {
      const editorPrefs = await c.req.json<Partial<{
        fontSize: number;
        fontFamily: string;
        lineHeight: number;
        tabSize: number;
        autoSave: boolean;
        autoSaveDelay: number;
      }>>();

      const updated = await updateUserConfig({
        preferences: {
          fontSize: editorPrefs.fontSize,
          fontFamily: editorPrefs.fontFamily,
          editorLineHeight: editorPrefs.lineHeight,
          editorTabSize: editorPrefs.tabSize,
          autoSave: editorPrefs.autoSave,
          autoSaveDelay: editorPrefs.autoSaveDelay,
        } as any,
      });

      return c.json({
        fontSize: updated.preferences.fontSize,
        fontFamily: updated.preferences.fontFamily,
        lineHeight: updated.preferences.editorLineHeight,
        tabSize: updated.preferences.editorTabSize,
        autoSave: updated.preferences.autoSave,
        autoSaveDelay: updated.preferences.autoSaveDelay,
      });
    } catch (error) {
      console.error("Failed to update editor config:", error);
      return c.json({ error: "Failed to update editor config" }, 500);
    }
  });

  // 获取快捷键配置
  app.get("/shortcuts", async (c) => {
    try {
      const config = await loadUserConfig();
      return c.json({ shortcuts: config.shortcuts });
    } catch (error) {
      console.error("Failed to load shortcuts:", error);
      return c.json({ error: "Failed to load shortcuts" }, 500);
    }
  });

  // 更新快捷键配置
  app.put("/shortcuts", async (c) => {
    try {
      const { shortcuts } = await c.req.json<{ shortcuts: Record<string, string> }>();
      const updated = await updateUserConfig({ shortcuts });
      return c.json({ shortcuts: updated.shortcuts });
    } catch (error) {
      console.error("Failed to update shortcuts:", error);
      return c.json({ error: "Failed to update shortcuts" }, 500);
    }
  });

  // 获取系统指标
  app.get("/metrics", async (c) => {
    try {
      // 从环境变量或默认路径获取项目根目录
      const projectRoot = process.env.NOVELFORK_PROJECT_ROOT || process.cwd();
      const metrics = await collectMetrics(projectRoot);
      return c.json(metrics);
    } catch (error) {
      console.error("Failed to collect metrics:", error);
      return c.json({ error: "Failed to collect metrics" }, 500);
    }
  });

  return app;
}
