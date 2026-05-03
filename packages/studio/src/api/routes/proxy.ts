import { Hono } from "hono";
import { loadUserConfig, updateUserConfig } from "../lib/user-config-service.js";
import type { ProxySettings } from "../../types/settings.js";

/**
 * 代理管理路由
 *
 * 为每个 AI 供应商配置 HTTP 代理，中国用户访问海外 API 必须。
 * 当前只实现配置的存储和读取，实际的代理注入作为后续任务。
 */
export function createProxyRouter() {
  const app = new Hono();

  // 获取所有代理配置
  app.get("/", async (c) => {
    try {
      const config = await loadUserConfig();
      return c.json(config.proxy);
    } catch (error) {
      console.error("Failed to load proxy config:", error);
      return c.json({ error: "Failed to load proxy config" }, 500);
    }
  });

  // 更新代理配置（整体替换）
  app.put("/", async (c) => {
    try {
      const body = await c.req.json<Partial<ProxySettings>>();
      const updated = await updateUserConfig({ proxy: body });
      return c.json(updated.proxy);
    } catch (error) {
      console.error("Failed to update proxy config:", error);
      return c.json({ error: "Failed to update proxy config" }, 500);
    }
  });

  // 获取单个供应商的代理
  app.get("/providers/:providerId", async (c) => {
    try {
      const providerId = c.req.param("providerId");
      const config = await loadUserConfig();
      const proxyUrl = config.proxy.providers[providerId] ?? "";
      return c.json({ providerId, proxy: proxyUrl });
    } catch (error) {
      console.error("Failed to load provider proxy:", error);
      return c.json({ error: "Failed to load provider proxy" }, 500);
    }
  });

  // 更新单个供应商的代理
  app.put("/providers/:providerId", async (c) => {
    try {
      const providerId = c.req.param("providerId");
      const { proxy } = await c.req.json<{ proxy: string }>();
      const proxyUrl = typeof proxy === "string" ? proxy.trim() : "";
      const config = await loadUserConfig();
      const providers = { ...config.proxy.providers, [providerId]: proxyUrl };
      // 清除空值
      if (!proxyUrl) {
        delete providers[providerId];
      }
      const updated = await updateUserConfig({ proxy: { providers } });
      return c.json({ providerId, proxy: updated.proxy.providers[providerId] ?? "" });
    } catch (error) {
      console.error("Failed to update provider proxy:", error);
      return c.json({ error: "Failed to update provider proxy" }, 500);
    }
  });

  return app;
}
