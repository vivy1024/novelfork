/**
 * Headless exec API route
 *
 * POST /api/exec — 非交互执行写作任务，复用 AgentTurnRuntime。
 * 参考 Codex CLI exec 模式设计，适配 NovelFork 确认门和候选区写入语义。
 */

import { Hono } from "hono";

import { executeHeadless, type HeadlessExecInput } from "../lib/headless-exec-service.js";

export function createExecRouter() {
  const app = new Hono();

  app.post("/", async (c) => {
    const body = await c.req.json<Partial<HeadlessExecInput>>().catch(() => null);
    if (!body?.prompt?.trim()) {
      return c.json({ error: "prompt is required" }, 400);
    }

    const input: HeadlessExecInput = {
      prompt: body.prompt.trim(),
      ...(body.sessionId ? { sessionId: body.sessionId } : {}),
      ...(body.agentId ? { agentId: body.agentId } : {}),
      ...(body.projectId ? { projectId: body.projectId } : {}),
      ...(body.sessionConfig ? { sessionConfig: body.sessionConfig } : {}),
      ...(body.stdinContext ? { stdinContext: body.stdinContext } : {}),
      ...(body.jsonOutput !== undefined ? { jsonOutput: body.jsonOutput } : {}),
      ...(body.maxSteps !== undefined ? { maxSteps: body.maxSteps } : {}),
    };

    const result = await executeHeadless(input);

    const statusCode = result.success ? 200 : result.exitCode === 2 ? 202 : 500;
    return c.json(result, statusCode);
  });

  return app;
}
