import { describe, expect, it } from "vitest";

import type { AgentTurnEvent } from "./agent-turn-runtime";
import {
  createRuntimeResultEvent,
  runtimeEventsFromAgentTurnEvent,
  runtimeEventsFromHeadlessChatEvent,
  runtimeItemsFromSessionMessage,
  RUNTIME_EVENT_TYPES,
} from "./runtime-events";

describe("canonical runtime events", () => {
  it("declares the canonical event taxonomy required by Studio, CLI and headless surfaces", () => {
    expect(RUNTIME_EVENT_TYPES).toEqual([
      "message",
      "assistant_delta",
      "tool_use",
      "tool_result",
      "permission_request",
      "checkpoint",
      "candidate",
      "usage",
      "command_started",
      "command_completed",
      "command_error",
      "error",
      "result",
    ]);
  });

  it("maps stored session messages into canonical runtime items", () => {
    const items = runtimeItemsFromSessionMessage({
      id: "msg-1",
      role: "assistant",
      content: "已生成候选稿。",
      timestamp: 1700000000000,
      seq: 7,
      runtime: { providerId: "sub2api", providerName: "Sub2API", modelId: "gpt-5-codex" },
      toolCalls: [{
        id: "tool-1",
        toolName: "candidate.create_chapter",
        status: "success",
        input: { bookId: "book-1" },
        result: { ok: true, summary: "候选稿已创建。" },
      }],
    }, { sessionId: "session-1" });

    expect(items).toEqual([
      {
        type: "message",
        id: "msg-1",
        session_id: "session-1",
        role: "assistant",
        content: "已生成候选稿。",
        seq: 7,
        timestamp: 1700000000000,
        runtime: { providerId: "sub2api", providerName: "Sub2API", modelId: "gpt-5-codex" },
      },
      {
        type: "tool_result",
        id: "tool-1",
        session_id: "session-1",
        tool_use_id: "tool-1",
        tool_name: "candidate.create_chapter",
        status: "success",
        input: { bookId: "book-1" },
        result: { ok: true, summary: "候选稿已创建。" },
      },
    ]);
  });

  it("maps AgentTurnEvent variants into canonical runtime events", () => {
    const runtime = { providerId: "sub2api", providerName: "Sub2API", modelId: "gpt-5-codex", usage: { input_tokens: 11, output_tokens: 13 } };
    const result = {
      ok: true,
      summary: "候选稿已创建，checkpoint 已保存。",
      data: { checkpointId: "checkpoint-1", paths: ["chapters/0001.md"] },
      artifact: {
        id: "candidate-1",
        kind: "candidate",
        title: "第 1 章候选稿",
        resourceRef: { kind: "candidate", id: "candidate-1", bookId: "book-1" },
      },
    } as const;
    const confirmation = {
      id: "confirm-1",
      toolName: "candidate.apply",
      target: "正式章节",
      risk: "confirmed-write" as const,
      summary: "确认写入正式章节",
      options: ["approve", "reject"] as const,
    };

    const agentEvents: AgentTurnEvent[] = [
      { type: "streaming_chunk", content: "候选" },
      { type: "assistant_message", content: "已完成。", runtime },
      { type: "tool_call", id: "tool-1", toolName: "candidate.create_chapter", input: { bookId: "book-1" }, runtime },
      { type: "tool_result", id: "tool-1", toolName: "candidate.create_chapter", result, runtime },
      { type: "confirmation_required", id: "confirm-1", toolName: "candidate.apply", sourceToolUseId: "tool-1", result: { ok: true, summary: "等待确认。", confirmation } },
      { type: "turn_failed", reason: "model-unavailable", message: "模型不可用。", data: { providerId: "sub2api" } },
      { type: "turn_completed" },
    ];

    expect(agentEvents.flatMap((event) => runtimeEventsFromAgentTurnEvent(event, { sessionId: "session-1", turnId: "turn-1" }))).toEqual([
      { type: "assistant_delta", session_id: "session-1", turn_id: "turn-1", delta: "候选" },
      { type: "message", session_id: "session-1", turn_id: "turn-1", role: "assistant", content: "已完成。", runtime },
      { type: "usage", session_id: "session-1", turn_id: "turn-1", usage: runtime.usage, runtime },
      { type: "tool_use", session_id: "session-1", turn_id: "turn-1", tool_use_id: "tool-1", tool_name: "candidate.create_chapter", input: { bookId: "book-1" }, runtime },
      { type: "tool_result", session_id: "session-1", turn_id: "turn-1", tool_use_id: "tool-1", tool_name: "candidate.create_chapter", result, runtime },
      { type: "checkpoint", session_id: "session-1", turn_id: "turn-1", checkpoint_id: "checkpoint-1", paths: ["chapters/0001.md"], source_tool_use_id: "tool-1" },
      { type: "candidate", session_id: "session-1", turn_id: "turn-1", candidate_id: "candidate-1", artifact: result.artifact, source_tool_use_id: "tool-1" },
      {
        type: "permission_request",
        session_id: "session-1",
        turn_id: "turn-1",
        confirmation_id: "confirm-1",
        tool_name: "candidate.apply",
        confirmation: expect.objectContaining({
          id: "confirm-1",
          toolName: "candidate.apply",
          targetResources: [{ kind: "candidate.apply", id: "正式章节" }],
          source: { sessionId: "session-1", turnId: "turn-1", toolUseId: "tool-1" },
          checkpoint: { required: true },
          operations: [
            { action: "approve", label: "批准" },
            { action: "reject", label: "拒绝" },
          ],
        }),
        result: { ok: true, summary: "等待确认。", confirmation },
      },
      { type: "error", session_id: "session-1", turn_id: "turn-1", code: "model-unavailable", message: "模型不可用。", data: { providerId: "sub2api" } },
      { type: "result", session_id: "session-1", turn_id: "turn-1", success: true, stop_reason: "completed", exit_code: 0 },
    ]);
  });

  it("normalizes headless stream-json events into the canonical runtime event shape", () => {
    expect(runtimeEventsFromHeadlessChatEvent({
      type: "permission_request",
      session_id: "session-1",
      confirmation_id: "confirm-1",
      tool_name: "candidate.apply",
      confirmation: { id: "confirm-1", toolName: "candidate.apply", target: "正式章节", risk: "confirmed-write", summary: "等待确认", options: ["approve", "reject"] },
      source_tool_use_id: "tool-1",
      result: { ok: true, summary: "等待确认。" },
      ephemeral: false,
    })).toEqual([{
      type: "permission_request",
      session_id: "session-1",
      confirmation_id: "confirm-1",
      tool_name: "candidate.apply",
      confirmation: expect.objectContaining({
        id: "confirm-1",
        toolName: "candidate.apply",
        targetResources: [{ kind: "candidate.apply", id: "正式章节" }],
        source: { sessionId: "session-1", toolUseId: "tool-1" },
        checkpoint: { required: true },
        operations: [
          { action: "approve", label: "批准" },
          { action: "reject", label: "拒绝" },
        ],
      }),
      result: { ok: true, summary: "等待确认。" },
      ephemeral: false,
    }]);

    expect(runtimeEventsFromHeadlessChatEvent({
      type: "command_error",
      session_id: "session-1",
      command_id: "/status",
      command_name: "status",
      raw: "/status",
      args: "",
      code: "planned_command",
      message: "命令不可用",
      ephemeral: true,
    })).toEqual([{
      type: "command_error",
      session_id: "session-1",
      command_id: "/status",
      command_name: "status",
      raw: "/status",
      args: "",
      code: "planned_command",
      message: "命令不可用",
      ephemeral: true,
    }]);
  });

  it("creates canonical result events for completed, pending and failed exits", () => {
    expect(createRuntimeResultEvent({ sessionId: "session-1", success: false, stopReason: "pending_confirmation", exitCode: 2, pendingConfirmation: { id: "confirm-1", toolName: "candidate.apply" } })).toEqual({
      type: "result",
      session_id: "session-1",
      success: false,
      stop_reason: "pending_confirmation",
      exit_code: 2,
      pending_confirmation: { id: "confirm-1", toolName: "candidate.apply" },
    });
  });
});
