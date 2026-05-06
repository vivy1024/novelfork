import { describe, expect, it } from "vitest";

import {
  createDefaultSlashCommandRegistry,
  executeSlashCommandInput,
  getSlashCommandSuggestions,
  parseSlashCommandInput,
} from "./slash-command-registry";

describe("slash-command-registry", () => {
  it("suggests built-in conversation commands for slash input", () => {
    const suggestions = getSlashCommandSuggestions("/p");

    expect(suggestions.map((command) => command.name)).toContain("permission");
    expect(suggestions.find((command) => command.name === "permission")?.usage).toBe("/permission [ask|edit|allow|read|plan]");
  });

  it("parses command name and arguments without treating normal messages as slash commands", () => {
    expect(parseSlashCommandInput("继续写第三章")).toMatchObject({ ok: false, reason: "not-slash" });
    expect(parseSlashCommandInput("/resume session-123")).toMatchObject({ ok: true, name: "resume", args: "session-123" });
  });

  it("executes help, status, model, permission, fork and resume commands as structured actions", async () => {
    const registry = createDefaultSlashCommandRegistry();

    await expect(executeSlashCommandInput("/help", { registry })).resolves.toMatchObject({ ok: true, kind: "status" });
    await expect(executeSlashCommandInput("/status", { registry, status: { sessionId: "s-1", modelLabel: "Sub2API / GPT-5.4", permissionMode: "edit" } })).resolves.toMatchObject({ ok: true, kind: "status" });
    await expect(executeSlashCommandInput("/model sub2api:gpt-5.5", { registry })).resolves.toMatchObject({ ok: true, kind: "update-session-config", patch: { providerId: "sub2api", modelId: "gpt-5.5" } });
    await expect(executeSlashCommandInput("/permission ask", { registry })).resolves.toMatchObject({ ok: true, kind: "update-session-config", patch: { permissionMode: "ask" } });
    await expect(executeSlashCommandInput("/fork 灵潮支线", { registry })).resolves.toMatchObject({ ok: true, kind: "fork-session", title: "灵潮支线" });
    await expect(executeSlashCommandInput("/resume session-123", { registry })).resolves.toMatchObject({ ok: true, kind: "resume-session", sessionId: "session-123" });
  });

  it("executes compact through the provided compact service and reports budget", async () => {
    const compactSession = async (instructions?: string) => ({
      ok: true as const,
      summary: `摘要：${instructions}`,
      budget: { estimatedTokensBefore: 2400, estimatedTokensAfter: 900 },
      compactedMessageCount: 12,
    });

    await expect(executeSlashCommandInput("/compact 保留主线", { registry: createDefaultSlashCommandRegistry(), compactSession })).resolves.toMatchObject({
      ok: true,
      kind: "compact-session",
      message: "Compact 完成：12 条历史已压缩，预算 2400 → 900 tokens。",
      summary: "摘要：保留主线",
    });
  });

  it("returns command errors for unknown or invalid commands", async () => {
    await expect(executeSlashCommandInput("/unknown", { registry: createDefaultSlashCommandRegistry() })).resolves.toMatchObject({ ok: false, code: "unknown_command" });
    await expect(executeSlashCommandInput("/permission root", { registry: createDefaultSlashCommandRegistry() })).resolves.toMatchObject({ ok: false, code: "invalid_permission_mode" });
    await expect(executeSlashCommandInput("/resume", { registry: createDefaultSlashCommandRegistry() })).resolves.toMatchObject({ ok: false, code: "missing_session_id" });
  });
});
