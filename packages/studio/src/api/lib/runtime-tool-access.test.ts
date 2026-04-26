import { describe, expect, it } from "vitest";
import type { UserConfig } from "../../types/settings.js";
import { createRuntimePermissionManager, getMCPToolDecision, getPermissionDecision } from "./runtime-tool-access.js";

function createRuntimeControls(
  overrides: Partial<UserConfig["runtimeControls"]> = {},
): Pick<UserConfig, "runtimeControls"> {
  return {
    runtimeControls: {
      defaultPermissionMode: "edit",
      defaultReasoningEffort: "medium",
      contextCompressionThresholdPercent: 80,
      contextTruncateTargetPercent: 70,
      recovery: {
        resumeOnStartup: true,
        maxRecoveryAttempts: 3,
        maxRetryAttempts: 5,
        initialRetryDelayMs: 1000,
        maxRetryDelayMs: 30000,
        backoffMultiplier: 2,
        jitterPercent: 20,
      },
      toolAccess: {
        allowlist: [],
        blocklist: [],
        mcpStrategy: "inherit",
      },
      runtimeDebug: {
        tokenDebugEnabled: false,
        rateDebugEnabled: false,
        dumpEnabled: false,
        traceEnabled: false,
        traceSampleRatePercent: 0,
      },
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
});
