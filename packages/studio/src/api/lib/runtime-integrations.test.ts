import { describe, expect, it, vi } from "vitest";

import { createMcpToolBridge, createHookExecutor, createAgentToolHandler, type HookDefinition } from "./runtime-integrations";

describe("MCP tool bridge", () => {
  it("registers MCP tools into session tool registry format", () => {
    const bridge = createMcpToolBridge({
      serverId: "github-mcp",
      tools: [
        { name: "search_repos", description: "Search GitHub repos", inputSchema: { type: "object", properties: { query: { type: "string" } } } },
        { name: "get_file", description: "Get file content" },
      ],
    });

    const tools = bridge.getSessionTools();
    expect(tools).toHaveLength(2);
    expect(tools[0]).toMatchObject({ name: "mcp:github-mcp:search_repos", description: "Search GitHub repos", risk: "read" });
    expect(tools[1]).toMatchObject({ name: "mcp:github-mcp:get_file" });
  });

  it("executes MCP tool call through the bridge", async () => {
    const callTool = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "result data" }] });
    const bridge = createMcpToolBridge({
      serverId: "test-mcp",
      tools: [{ name: "echo", description: "Echo" }],
      callTool,
    });

    const result = await bridge.execute("echo", { text: "hello" });
    expect(result.ok).toBe(true);
    expect(callTool).toHaveBeenCalledWith("echo", { text: "hello" });
  });
});

describe("hook executor", () => {
  it("executes before_tool hooks and records to transcript", async () => {
    const hook: HookDefinition = { id: "audit-hook", point: "after_tool", handler: vi.fn().mockResolvedValue({ ok: true, message: "审计通过" }) };
    const executor = createHookExecutor([hook]);

    const events = await executor.runHooks("after_tool", { toolName: "chapter.save", result: { ok: true } });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ hookId: "audit-hook", ok: true, message: "审计通过" });
    expect(hook.handler).toHaveBeenCalled();
  });

  it("records hook failure without blocking execution", async () => {
    const hook: HookDefinition = { id: "failing-hook", point: "before_turn", handler: vi.fn().mockRejectedValue(new Error("Hook crashed")) };
    const executor = createHookExecutor([hook]);

    const events = await executor.runHooks("before_turn", {});

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ hookId: "failing-hook", ok: false, error: "Hook crashed" });
  });
});

describe("AgentTool handler", () => {
  it("launches subagent and returns result", async () => {
    const generate = vi.fn().mockResolvedValue({ success: true, type: "message", content: "子代理完成" });
    const handler = createAgentToolHandler({ generate });

    const result = await handler.execute({
      agentId: "writer",
      prompt: "写第三章",
      systemPrompt: "你是写作代理",
      modelId: "claude-sonnet-4",
      providerId: "anthropic",
      tools: ["chapter.read"],
      maxSteps: 5,
    });

    expect(result.ok).toBe(true);
    expect(result.summary).toContain("子代理完成");
  });
});
