/**
 * 工具调用 API
 * 提供工具执行、列表查询、权限管理
 */

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve } from "node:path";

import { Hono } from "hono";
import { ToolExecutor } from "../lib/tool-executor.js";
import type { RunStore } from "../lib/run-store.js";
import { executeWithRuntimePolicy } from "../lib/execution-runtime.js";
import { ALL_TOOLS } from "../lib/tools/index.js";
import { loadUserConfig } from "../lib/user-config-service.js";
import { createRuntimePermissionManager, getPermissionDecision, isToolVisibleInWorkbenchMode } from "../lib/runtime-tool-access.js";

interface ToolsRouterOptions {
  readonly executor?: ToolExecutor;
  readonly runStore?: RunStore;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
  readonly openInEditor?: (request: EditorOpenRequest) => Promise<{ command: string; target: string; line?: number }>;
}

export function createToolsRouter(options: ToolsRouterOptions = {}) {
  const app = new Hono();

  const executor = options.executor ?? new ToolExecutor();

  if (!options.executor) {
    for (const tool of ALL_TOOLS) {
      executor.register(tool);
    }
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

      const execution = await executeWithRuntimePolicy({
        runStore: options.runStore,
        action: "tool",
        label: `Tool ${toolName}`,
        recovery: userConfig.runtimeControls.recovery,
        runtimeDebug: userConfig.runtimeControls.runtimeDebug,
        input: { toolName, params },
        sleep: options.sleep,
        random: options.random,
        execute: async () => {
          const result = await executor.execute(toolName, params as Record<string, unknown>, {
            workspaceRoot: process.cwd(),
            userId: "default",
            sessionId: "default",
            permissions: new Set(["read", "write", "execute", "bash", "worktree"]),
          });

          return result.success
            ? { success: true as const, value: result }
            : { success: false as const, error: result.error ?? `Tool ${toolName} execution failed` };
        },
      });

      if (!execution.success) {
        return c.json(
          {
            success: false,
            error: execution.error,
            execution: execution.execution,
          },
          500,
        );
      }

      return c.json({
        success: execution.value.success,
        result: execution.value,
        error: execution.value.error,
        execution: execution.execution,
      });
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

  app.post("/source-preview", async (c) => {
    try {
      const body = await c.req.json<{ toolName?: string; params?: Record<string, unknown>; command?: string; output?: string }>();
      const target = inferSourcePreviewTarget(body.params ?? {}, body.output);
      const location = extractSourceLocation(body.params ?? {});
      const requestPreview = [
        body.command?.trim() ? `# 命令\n${body.command.trim()}` : undefined,
        "POST /api/tools/execute",
        JSON.stringify({ toolName: body.toolName ?? "Tool", params: body.params ?? {} }, null, 2),
      ].filter((part): part is string => Boolean(part)).join("\n\n");

      const preview = await buildSourcePreview(target, location);

      return c.json({
        title: `${body.toolName ?? "Tool"} 源码视图`,
        target: preview.target,
        locator: preview.locator,
        line: preview.line,
        requestPreview,
        snippet: preview.snippet,
      });
    } catch (error) {
      console.error("Failed to build source preview:", error);
      return c.json({ error: error instanceof Error ? error.message : "Failed to build source preview" }, 500);
    }
  });

  app.post("/open-in-editor", async (c) => {
    try {
      const body = await c.req.json<{ toolName?: string; params?: Record<string, unknown>; output?: string }>();
      const target = inferSourcePreviewTarget(body.params ?? {}, body.output);
      const location = extractSourceLocation(body.params ?? {});
      const request: EditorOpenRequest = { target: target ?? "packages/studio/src/components/ChatWindow.tsx", line: location.line };
      const opened = options.openInEditor
        ? await options.openInEditor(request)
        : await openInEditorWithCode(request);
      return c.json({ success: true, ...opened });
    } catch (error) {
      console.error("Failed to open editor target:", error);
      return c.json({ success: false, error: error instanceof Error ? error.message : "Failed to open editor target" }, 500);
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
      const tools = executor.listTools().filter((tool) => isToolVisibleInWorkbenchMode(tool.name, userConfig.preferences?.workbenchMode === true)).map((tool) => {
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

interface SourceLocation {
  readonly line: number;
  readonly endLine: number;
}

interface EditorOpenRequest {
  readonly target: string;
  readonly line?: number;
}

async function buildSourcePreview(target: string | undefined, location: SourceLocation) {
  const fallbackTarget = "packages/studio/src/components/ChatWindow.tsx";
  const normalizedTarget = target?.trim() ? normalizeTargetPath(target) : fallbackTarget;
  const absolutePath = resolve(process.cwd(), normalizedTarget);

  try {
    const raw = await readFile(absolutePath, "utf8");
    const allLines = raw.split(/\r?\n/);
    const startIndex = Math.max(0, Math.min(allLines.length - 1, location.line - 1));
    const endIndex = Math.max(startIndex, Math.min(allLines.length - 1, location.endLine - 1));
    const snippet = allLines.slice(startIndex, endIndex + 1).join("\n");
    return {
      target: normalizedTarget,
      locator: `${normalizedTarget}:${startIndex + 1}-${endIndex + 1}`,
      line: startIndex + 1,
      snippet,
    };
  } catch {
    return {
      target: normalizedTarget,
      locator: `${normalizedTarget}:${location.line}-${location.endLine}`,
      line: location.line,
      snippet: "暂无可用源码片段",
    };
  }
}

function inferSourcePreviewTarget(params: Record<string, unknown>, output?: string) {
  const directTarget = pickFirstString(params, ["file_path", "path", "target"]);
  if (directTarget) {
    return directTarget;
  }

  const outputTarget = typeof output === "string"
    ? output.split(/\r?\n/).map((line) => line.trim()).find((line) => /\.(tsx?|jsx?|json|md|ya?ml)$/i.test(line))
    : undefined;

  if (outputTarget) {
    return outputTarget.replace(/^[A-Z? ]+/, "").trim();
  }

  return undefined;
}

function extractSourceLocation(params: Record<string, unknown>): SourceLocation {
  const limit = Math.max(1, extractPositiveInteger(params.limit) ?? 5);
  const lineno = extractPositiveInteger(params.lineno) ?? extractPositiveInteger(params.line);
  if (lineno) {
    return {
      line: lineno,
      endLine: lineno + limit - 1,
    };
  }

  const offset = extractPositiveInteger(params.offset);
  if (offset !== undefined) {
    return {
      line: offset + 1,
      endLine: offset + limit,
    };
  }

  return { line: 1, endLine: 5 };
}

async function openInEditorWithCode(request: EditorOpenRequest) {
  const target = normalizeTargetPath(request.target);
  const absoluteTarget = resolve(process.cwd(), target);
  const line = request.line;
  const gotoTarget = line ? `${absoluteTarget}:${line}` : absoluteTarget;

  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn("code", ["--goto", gotoTarget], {
      cwd: process.cwd(),
      stdio: "ignore",
      shell: true,
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("spawn", () => resolvePromise());
  });

  return { command: "code", target, line };
}

function normalizeTargetPath(target: string) {
  const sanitized = target.replace(/\\/g, "/").trim();
  if (!sanitized) {
    return sanitized;
  }

  if (!isAbsolute(sanitized)) {
    return sanitized;
  }

  return relative(process.cwd(), sanitized).replace(/\\/g, "/") || basename(sanitized);
}

function pickFirstString(record: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function extractPositiveInteger(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.trunc(parsed);
    }
  }
  return undefined;
}
