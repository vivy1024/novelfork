import { describe, expect, it } from "vitest";
import type { UserConfig } from "../../types/settings.js";
import { createRuntimePermissionManager, getMCPToolDecision, getPermissionDecision } from "./runtime-tool-access.js";

function createRuntimeControls(
  overrides: Partial<UserConfig["runtimeControls"]> = {},
): Pick<UserConfig, "runtimeControls"> {
  return {
    runtimeControls: {
      defaultPermissionMode: "allow",
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
  it("keeps builtin prompt rules ahead of the runtime fallback", () => {
    const manager = createRuntimePermissionManager(createRuntimeControls());

    expect(getPermissionDecision(manager, "Write", {})).toEqual({
      action: "prompt",
      reason: undefined,
      source: "builtin-permission-rules",
      reasonKey: "builtin-write-prompt",
    });
    expect(getPermissionDecision(manager, "Edit", {})).toEqual({
      action: "prompt",
      reason: undefined,
      source: "builtin-permission-rules",
      reasonKey: "builtin-write-prompt",
    });
    expect(getPermissionDecision(manager, "Bash", { command: "rm -rf ./tmp" })).toEqual({
      action: "prompt",
      reason: "Potentially destructive command",
      source: "builtin-permission-rules",
      reasonKey: "builtin-bash-dangerous-prompt",
    });
    expect(getPermissionDecision(manager, "EnterWorktree", {})).toEqual({
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

  it("returns decision provenance for builtin and MCP policy checks", () => {
    const manager = createRuntimePermissionManager(createRuntimeControls());

    expect(getPermissionDecision(manager, "Write", {})).toEqual({
      action: "prompt",
      reason: undefined,
      source: "builtin-permission-rules",
      reasonKey: "builtin-write-prompt",
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
