import type { SessionPermissionMode } from "../../shared/session-types.js";
import type { RuntimeControlSettings, ToolAccessSettings, UserConfig } from "../../types/settings.js";
import { PermissionManager, createDefaultPermissionManager, type PermissionRule } from "./permission-manager.js";

export type ToolAccessAction = "allow" | "deny" | "prompt";

export interface ToolAccessDecision {
  action: ToolAccessAction;
  reason?: string;
}

function toPermissionAction(mode: SessionPermissionMode): ToolAccessAction {
  return mode === "ask" ? "prompt" : mode;
}

function buildAllowlistRules(toolAccess: ToolAccessSettings): PermissionRule[] {
  if (toolAccess.allowlist.length === 0) {
    return [];
  }

  return [
    {
      toolName: "*",
      action: "deny",
      reason: "Tool is not in runtimeControls.toolAccess.allowlist",
    },
    ...toolAccess.allowlist.map((toolName) => ({
      toolName,
      action: "allow" as const,
      reason: "Tool is explicitly allowed by runtimeControls.toolAccess.allowlist",
    })),
  ];
}

function buildBlocklistRules(toolAccess: ToolAccessSettings): PermissionRule[] {
  return toolAccess.blocklist.map((toolName) => ({
    toolName,
    action: "deny" as const,
    reason: "Tool is blocked by runtimeControls.toolAccess.blocklist",
  }));
}

export function createRuntimePermissionManager(userConfig: Pick<UserConfig, "runtimeControls">): PermissionManager {
  const manager = new PermissionManager();
  const { defaultPermissionMode, toolAccess } = userConfig.runtimeControls;

  manager.addRule({
    toolName: "*",
    action: toPermissionAction(defaultPermissionMode),
    reason: `Tool falls back to defaultPermissionMode=${defaultPermissionMode}`,
  });
  manager.addRules(DEFAULT_PERMISSION_RULES);
  manager.addRules(buildAllowlistRules(toolAccess));
  manager.addRules(buildBlocklistRules(toolAccess));

  return manager;
}

export function getPermissionDecision(
  manager: PermissionManager,
  toolName: string,
  params: Record<string, unknown>,
): ToolAccessDecision {
  const action = manager.checkPermission(toolName, params);
  const rule = manager.getMatchingRule(toolName, params);
  return {
    action,
    reason: rule?.reason,
  };
}

export function getMCPToolDecision(
  toolName: string,
  runtimeControls: Pick<RuntimeControlSettings, "defaultPermissionMode" | "toolAccess">,
): ToolAccessDecision {
  const toolAccess = runtimeControls.toolAccess;
  const blocklist = new Set(toolAccess.blocklist);
  if (blocklist.has(toolName)) {
    return {
      action: "deny",
      reason: "MCP tool is blocked by runtimeControls.toolAccess.blocklist",
    };
  }

  if (toolAccess.allowlist.length > 0) {
    const allowlist = new Set(toolAccess.allowlist);
    if (!allowlist.has(toolName)) {
      return {
        action: "deny",
        reason: "MCP tool is not in runtimeControls.toolAccess.allowlist",
      };
    }
  }

  if (toolAccess.mcpStrategy === "allow") {
    return {
      action: "allow",
      reason: "MCP tool is allowed by runtimeControls.toolAccess.mcpStrategy=allow",
    };
  }

  if (toolAccess.mcpStrategy === "deny") {
    return {
      action: "deny",
      reason: "MCP tool is blocked by runtimeControls.toolAccess.mcpStrategy=deny",
    };
  }

  if (toolAccess.mcpStrategy === "ask") {
    return {
      action: "prompt",
      reason: "MCP tool requires confirmation because runtimeControls.toolAccess.mcpStrategy=ask",
    };
  }

  const inheritedAction = toPermissionAction(runtimeControls.defaultPermissionMode);
  return {
    action: inheritedAction,
    reason: `MCP tool inherits defaultPermissionMode=${runtimeControls.defaultPermissionMode}`,
  };
}
