import { describe, expect, it } from "vitest";

import type { RuntimeEvent } from "./runtime-events.js";
import { encodeRuntimeStreamJsonEventsAsNdjson, runtimeEventsToStreamJsonEvents } from "./runtime-stream-json.js";

const sessionId = "session-1";

function events(): RuntimeEvent[] {
  return [
    { type: "message", session_id: sessionId, role: "user", content: "写下一章" },
    { type: "assistant_delta", session_id: sessionId, delta: "正" },
    { type: "message", session_id: sessionId, role: "assistant", content: "正在规划。", runtime: { providerId: "p", modelId: "m" } },
    { type: "tool_use", session_id: sessionId, tool_use_id: "tool-1", tool_name: "candidate.create_chapter", input: { bookId: "book-1" } },
    { type: "tool_result", session_id: sessionId, tool_use_id: "tool-1", tool_name: "candidate.create_chapter", result: { ok: true, summary: "候选稿已创建。", data: { checkpointId: "checkpoint-1", paths: ["chapters/0001.md"] }, artifact: { id: "candidate-1", kind: "candidate", title: "第一章候选", resourceRef: { kind: "candidate", id: "candidate-1", bookId: "book-1" } } } },
    { type: "checkpoint", session_id: sessionId, checkpoint_id: "checkpoint-1", paths: ["chapters/0001.md"], source_tool_use_id: "tool-1" },
    { type: "candidate", session_id: sessionId, candidate_id: "candidate-1", source_tool_use_id: "tool-1", artifact: { id: "candidate-1", kind: "candidate", title: "第一章候选", resourceRef: { kind: "candidate", id: "candidate-1", bookId: "book-1" } } },
    { type: "permission_request", session_id: sessionId, confirmation_id: "confirm-1", tool_name: "chapter.overwrite", result: { ok: true, summary: "等待确认。", confirmation: { id: "confirm-1", toolName: "chapter.overwrite", target: "正式章节", risk: "confirmed-write", summary: "确认写入", options: ["approve", "reject"] } } },
    { type: "usage", session_id: sessionId, usage: { input_tokens: 10, output_tokens: 5 } },
    { type: "error", session_id: sessionId, code: "pending-confirmation", message: "等待用户确认。" },
    { type: "result", session_id: sessionId, success: false, stop_reason: "pending_confirmation", exit_code: 2, pending_confirmation: { id: "confirm-1", toolName: "chapter.overwrite" }, duration_ms: 12 },
  ];
}

describe("runtime stream-json emitter", () => {
  it("emits the stable Claude/Codex-class event taxonomy from canonical runtime events", () => {
    const streamEvents = runtimeEventsToStreamJsonEvents(events(), { ephemeral: false });

    expect(streamEvents.map((event) => event.type)).toEqual([
      "user_message",
      "assistant_delta",
      "assistant_message",
      "tool_use",
      "tool_result",
      "checkpoint_created",
      "resource_updated",
      "candidate_created",
      "resource_updated",
      "permission_request",
      "usage_delta",
      "error",
      "result",
    ]);
    expect(streamEvents.find((event) => event.type === "checkpoint_created")).toMatchObject({ checkpoint_id: "checkpoint-1", paths: ["chapters/0001.md"] });
    expect(streamEvents.find((event) => event.type === "candidate_created")).toMatchObject({ candidate_id: "candidate-1" });
    expect(streamEvents.filter((event) => event.type === "resource_updated")).toHaveLength(2);
  });

  it("serializes stream-json events as valid NDJSON lines", () => {
    const streamEvents = runtimeEventsToStreamJsonEvents(events(), { ephemeral: true });
    const ndjson = encodeRuntimeStreamJsonEventsAsNdjson(streamEvents);
    const lines = ndjson.trim().split("\n");

    expect(lines).toHaveLength(streamEvents.length);
    expect(lines.map((line) => JSON.parse(line) as { type: string; ephemeral?: boolean })).toEqual(
      streamEvents.map((event) => expect.objectContaining({ type: event.type, ephemeral: true })),
    );
  });

  it("passes command events through the stream-json emitter", () => {
    const streamEvents = runtimeEventsToStreamJsonEvents([
      { type: "command_started", session_id: sessionId, command_id: "/status", command_name: "status", raw: "/status", args: "" },
      { type: "command_completed", session_id: sessionId, command_id: "/status", command_name: "status", raw: "/status", args: "", result: { ok: true, kind: "status", message: "ok" } },
      { type: "command_error", session_id: sessionId, command_id: "/tools", command_name: "tools", raw: "/tools", args: "", code: "planned_command", message: "不可用" },
    ], { ephemeral: false });

    expect(streamEvents).toEqual([
      { type: "command_started", session_id: sessionId, command_id: "/status", command_name: "status", raw: "/status", args: "", ephemeral: false },
      { type: "command_completed", session_id: sessionId, command_id: "/status", command_name: "status", raw: "/status", args: "", result: { ok: true, kind: "status", message: "ok" }, ephemeral: false },
      { type: "command_error", session_id: sessionId, command_id: "/tools", command_name: "tools", raw: "/tools", args: "", code: "planned_command", message: "不可用", ephemeral: false },
    ]);
  });
});
