import { describe, expect, it, vi } from "vitest";

import { executeRuntimeCommandInput } from "../registry/command-executor.js";

describe("runtime command executor", () => {
  it("emits canonical command lifecycle events and calls injected runtime handlers", async () => {
    const updateSessionConfig = vi.fn(async () => ({ message: "权限已切换为 ask" }));

    const result = await executeRuntimeCommandInput("/permission ask", {
      sessionId: "session-1",
      handlers: { updateSessionConfig },
    });

    expect(updateSessionConfig).toHaveBeenCalledWith({ permissionMode: "ask" }, expect.objectContaining({ commandId: "/permission", args: "ask" }));
    expect(result).toMatchObject({
      ok: true,
      result: { kind: "update-session-config", message: "权限已切换为 ask", patch: { permissionMode: "ask" } },
    });
    expect(result.events).toEqual([
      expect.objectContaining({ type: "command_started", session_id: "session-1", command_id: "/permission", args: "ask" }),
      expect.objectContaining({ type: "command_completed", session_id: "session-1", command_id: "/permission", result: expect.objectContaining({ kind: "update-session-config" }) }),
    ]);
  });

  it("returns command_error events for planned commands instead of falling through to the model", async () => {
    const result = await executeRuntimeCommandInput("/tools", { sessionId: "session-1" });

    expect(result).toMatchObject({ ok: false, result: { kind: "error", code: "planned_command" } });
    expect(result.events).toEqual([
      expect.objectContaining({ type: "command_started", session_id: "session-1", command_id: "/tools" }),
      expect.objectContaining({ type: "command_error", session_id: "session-1", command_id: "/tools", code: "planned_command" }),
    ]);
  });
});
