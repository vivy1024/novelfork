import type { SessionPermissionMode } from "../../shared/session-types.js";
import type { ToolAccessReasonKey } from "../../shared/tool-access-reasons.js";
import type { ToolAccessSettings, UserConfig } from "../../types/settings.js";

export type { ToolAccessReasonKey } from "../../shared/tool-access-reasons.js";
import { DEFAULT_PERMISSION_RULES, PermissionManager, type PermissionRule } from "./permission-manager.js";

export type ToolAccessAction = "allow" | "deny" | "prompt";

export interface ToolAccessDecision {
  action: ToolAccessAction;
  reason?: string;
  source?: string;
  reasonKey: ToolAccessReasonKey;
}

const CONTEXT_READ_TOOLS = ["Read", "Glob", "Grep"] as const;
const CONTENT_EDIT_TOOLS = ["Read", "Glob", "Grep", "Write", "Edit"] as const;
const MUTATING_OR_SYSTEM_TOOLS = ["Write", "Edit", "Bash", "EnterWorktree", "ExitWorktree"] as const;

function toPermissionAction(mode: SessionPermissionMode): ToolAccessAction {
  switch (mode) {
    case "allow":
      return "allow";
    case "ask":
    case "edit":
      return "prompt";
    case "read":
    case "plan":
      return "deny";
  }
}

function buildDefaultModeRule(mode: SessionPermissionMode): PermissionRule {
  return {
    toolName: "*",
    action: toPermissionAction(mode),
    reason: `Tool falls back to defaultPermissionMode=${mode}`,
  };
}

function buildToolRules(
  toolNames: readonly string[],
  action: ToolAccessAction,
  reason: string,
): PermissionRule[] {
  return toolNames.map((toolName) => ({ toolName, action, reason }));
}

function buildSessionPermissionModeRules(mode: SessionPermissionMode): PermissionRule[] {
  switch (mode) {
    case "ask":
      return [buildDefaultModeRule(mode)];
    case "edit":
      return [
        ...buildToolRules(CONTENT_EDIT_TOOLS, "allow", "Tool is allowed by defaultPermissionMode=edit"),
        ...buildToolRules(["EnterWorktree", "ExitWorktree"], "prompt", "Worktree tool requires confirmation because defaultPermissionMode=edit"),
      ];
    case "allow":
      return [buildDefaultModeRule(mode)];
    case "read":
      return [
        ...buildToolRules(CONTEXT_READ_TOOLS, "allow", "Read-only tool is allowed by defaultPermissionMode=read"),
        ...buildToolRules(MUTATING_OR_SYSTEM_TOOLS, "deny", "Mutating tool is blocked by defaultPermissionMode=read"),
      ];
    case "plan":
      return [
        ...buildToolRules(CONTEXT_READ_TOOLS, "allow", "Context read is allowed by defaultPermissionMode=plan"),
        ...buildToolRules(MUTATING_OR_SYSTEM_TOOLS, "deny", "Planning mode blocks direct mutation via defaultPermissionMode=plan"),
      ];
  }
}

function inferDecisionSource(reason: string | undefined, fallback: string): string {
  if (!reason) {
    return fallback;
  }

  if (reason.includes("runtimeControls.toolAccess.allowlist")) {
    return "runtimeControls.toolAccess.allowlist";
  }
  if (reason.includes("runtimeControls.toolAccess.blocklist")) {
    return "runtimeControls.toolAccess.blocklist";
  }
  if (reason.includes("defaultPermissionMode")) {
    return "runtimeControls.defaultPermissionMode";
  }
  if (reason.includes("Potentially destructive command")) {
    return "builtin-permission-rules";
  }

  return fallback;
}

