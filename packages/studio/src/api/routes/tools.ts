/**
 * 工具调用 API
 * 提供工具执行、列表查询、权限管理
 */

import { Hono } from "hono";
import { ToolExecutor } from "../lib/tool-executor.js";
import { PermissionManager } from "../lib/permission-manager.js";
import { ALL_TOOLS } from "../lib/tools/index.js";

export function createToolsRouter() {
  const app = new Hono();

  // 初始化工具执行器和权限管理器
  const executor = new ToolExecutor();
  const permissionManager = new PermissionManager();

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

      // 1. 请求权限
      const permission = await permissionManager.requestPermission(toolName, params);
      if (!permission.approved) {
        return c.json(
          {
            success: false,
            error: permission.reason || "Permission denied",
          },
          403
        );
      }

      // 2. 执行工具
      const result = await executor.execute(toolName, params, {
        workspaceRoot: process.cwd(), // 或从配置读取
        userId: "default", // 或从会话读取
        sessionId: "default", // 或从请求头读取
        permissions: new Set(["read", "write", "execute"]), // 或从会话读取
      });

      return c.json({ success: result.success, result, error: result.error });
    } catch (error) {
      console.error("Failed to execute tool:", error);
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Failed to execute tool",
        },
        500
      );
    }
  });

  /**
   * GET /api/tools/list
   * 列出所有可用工具
   */
  app.get("/list", (c) => {
    try {
      const tools = executor.listTools().map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      }));

      return c.json({ tools });
    } catch (error) {
      console.error("Failed to list tools:", error);
      return c.json({ error: "Failed to list tools" }, 500);
    }
  });

  return app;
}
