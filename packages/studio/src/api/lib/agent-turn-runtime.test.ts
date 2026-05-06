import { describe, expect, it, vi } from "vitest";

import type { SessionConfig } from "../../shared/session-types";
import { runAgentTurn, type AgentTurnItem, type AgentTurnRuntimeInput } from "./agent-turn-runtime";

const sessionConfig: SessionConfig = {
  providerId: "sub2api",
  modelId: "gpt-5-codex",
  permissionMode: "edit",
  reasoningEffort: "medium",
};

const baseMessages: AgentTurnItem[] = [
  { type: "message", role: "user", content: "写下一章" },
];

function input(overrides: Partial<AgentTurnRuntimeInput> = {}): AgentTurnRuntimeInput {
  return {
    sessionId: "session-1",
    sessionConfig,
    messages: baseMessages,
    systemPrompt: "你是 NovelFork 叙述者。",
    tools: [],
    permissionMode: "edit",
    generate: vi.fn(async () => ({
      success: true as const,
      type: "message" as const,
      content: "已完成。",
      metadata: { providerId: "sub2api", providerName: "Sub2API", modelId: "gpt-5-codex" },
    })),
    executeTool: vi.fn(async () => ({ ok: true, summary: "ok" })),
    ...overrides,
  };
}

describe("agent turn runtime", () => {
  it("executes a tool use and continues to the final assistant message", async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({
        success: true as const,
        type: "tool_use" as const,
        toolUses: [{ id: "tool-1", name: "cockpit.get_snapshot", input: { bookId: "book-1" } }],
        metadata: { providerId: "sub2api", providerName: "Sub2API", modelId: "gpt-5-codex" },
      })
      .mockResolvedValueOnce({
        success: true as const,
        type: "message" as const,
        content: "已读取工作台快照，下一步生成计划。",
        metadata: { providerId: "sub2api", providerName: "Sub2API", modelId: "gpt-5-codex" },
      });
    const executeTool = vi.fn(async () => ({ ok: true, summary: "已读取工作台快照。", data: { bookId: "book-1" } }));

    const events = await runAgentTurn(input({ generate, executeTool }));

    expect(executeTool).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "session-1",
      toolName: "cockpit.get_snapshot",
      input: { bookId: "book-1" },
      permissionMode: "edit",
      sessionConfig,
    }));
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate).toHaveBeenLastCalledWith(expect.objectContaining({
      messages: expect.arrayContaining([
        { type: "tool_call", id: "tool-1", name: "cockpit.get_snapshot", input: { bookId: "book-1" } },
        expect.objectContaining({ type: "tool_result", toolCallId: "tool-1", name: "cockpit.get_snapshot", content: expect.stringContaining("已读取工作台快照。"), data: { bookId: "book-1" } }),
      ]),
    }));
    expect(events).toEqual([
      { type: "tool_call", id: "tool-1", toolName: "cockpit.get_snapshot", input: { bookId: "book-1" }, runtime: { providerId: "sub2api", providerName: "Sub2API", modelId: "gpt-5-codex" } },
      { type: "tool_result", id: "tool-1", toolName: "cockpit.get_snapshot", result: { ok: true, summary: "已读取工作台快照。", data: { bookId: "book-1" } }, runtime: { providerId: "sub2api", providerName: "Sub2API", modelId: "gpt-5-codex" } },
      { type: "assistant_message", content: "已读取工作台快照，下一步生成计划。", runtime: { providerId: "sub2api", providerName: "Sub2API", modelId: "gpt-5-codex" } },
      { type: "turn_completed" },
    ]);
  });

  it("stops when a tool result requires confirmation", async () => {
    const generate = vi.fn(async () => ({
      success: true as const,
      type: "tool_use" as const,
      toolUses: [{ id: "tool-confirm", name: "guided.exit", input: { planId: "plan-1" } }],
      metadata: { providerId: "sub2api", providerName: "Sub2API", modelId: "gpt-5-codex" },
    }));
    const confirmation = { id: "confirm-1", toolName: "guided.exit", target: "计划", risk: "confirmed-write" as const, summary: "批准生成计划", options: ["approve", "reject"] as const };
    const result = { ok: true, summary: "等待确认。", confirmation };

    const events = await runAgentTurn(input({ generate, executeTool: vi.fn(async () => result) }));

    expect(generate).toHaveBeenCalledTimes(1);
    expect(events.at(-1)).toEqual({ type: "confirmation_required", id: "confirm-1", toolName: "guided.exit", result });
  });

  it("returns failed tool results to the model before emitting the final response", async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({
        success: true as const,
        type: "tool_use" as const,
        toolUses: [{ id: "tool-failed", name: "candidate.create_chapter", input: { bookId: "book-1" } }],
        metadata: { providerId: "sub2api", providerName: "Sub2API", modelId: "gpt-5-codex" },
      })
      .mockResolvedValueOnce({
        success: true as const,
        type: "message" as const,
        content: "候选稿生成失败，我会说明无法继续。",
        metadata: { providerId: "sub2api", providerName: "Sub2API", modelId: "gpt-5-codex" },
      });

    const events = await runAgentTurn(input({
      generate,
      executeTool: vi.fn(async () => ({ ok: false, summary: "模型不可用。", error: "model-unavailable" })),
    }));

    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate).toHaveBeenLastCalledWith(expect.objectContaining({
      messages: expect.arrayContaining([
        expect.objectContaining({ type: "tool_result", toolCallId: "tool-failed", name: "candidate.create_chapter", content: expect.stringContaining("模型不可用。") }),
      ]),
    }));
    expect(events).toEqual([
      { type: "tool_call", id: "tool-failed", toolName: "candidate.create_chapter", input: { bookId: "book-1" }, runtime: { providerId: "sub2api", providerName: "Sub2API", modelId: "gpt-5-codex" } },
      { type: "tool_result", id: "tool-failed", toolName: "candidate.create_chapter", result: { ok: false, summary: "模型不可用。", error: "model-unavailable" }, runtime: { providerId: "sub2api", providerName: "Sub2API", modelId: "gpt-5-codex" } },
      { type: "assistant_message", content: "候选稿生成失败，我会说明无法继续。", runtime: { providerId: "sub2api", providerName: "Sub2API", modelId: "gpt-5-codex" } },
      { type: "turn_completed" },
    ]);
  });

  it("stops at the configured tool loop limit", async () => {
    const generate = vi.fn(async () => ({
      success: true as const,
      type: "tool_use" as const,
      toolUses: [{ id: `tool-${generate.mock.calls.length + 1}`, name: "cockpit.get_snapshot", input: { bookId: `book-${generate.mock.calls.length}` } }],
      metadata: { providerId: "sub2api", providerName: "Sub2API", modelId: "gpt-5-codex" },
    }));
    const executeTool = vi.fn(async () => ({ ok: true, summary: "已读取。" }));

    const events = await runAgentTurn(input({ generate, executeTool, maxSteps: 2 }));

    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(events.at(-1)).toMatchObject({ type: "turn_failed", reason: "tool-loop-limit", data: { maxSteps: 2 } });
  });

  it("does not execute the same tool with the same input twice in one turn", async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({
        success: true as const,
        type: "tool_use" as const,
        toolUses: [{ id: "tool-1", name: "cockpit.get_snapshot", input: { bookId: "book-1" } }],
        metadata: { providerId: "sub2api", providerName: "Sub2API", modelId: "gpt-5-codex" },
      })
      .mockResolvedValueOnce({
        success: true as const,
        type: "tool_use" as const,
        toolUses: [{ id: "tool-2", name: "cockpit.get_snapshot", input: { bookId: "book-1" } }],
        metadata: { providerId: "sub2api", providerName: "Sub2API", modelId: "gpt-5-codex" },
      })
      .mockResolvedValueOnce({
        success: true as const,
        type: "message" as const,
        content: "已基于已有快照继续。",
        metadata: { providerId: "sub2api", providerName: "Sub2API", modelId: "gpt-5-codex" },
      });
    const executeTool = vi.fn(async () => ({ ok: true, summary: "已读取工作台快照。" }));

    const events = await runAgentTurn(input({ generate, executeTool }));

    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual(expect.objectContaining({
      type: "tool_result",
      id: "tool-2",
      result: expect.objectContaining({ ok: true, data: expect.objectContaining({ status: "duplicate-tool-call" }) }),
    }));
  });

  it("adds continuation guidance to tool results returned to the model", async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({
        success: true as const,
        type: "tool_use" as const,
        toolUses: [{ id: "tool-1", name: "cockpit.get_snapshot", input: { bookId: "book-1" } }],
        metadata: { providerId: "sub2api", providerName: "Sub2API", modelId: "gpt-5-codex" },
      })
      .mockResolvedValueOnce({
        success: true as const,
        type: "message" as const,
        content: "继续下一步。",
        metadata: { providerId: "sub2api", providerName: "Sub2API", modelId: "gpt-5-codex" },
      });

    await runAgentTurn(input({ generate, executeTool: vi.fn(async () => ({ ok: true, summary: "已读取工作台快照。" })) }));

    expect(generate).toHaveBeenLastCalledWith(expect.objectContaining({
      messages: expect.arrayContaining([
        expect.objectContaining({ type: "tool_result", content: expect.stringContaining("请先总结已经获得的信息") }),
      ]),
    }));
  });

  it("emits assistant message and completion events for a text-only turn", async () => {
    const generate = vi.fn(async () => ({
      success: true as const,
      type: "message" as const,
      content: "候选思路已整理。",
      metadata: { providerId: "sub2api", providerName: "Sub2API", modelId: "gpt-5-codex" },
    }));

    const events = await runAgentTurn(input({ generate }));

    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      sessionConfig,
      messages: [{ type: "message", role: "system", content: "你是 NovelFork 叙述者。" }, ...baseMessages],
      tools: [],
    }));
    expect(events).toEqual([
      { type: "assistant_message", content: "候选思路已整理。", runtime: { providerId: "sub2api", providerName: "Sub2API", modelId: "gpt-5-codex" } },
      { type: "turn_completed" },
    ]);
  });

  it("appends optional context to the system prompt before generation", async () => {
    const generate = vi.fn(async () => ({
      success: true as const,
      type: "message" as const,
      content: "ok",
      metadata: { providerId: "sub2api", providerName: "Sub2API", modelId: "gpt-5-codex" },
    }));

    await runAgentTurn(input({ generate, context: "## 当前书籍\n- 书名：试炼" }));

    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      messages: [expect.objectContaining({ type: "message", role: "system", content: "你是 NovelFork 叙述者。\n\n## 当前书籍\n- 书名：试炼" }), ...baseMessages],
    }));
  });

  it("filters provider tool schemas through session tool policy before generation", async () => {
    const generate = vi.fn(async () => ({
      success: true as const,
      type: "message" as const,
      content: "已按可用工具继续。",
      metadata: { providerId: "sub2api", providerName: "Sub2API", modelId: "gpt-5-codex" },
    }));
    const tools = [
      { name: "cockpit.get_snapshot", description: "读取快照", inputSchema: { type: "object" as const, additionalProperties: false }, risk: "read" as const, renderer: "cockpit.snapshot", enabledForModes: ["read", "plan", "ask", "edit", "allow"] as const, visibility: "author" as const },
      { name: "candidate.create_chapter", description: "创建候选稿", inputSchema: { type: "object" as const, additionalProperties: false }, risk: "draft-write" as const, renderer: "candidate.created", enabledForModes: ["ask", "edit", "allow"] as const, visibility: "author" as const },
    ];

    await runAgentTurn(input({
      generate,
      tools,
      sessionConfig: { ...sessionConfig, toolPolicy: { deny: ["candidate.create_chapter"] } },
    }));

    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      tools: [expect.objectContaining({ name: "cockpit.get_snapshot" })],
    }));
  });

  it("emits policy-disabled when no tools remain after policy filtering", async () => {
    const generate = vi.fn();
    const events = await runAgentTurn(input({
      generate,
      tools: [{ name: "candidate.create_chapter", description: "创建候选稿", inputSchema: { type: "object" as const, additionalProperties: false }, risk: "draft-write" as const, renderer: "candidate.created", enabledForModes: ["ask", "edit", "allow"] as const, visibility: "author" as const }],
      sessionConfig: { ...sessionConfig, toolPolicy: { deny: ["candidate.*"] } },
    }));

    expect(generate).not.toHaveBeenCalled();
    expect(events).toEqual([
      {
        type: "turn_failed",
        reason: "policy-disabled",
        message: "当前 session 工具策略禁用了所有可发送给模型的工具。",
        data: { deniedTools: ["candidate.create_chapter"] },
      },
    ]);
  });

  it("emits turn_failed when model generation fails", async () => {
    const events = await runAgentTurn(input({
      generate: vi.fn(async () => ({
        success: false as const,
        code: "model-unavailable",
        error: "Session has no configured runtime model",
        metadata: { providerId: "", modelId: "" },
      })),
    }));

    expect(events).toEqual([
      { type: "turn_failed", reason: "model-unavailable", message: "Session has no configured runtime model", data: { metadata: { providerId: "", modelId: "" } } },
    ]);
  });

  it("supports maxSteps=200 allowing many tool steps before hitting the limit", async () => {
    let callCount = 0;
    const generate = vi.fn(async () => {
      callCount += 1;
      return {
        success: true as const,
        type: "tool_use" as const,
        toolUses: [{ id: `tool-${callCount}`, name: "cockpit.get_snapshot", input: { bookId: `book-${callCount}` } }],
        metadata: { providerId: "sub2api", providerName: "Sub2API", modelId: "gpt-5-codex" },
      };
    });
    const executeTool = vi.fn(async () => ({ ok: true, summary: "已读取。" }));

    const events = await runAgentTurn(input({ generate, executeTool, maxSteps: 200 }));

    expect(executeTool).toHaveBeenCalledTimes(200);
    expect(events.at(-1)).toMatchObject({ type: "turn_failed", reason: "tool-loop-limit", data: { maxSteps: 200 } });
  });

  it("continues the loop after a tool failure and lets the model decide next steps", async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({
        success: true as const,
        type: "tool_use" as const,
        toolUses: [{ id: "tool-fail", name: "cockpit.get_snapshot", input: { bookId: "book-1" } }],
        metadata: { providerId: "sub2api", providerName: "Sub2API", modelId: "gpt-5-codex" },
      })
      .mockResolvedValueOnce({
        success: true as const,
        type: "message" as const,
        content: "工具失败了，我换个方式处理。",
        metadata: { providerId: "sub2api", providerName: "Sub2API", modelId: "gpt-5-codex" },
      });
    const executeTool = vi.fn(async () => ({
      ok: false,
      summary: "数据库连接失败。",
      error: "tool-execution-failed",
    }));

    const events = await runAgentTurn(input({
      generate,
      executeTool,
      shouldContinueAfterToolResult: ({ result }) => {
        if (!result.ok && result.error === "pending-confirmation") return false;
        if (result.ok || result.error === "confirmation-rejected") return true;
        return true; // 工具失败 — 继续
      },
    }));

    expect(generate).toHaveBeenCalledTimes(2);
    expect(events).toEqual([
      { type: "tool_call", id: "tool-fail", toolName: "cockpit.get_snapshot", input: { bookId: "book-1" }, runtime: { providerId: "sub2api", providerName: "Sub2API", modelId: "gpt-5-codex" } },
      { type: "tool_result", id: "tool-fail", toolName: "cockpit.get_snapshot", result: { ok: false, summary: "数据库连接失败。", error: "tool-execution-failed" }, runtime: { providerId: "sub2api", providerName: "Sub2API", modelId: "gpt-5-codex" } },
      { type: "assistant_message", content: "工具失败了，我换个方式处理。", runtime: { providerId: "sub2api", providerName: "Sub2API", modelId: "gpt-5-codex" } },
      { type: "turn_completed" },
    ]);
  });
});