function inferDecisionReasonKey(
  action: ToolAccessAction,
  toolName: string,
  reason: string | undefined,
  source: string,
  isMcp: boolean,
): ToolAccessReasonKey {
  if (source === "runtimeControls.toolAccess.allowlist") {
    return action === "allow" ? "allowlist-allow" : "allowlist-deny";
  }

  if (source === "runtimeControls.toolAccess.blocklist") {
    return "blocklist-deny";
  }

  if (source === "builtin-permission-rules") {
    if (toolName === "Write" || toolName === "Edit") {
      return "builtin-write-prompt";
    }
    if (reason === "Potentially destructive command") {
      return "builtin-bash-dangerous-prompt";
    }
  }

  if (source === "runtimeControls.defaultPermissionMode") {
    if (isMcp) {
      return action === "allow"
        ? "mcp-inherit-allow"
        : action === "deny"
          ? "mcp-inherit-deny"
          : "mcp-inherit-prompt";
    }

    return action === "allow"
      ? "default-allow"
      : action === "deny"
        ? "default-deny"
        : "default-prompt";
  }

  if (source === "runtimeControls.toolAccess.mcpStrategy") {
    return action === "allow"
      ? "mcp-strategy-allow"
      : action === "deny"
        ? "mcp-strategy-deny"
        : "mcp-strategy-prompt";
  }

  return "unknown";
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

  manager.addRule(buildDefaultModeRule(defaultPermissionMode));
  manager.addRules(DEFAULT_PERMISSION_RULES);
  manager.addRules(buildSessionPermissionModeRules(defaultPermissionMode));
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
  const source = inferDecisionSource(rule?.reason, rule ? "builtin-permission-rules" : "runtimeControls.defaultPermissionMode");
  return {
    action,
    reason: rule?.reason,
    source,
    reasonKey: inferDecisionReasonKey(action, toolName, rule?.reason, source, false),
  };
}

export function getMCPToolDecision(
  toolName: string,
  runtimeControls: Pick<UserConfig["runtimeControls"], "defaultPermissionMode" | "toolAccess">,
): ToolAccessDecision {
  const toolAccess = runtimeControls.toolAccess;
  const blocklist = new Set(toolAccess.blocklist);
  if (blocklist.has(toolName)) {
    const source = "runtimeControls.toolAccess.blocklist";
    const reason = "MCP tool is blocked by runtimeControls.toolAccess.blocklist";
    return {
      action: "deny",
      reason,
      source,
      reasonKey: inferDecisionReasonKey("deny", toolName, reason, source, true),
    };
  }

  if (toolAccess.allowlist.length > 0) {
    const allowlist = new Set(toolAccess.allowlist);
    if (!allowlist.has(toolName)) {
      const source = "runtimeControls.toolAccess.allowlist";
      const reason = "MCP tool is not in runtimeControls.toolAccess.allowlist";
      return {
        action: "deny",
        reason,
        source,
        reasonKey: inferDecisionReasonKey("deny", toolName, reason, source, true),
      };
    }
  }

  if (toolAccess.mcpStrategy === "allow") {
    const source = "runtimeControls.toolAccess.mcpStrategy";
    const reason = "MCP tool is allowed by runtimeControls.toolAccess.mcpStrategy=allow";
    return {
      action: "allow",
      reason,
      source,
      reasonKey: inferDecisionReasonKey("allow", toolName, reason, source, true),
    };
  }

  if (toolAccess.mcpStrategy === "deny") {
    const source = "runtimeControls.toolAccess.mcpStrategy";
    const reason = "MCP tool is blocked by runtimeControls.toolAccess.mcpStrategy=deny";
    return {
      action: "deny",
      reason,
      source,
      reasonKey: inferDecisionReasonKey("deny", toolName, reason, source, true),
    };
  }

  if (toolAccess.mcpStrategy === "ask") {
    const source = "runtimeControls.toolAccess.mcpStrategy";
    const reason = "MCP tool requires confirmation because runtimeControls.toolAccess.mcpStrategy=ask";
    return {
      action: "prompt",
      reason,
      source,
      reasonKey: inferDecisionReasonKey("prompt", toolName, reason, source, true),
    };
  }

  const inheritedAction = toPermissionAction(runtimeControls.defaultPermissionMode);
  const source = "runtimeControls.defaultPermissionMode";
  const reason = `MCP tool inherits defaultPermissionMode=${runtimeControls.defaultPermissionMode}`;
  return {
    action: inheritedAction,
    reason,
    source,
    reasonKey: inferDecisionReasonKey(inheritedAction, toolName, reason, source, true),
  };
}
