import { describe, expect, it } from "vitest";

import {
  type RuntimeSettingsSource,
  type RuntimeSettingsScope,
  type RuntimeSettingsEntry,
  type RuntimeSettingsLayer,
  mergeRuntimeSettings,
  resolveRuntimeSettingsEntry,
  RUNTIME_SETTINGS_SOURCE_PRIORITY,
} from "./runtime-settings";

describe("RuntimeSettings configuration model", () => {
  it("defines source priority order: session > project > user > imported > default", () => {
    expect(RUNTIME_SETTINGS_SOURCE_PRIORITY).toEqual(["session", "project", "user", "imported", "default"]);
  });

  it("merges layers by source priority, keeping provenance metadata", () => {
    const layers: RuntimeSettingsLayer[] = [
      { source: "default", scope: "global", entries: { "model.default": { value: "gpt-4o", status: "current" } } },
      { source: "user", scope: "global", entries: { "model.default": { value: "claude-sonnet-4", status: "current" }, "runtime.permissionMode": { value: "ask", status: "current" } } },
      { source: "session", scope: "session", entries: { "runtime.permissionMode": { value: "allow", status: "current" } } },
    ];

    const merged = mergeRuntimeSettings(layers);

    expect(merged["model.default"]).toMatchObject({
      value: "claude-sonnet-4",
      source: "user",
      scope: "global",
      status: "current",
    });
    expect(merged["runtime.permissionMode"]).toMatchObject({
      value: "allow",
      source: "session",
      scope: "session",
      status: "current",
    });
  });

  it("resolves a single entry with full provenance chain", () => {
    const layers: RuntimeSettingsLayer[] = [
      { source: "default", scope: "global", entries: { "runtime.maxTurnSteps": { value: 200, status: "current" } } },
      { source: "user", scope: "global", entries: { "runtime.maxTurnSteps": { value: 100, status: "current" } } },
    ];

    const entry = resolveRuntimeSettingsEntry("runtime.maxTurnSteps", layers);

    expect(entry).toMatchObject({
      key: "runtime.maxTurnSteps",
      value: 100,
      source: "user",
      scope: "global",
      status: "current",
      overrides: [{ source: "default", value: 200 }],
    });
  });

  it("marks entries with error when a higher-priority layer has an invalid value", () => {
    const layers: RuntimeSettingsLayer[] = [
      { source: "default", scope: "global", entries: { "model.default": { value: "gpt-4o", status: "current" } } },
      { source: "user", scope: "global", entries: { "model.default": { value: "", status: "unconfigured", error: "模型未配置" } } },
    ];

    const merged = mergeRuntimeSettings(layers);

    expect(merged["model.default"]).toMatchObject({
      value: "",
      source: "user",
      status: "unconfigured",
      error: "模型未配置",
    });
  });

  it("preserves lastUpdated timestamp from the winning layer", () => {
    const now = "2026-05-08T12:00:00.000Z";
    const layers: RuntimeSettingsLayer[] = [
      { source: "default", scope: "global", entries: { "runtime.sendMode": { value: "enter", status: "current" } } },
      { source: "user", scope: "global", entries: { "runtime.sendMode": { value: "ctrl-enter", status: "current", lastUpdated: now } } },
    ];

    const merged = mergeRuntimeSettings(layers);

    expect(merged["runtime.sendMode"]?.lastUpdated).toBe(now);
  });

  it("supports ToolPolicy, McpServerConfig, SubagentConfig, WorkflowRecipe, CommandDefinition, SkillDefinition, HookDefinition entry types", () => {
    const layers: RuntimeSettingsLayer[] = [
      {
        source: "user",
        scope: "global",
        entries: {
          "toolPolicy.deny": { value: ["chapter.overwrite"], status: "current" },
          "mcp.servers": { value: [{ id: "github", url: "stdio://gh-mcp" }], status: "current" },
          "subagent.writer": { value: { modelId: "claude-sonnet-4", role: "writer" }, status: "current" },
          "workflow.write-next": { value: { steps: ["context", "pgi", "plan", "write"] }, status: "current" },
          "command./novel:write-next": { value: { handler: "novel-write-next", status: "current" }, status: "current" },
          "skill.continuity-audit": { value: { source: "builtin" }, status: "current" },
          "hook.onSessionStart": { value: { handler: "load-context" }, status: "planned" },
        },
      },
    ];

    const merged = mergeRuntimeSettings(layers);

    expect(Object.keys(merged)).toHaveLength(7);
    expect(merged["toolPolicy.deny"]?.value).toEqual(["chapter.overwrite"]);
    expect(merged["mcp.servers"]?.value).toEqual([{ id: "github", url: "stdio://gh-mcp" }]);
    expect(merged["hook.onSessionStart"]?.status).toBe("planned");
  });
});
