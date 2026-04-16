/**
 * Agent 配置管理 API
 * Agent 运行时配置的获取和更新
 */

import { Hono } from "hono";
import { agentConfigService } from "../lib/agent-config-service.js";
import type { AgentConfig } from "../lib/agent-config-service.js";

export function createAgentConfigRouter() {
  const app = new Hono();

  /**
   * GET /api/agent/config
   * 获取 Agent 配置
   */
  app.get("/", async (c) => {
    try {
      const config = agentConfigService.getAgentConfig();
      return c.json({ config });
    } catch (error) {
      console.error("Failed to get agent config:", error);
      return c.json({ error: "Failed to get agent config" }, 500);
    }
  });

  /**
   * PUT /api/agent/config
   * 更新 Agent 配置
   */
  app.put("/", async (c) => {
    try {
      const updates = await c.req.json<Partial<AgentConfig>>();
      const result = agentConfigService.updateAgentConfig(updates);

      if (!result.success) {
        return c.json({ error: result.error }, 400);
      }

      return c.json({ config: result.config });
    } catch (error) {
      console.error("Failed to update agent config:", error);
      return c.json({ error: "Failed to update agent config" }, 500);
    }
  });

  /**
   * GET /api/agent/config/usage
   * 获取资源使用情况
   */
  app.get("/usage", async (c) => {
    try {
      const usage = agentConfigService.getResourceUsage();
      const stats = agentConfigService.getConfigStats();
      return c.json({ usage, stats });
    } catch (error) {
      console.error("Failed to get resource usage:", error);
      return c.json({ error: "Failed to get resource usage" }, 500);
    }
  });

  /**
   * POST /api/agent/config/reset
   * 重置配置为默认值
   */
  app.post("/reset", async (c) => {
    try {
      const config = agentConfigService.resetToDefaults();
      return c.json({ config });
    } catch (error) {
      console.error("Failed to reset agent config:", error);
      return c.json({ error: "Failed to reset agent config" }, 500);
    }
  });

  /**
   * POST /api/agent/config/check-workspace
   * 检查是否可以创建新工作区
   */
  app.post("/check-workspace", async (c) => {
    try {
      const result = agentConfigService.canCreateWorkspace();
      return c.json(result);
    } catch (error) {
      console.error("Failed to check workspace:", error);
      return c.json({ error: "Failed to check workspace" }, 500);
    }
  });

  /**
   * POST /api/agent/config/check-container
   * 检查是否可以创建新容器
   */
  app.post("/check-container", async (c) => {
    try {
      const result = agentConfigService.canCreateContainer();
      return c.json(result);
    } catch (error) {
      console.error("Failed to check container:", error);
      return c.json({ error: "Failed to check container" }, 500);
    }
  });

  /**
   * POST /api/agent/config/allocate-port
   * 分配端口
   */
  app.post("/allocate-port", async (c) => {
    try {
      const result = agentConfigService.allocatePort();
      if (!result.port) {
        return c.json({ error: result.error }, 400);
      }
      return c.json({ port: result.port });
    } catch (error) {
      console.error("Failed to allocate port:", error);
      return c.json({ error: "Failed to allocate port" }, 500);
    }
  });

  /**
   * POST /api/agent/config/release-port
   * 释放端口
   */
  app.post("/release-port", async (c) => {
    try {
      const { port } = await c.req.json<{ port: number }>();
      const success = agentConfigService.releasePort(port);
      if (!success) {
        return c.json({ error: "Invalid port or port not in range" }, 400);
      }
      return c.json({ success: true });
    } catch (error) {
      console.error("Failed to release port:", error);
      return c.json({ error: "Failed to release port" }, 500);
    }
  });

  return app;
}
