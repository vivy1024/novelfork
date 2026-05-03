import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

import type { HeadlessExecResult } from "../lib/headless-exec-service.js";

const executeHeadlessMock = vi.hoisted(() => vi.fn());

vi.mock("../lib/headless-exec-service.js", () => ({
  executeHeadless: executeHeadlessMock,
}));

import { createExecRouter } from "./exec.js";

afterEach(() => { vi.clearAllMocks(); });

function makeApp() {
  const app = new Hono();
  app.route("/api/exec", createExecRouter());
  return app;
}

function makeResult(overrides: Partial<HeadlessExecResult> = {}): HeadlessExecResult {
  return {
    sessionId: "s-1",
    events: [],
    toolResults: [],
    success: true,
    exitCode: 0,
    finalMessage: "完成",
    ...overrides,
  };
}

describe("createExecRouter", () => {
  it("returns 400 when prompt is missing", async () => {
    const app = makeApp();
    const res = await app.request("/api/exec", { method: "POST", body: JSON.stringify({}), headers: { "Content-Type": "application/json" } });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("prompt");
  });

  it("returns 200 with result on successful execution", async () => {
    executeHeadlessMock.mockResolvedValue(makeResult());
    const app = makeApp();
    const res = await app.request("/api/exec", {
      method: "POST",
      body: JSON.stringify({ prompt: "写一章" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.finalMessage).toBe("完成");
  });

  it("returns 202 when execution hits a pending confirmation", async () => {
    executeHeadlessMock.mockResolvedValue(makeResult({
      success: false,
      exitCode: 2,
      pendingConfirmation: { toolName: "candidate.create_chapter", id: "tc-1" },
    }));
    const app = makeApp();
    const res = await app.request("/api/exec", {
      method: "POST",
      body: JSON.stringify({ prompt: "生成候选稿" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.pendingConfirmation).toBeTruthy();
  });

  it("returns 500 when execution fails", async () => {
    executeHeadlessMock.mockResolvedValue(makeResult({
      success: false,
      exitCode: 1,
      error: "model-unavailable",
    }));
    const app = makeApp();
    const res = await app.request("/api/exec", {
      method: "POST",
      body: JSON.stringify({ prompt: "写" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("model-unavailable");
  });

  it("passes all input fields to executeHeadless", async () => {
    executeHeadlessMock.mockResolvedValue(makeResult());
    const app = makeApp();
    await app.request("/api/exec", {
      method: "POST",
      body: JSON.stringify({
        prompt: "写一章",
        sessionId: "s-existing",
        agentId: "planner",
        projectId: "book-1",
        sessionConfig: { providerId: "p1", modelId: "m1" },
        stdinContext: "附加内容",
        maxSteps: 10,
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(executeHeadlessMock).toHaveBeenCalledWith(expect.objectContaining({
      prompt: "写一章",
      sessionId: "s-existing",
      agentId: "planner",
      projectId: "book-1",
      stdinContext: "附加内容",
      maxSteps: 10,
      sessionConfig: expect.objectContaining({ providerId: "p1", modelId: "m1" }),
    }));
  });
});
