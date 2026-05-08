import { describe, expect, it, vi } from "vitest";

import type { SessionConfig } from "../../shared/session-types";
import type { AgentTurnItem, AgentTurnRuntimeInput } from "./agent-turn-runtime";
import { executeRuntimeTurn } from "./runtime-turn-service";

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
      content: "下一章候选思路已整理。",
      metadata: { providerId: "sub2api", providerName: "Sub2API", modelId: "gpt-5-codex", usage: { input_tokens: 5, output_tokens: 7 } },
    })),
    executeTool: vi.fn(async () => ({ ok: true, summary: "ok" })),
    ...overrides,
  };
}

describe("runtime turn service", () => {
  it("returns AgentTurnEvent and canonical RuntimeEvent from the same turn execution", async () => {
    const result = await executeRuntimeTurn(input(), { turnId: "turn-1" });

    expect(result.agentEvents.map((event) => event.type)).toEqual(["assistant_message", "turn_completed"]);
    expect(result.runtimeEvents.map((event) => event.type)).toEqual(["message", "usage", "result"]);
    expect(result.runtimeEvents).toEqual([
      expect.objectContaining({ type: "message", session_id: "session-1", turn_id: "turn-1", role: "assistant", content: "下一章候选思路已整理。" }),
      expect.objectContaining({ type: "usage", session_id: "session-1", turn_id: "turn-1", usage: { input_tokens: 5, output_tokens: 7 } }),
      expect.objectContaining({ type: "result", session_id: "session-1", turn_id: "turn-1", success: true, stop_reason: "completed", exit_code: 0 }),
    ]);
  });

  it("uses canonical checkpoint and candidate events for tool outputs", async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({
        success: true as const,
        type: "tool_use" as const,
        toolUses: [{ id: "tool-1", name: "candidate.create_chapter", input: { bookId: "book-1" } }],
        metadata: { providerId: "sub2api", providerName: "Sub2API", modelId: "gpt-5-codex" },
      })
      .mockResolvedValueOnce({
        success: true as const,
        type: "message" as const,
        content: "候选稿已生成。",
        metadata: { providerId: "sub2api", providerName: "Sub2API", modelId: "gpt-5-codex" },
      });

    const result = await executeRuntimeTurn(input({
      generate,
      executeTool: vi.fn(async () => ({
        ok: true,
        summary: "候选稿已创建。",
        data: { checkpointId: "checkpoint-1", paths: ["chapters/0001.md"] },
        artifact: {
          id: "candidate-1",
          kind: "candidate",
          title: "第 1 章候选稿",
          resourceRef: { kind: "candidate", id: "candidate-1", bookId: "book-1" },
        },
      })),
    }), { turnId: "turn-2" });

    expect(result.runtimeEvents.map((event) => event.type)).toEqual([
      "tool_use",
      "tool_result",
      "checkpoint",
      "candidate",
      "message",
      "result",
    ]);
  });
});
