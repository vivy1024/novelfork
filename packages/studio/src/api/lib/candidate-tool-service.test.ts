import { describe, expect, it } from "vitest";

import { NOVEL_SESSION_TOOL_DEFINITIONS } from "@vivy1024/novelfork-novel-plugin/handlers";
import { createSessionToolExecutor } from "./session-tool-executor.js";
import { clearPluginRegistrations, getSessionToolDefinition, registerPluginTools } from "./session-tool-registry.js";

describe("candidate.create_chapter removal", () => {
  it("does not expose candidate.create_chapter as a novel session tool", () => {
    clearPluginRegistrations();
    registerPluginTools(NOVEL_SESSION_TOOL_DEFINITIONS);

    expect(NOVEL_SESSION_TOOL_DEFINITIONS.map((tool) => tool.name)).not.toContain("candidate.create_chapter");
    expect(getSessionToolDefinition("candidate.create_chapter")).toBeUndefined();
  });

  it("cannot execute candidate.create_chapter through the session executor", async () => {
    clearPluginRegistrations();
    registerPluginTools(NOVEL_SESSION_TOOL_DEFINITIONS);
    const executor = createSessionToolExecutor();

    const result = await executor.execute({
      sessionId: "session-1",
      toolName: "candidate.create_chapter",
      permissionMode: "edit",
      input: { bookId: "book-1", chapterIntent: "旧入口", content: "正文" },
    });

    expect(result).toMatchObject({ ok: false, error: "unknown-tool" });
  });
});
