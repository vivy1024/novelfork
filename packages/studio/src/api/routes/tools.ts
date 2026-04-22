/**
 * 工具调用 API
 * 提供工具执行、列表查询、权限管理
 */

import { Hono } from "hono";
import { ToolExecutor } from "../lib/tool-executor.js";
import { ALL_TOOLS } from "../lib/tools/index.js";
import { loadUserConfig } from "../lib/user-config-service.js";
import { createRuntimePermissionManager, getPermissionDecision } from "../lib/runtime-tool-access.js";

export function createToolsRouter() {
  const app = new Hono();

  // 初始化工具执行器
  const executor = new ToolExecutor();

  // 注册所有工具
  for (const tool of ALL_TOOLS) {
    executor.register(tool);
  }

  /**
   * POST /api/tools/execute
   * 执行工具
   */
  app.post("/execute", async (c) => {
    try {
      const body = await c.req.json();
      const { toolName, params } = body;

      if (!toolName || typeof toolName !== "string") {
        return c.json({ success: false, error: "Missing or invalid toolName" }, 400);
      }

      if (!params || typeof params !== "object") {
        return c.json({ success: false, error: "Missing or invalid params" }, 400);
      }

      const userConfig = await loadUserConfig();
      const permissionManager = createRuntimePermissionManager(userConfig);
      const permission = getPermissionDecision(permissionManager, toolName, params as Record<string, unknown>);

      if (permission.action === "deny") {
        return c.json(
          {
            success: false,
            allowed: false,
            reason: permission.reason,
            source: permission.source,
            reasonKey: permission.reasonKey,
            error: permission.reason || "Permission denied",
          },
          403,
        );
      }

      if (permission.action === "prompt") {
        return c.json(
          {
            success: false,
            allowed: false,
            reason: permission.reason,
            source: permission.source,
            reasonKey: permission.reasonKey,
            error: permission.reason || "Tool execution requires confirmation",
            confirmationRequired: true,
          },
          403,
        );
      }

      // 执行工具
      const result = await executor.execute(toolName, params as Record<string, unknown>, {
        workspaceRoot: process.cwd(),
        userId: "default",
        sessionId: "default",
        permissions: new Set(["read", "write", "execute", "bash", "worktree"]),
      });

      return c.json({ success: result.success, result, error: result.error });
    } catch (error) {
      console.error("Failed to execute tool:", error);
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Failed to execute tool",
        },
        500,
      );
    }
  });

  /**
   * GET /api/tools/list
   * 列出所有可用工具
   */
  app.get("/list", async (c) => {
    try {
      const userConfig = await loadUserConfig();
      const permissionManager = createRuntimePermissionManager(userConfig);
      const tools = executor.listTools().map((tool) => {
        const permission = getPermissionDecision(permissionManager, tool.name, {});
        return {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          access: permission.action,
          enabled: permission.action !== "deny",
          requiresConfirmation: permission.action === "prompt",
          reason: permission.reason,
          source: permission.source,
          reasonKey: permission.reasonKey,
        };
      });

      return c.json({ tools });
    } catch (error) {
      console.error("Failed to list tools:", error);
      return c.json({ error: "Failed to list tools" }, 500);
    }
  });

  return app;
}
