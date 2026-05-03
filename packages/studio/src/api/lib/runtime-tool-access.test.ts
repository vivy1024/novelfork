import { describe, expect, it } from "vitest";
import type { UserConfig } from "../../types/settings.js";
import { DEFAULT_USER_CONFIG } from "../../types/settings.js";
import { createRuntimePermissionManager, getMCPToolDecision, getPermissionDecision, type RuntimeToolAccessConfig } from "./runtime-tool-access.js";

function createRuntimeControls(
  overrides: Partial<UserConfig["runtimeControls"]> = {},
): RuntimeToolAccessConfig {
  return {
    preferences: {
      workbenchMode: true,
    },
    runtimeControls: {
      ...DEFAULT_USER_CONFIG.runtimeControls,
      defaultPermissionMode: "edit",
      ...overrides,
    },
  };
}

describe("createRuntimePermissionManager", () => {
  it("maps product permission modes to concrete builtin tool decisions", () => {
    const editManager = createRuntimePermissionManager(createRuntimeControls());
    expect(getPermissionDecision(editManager, "Write", {})).toEqual({
      action: "allow",
      reason: "Tool is allowed by defaultPermissionMode=edit",
      source: "runtimeControls.defaultPermissionMode",
      reasonKey: "default-allow",
    });
    expect(getPermissionDecision(editManager, "Bash", { command: "printf ok" })).toEqual({
      action: "prompt",
      reason: "Tool falls back to defaultPermissionMode=edit",
      source: "runtimeControls.defaultPermissionMode",
      reasonKey: "default-prompt",
    });

    const readManager = createRuntimePermissionManager(createRuntimeControls({ defaultPermissionMode: "read" }));
    expect(getPermissionDecision(readManager, "Read", {})).toEqual({
      action: "allow",
      reason: "Read-only tool is allowed by defaultPermissionMode=read",
      source: "runtimeControls.defaultPermissionMode",
      reasonKey: "default-allow",
    });
    expect(getPermissionDecision(readManager, "Edit", {})).toEqual({
      action: "deny",
      reason: "Mutating tool is blocked by defaultPermissionMode=read",
      source: "runtimeControls.defaultPermissionMode",
      reasonKey: "default-deny",
    });

    const allowManager = createRuntimePermissionManager(createRuntimeControls({ defaultPermissionMode: "allow" }));
    expect(getPermissionDecision(allowManager, "Bash", { command: "rm -rf ./tmp" })).toEqual({
      action: "allow",
      reason: "Tool falls back to defaultPermissionMode=allow",
      source: "runtimeControls.defaultPermissionMode",
      reasonKey: "default-allow",
    });
  });

  it("blocks advanced engineering tools in author mode before default permissions are applied", () => {
    const manager = createRuntimePermissionManager({
      ...createRuntimeControls({ defaultPermissionMode: "allow" }),
      preferences: { workbenchMode: false },
    });

    expect(getPermissionDecision(manager, "Bash", { command: "printf ok" })).toEqual({
      action: "deny",
      reason: "作者模式隐藏高级工具：Bash。请开启高级工作台模式后再调用。",
      source: "preferences.workbenchMode",
      reasonKey: "workbench-mode-deny",
    });
  });

  it("lets runtime allowlist override builtin prompt rules", () => {
    const manager = createRuntimePermissionManager(
      createRuntimeControls({
        toolAccess: {
          allowlist: ["Write"],
          blocklist: [],
          mcpStrategy: "inherit",
        },
      }),
    );

    expect(getPermissionDecision(manager, "Write", {})).toEqual({
      action: "allow",
      reason: "Tool is explicitly allowed by runtimeControls.toolAccess.allowlist",
      source: "runtimeControls.toolAccess.allowlist",
      reasonKey: "allowlist-allow",
    });
  });

  it("returns decision provenance for planning and MCP policy checks", () => {
    const manager = createRuntimePermissionManager(createRuntimeControls({ defaultPermissionMode: "plan" }));

    expect(getPermissionDecision(manager, "Write", {})).toEqual({
      action: "deny",
      reason: "Planning mode blocks direct mutation via defaultPermissionMode=plan",
      source: "runtimeControls.defaultPermissionMode",
      reasonKey: "default-deny",
    });

    expect(
      getMCPToolDecision(
        "mcp.read_file",
        createRuntimeControls({
          defaultPermissionMode: "ask",
          toolAccess: {
            allowlist: [],
            blocklist: [],
            mcpStrategy: "allow",
          },
        }).runtimeControls,
      ),
    ).toEqual({
      action: "allow",
      reason: "MCP tool is allowed by runtimeControls.toolAccess.mcpStrategy=allow",
      source: "runtimeControls.toolAccess.mcpStrategy",
      reasonKey: "mcp-strategy-allow",
    });
  });

  it("allows write tools with prompt in plan mode when relaxedPlanning is enabled", () => {
    const manager = createRuntimePermissionManager(
      createRuntimeControls({ defaultPermissionMode: "plan", relaxedPlanning: true }),
    );

    expect(getPermissionDecision(manager, "Write", {})).toEqual({
      action: "prompt",
      reason: "Relaxed planning mode requires confirmation for mutation via defaultPermissionMode=plan+relaxedPlanning",
      source: "runtimeControls.defaultPermissionMode",
      reasonKey: "default-prompt",
    });
    expect(getPermissionDecision(manager, "Edit", {})).toEqual({
      action: "prompt",
      reason: "Relaxed planning mode requires confirmation for mutation via defaultPermissionMode=plan+relaxedPlanning",
      source: "runtimeControls.defaultPermissionMode",
      reasonKey: "default-prompt",
    });
    expect(getPermissionDecision(manager, "Read", {})).toEqual({
      action: "allow",
      reason: "Context read is allowed by defaultPermissionMode=plan",
      source: "runtimeControls.defaultPermissionMode",
      reasonKey: "default-allow",
    });
  });

  it("denies write tools in plan mode when relaxedPlanning is disabled", () => {
    const manager = createRuntimePermissionManager(
      createRuntimeControls({ defaultPermissionMode: "plan", relaxedPlanning: false }),
    );

    expect(getPermissionDecision(manager, "Write", {})).toEqual({
      action: "deny",
      reason: "Planning mode blocks direct mutation via defaultPermissionMode=plan",
      source: "runtimeControls.defaultPermissionMode",
      reasonKey: "default-deny",
    });
  });

  it("auto-approves read/edit tools in allow mode when yoloSkipReadonlyConfirmation is enabled", () => {
    const manager = createRuntimePermissionManager(
      createRuntimeControls({ defaultPermissionMode: "allow", yoloSkipReadonlyConfirmation: true }),
    );

    expect(getPermissionDecision(manager, "Read", {})).toEqual({
      action: "allow",
      reason: "YOLO mode auto-approves read/draft-write tools in allow mode",
      source: "runtimeControls.defaultPermissionMode",
      reasonKey: "default-allow",
    });
    expect(getPermissionDecision(manager, "Write", {})).toEqual({
      action: "allow",
      reason: "YOLO mode auto-approves read/draft-write tools in allow mode",
      source: "runtimeControls.defaultPermissionMode",
      reasonKey: "default-allow",
    });
    expect(getPermissionDecision(manager, "Edit", {})).toEqual({
      action: "allow",
      reason: "YOLO mode auto-approves read/draft-write tools in allow mode",
      source: "runtimeControls.defaultPermissionMode",
      reasonKey: "default-allow",
    });
    // Bash should still be allowed in allow mode (not affected by YOLO specifically)
    expect(getPermissionDecision(manager, "Bash", { command: "rm -rf ./tmp" })).toEqual({
      action: "allow",
      reason: "Tool falls back to defaultPermissionMode=allow",
      source: "runtimeControls.defaultPermissionMode",
      reasonKey: "default-allow",
    });
  });

  it("does not apply yolo rules when permission mode is not allow", () => {
    const manager = createRuntimePermissionManager(
      createRuntimeControls({ defaultPermissionMode: "edit", yoloSkipReadonlyConfirmation: true }),
    );

    // In edit mode, Write/Edit are allowed by edit rules, not YOLO
    expect(getPermissionDecision(manager, "Write", {})).toEqual({
      action: "allow",
      reason: "Tool is allowed by defaultPermissionMode=edit",
      source: "runtimeControls.defaultPermissionMode",
      reasonKey: "default-allow",
    });
  });
});
