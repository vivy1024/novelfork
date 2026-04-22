export type ToolAccessReasonKey =
  | "allowlist-allow"
  | "allowlist-deny"
  | "blocklist-deny"
  | "default-allow"
  | "default-prompt"
  | "default-deny"
  | "builtin-write-prompt"
  | "builtin-bash-dangerous-prompt"
  | "mcp-strategy-allow"
  | "mcp-strategy-prompt"
  | "mcp-strategy-deny"
  | "mcp-inherit-allow"
  | "mcp-inherit-prompt"
  | "mcp-inherit-deny"
  | "unknown";

export function describeToolAccessReason(reasonKey: ToolAccessReasonKey | undefined, reason?: string) {
  switch (reasonKey) {
    case "allowlist-allow":
      return "命中允许列表";
    case "allowlist-deny":
      return "未命中允许列表";
    case "blocklist-deny":
      return "命中阻止列表";
    case "default-allow":
      return "默认权限直接允许";
    case "default-prompt":
      return "默认权限要求确认";
    case "default-deny":
      return "默认权限拒绝";
    case "builtin-write-prompt":
      return "内置写类工具默认确认";
    case "builtin-bash-dangerous-prompt":
      return "危险 Bash 默认确认";
    case "mcp-strategy-allow":
      return "MCP 策略直接允许";
    case "mcp-strategy-prompt":
      return "MCP 策略要求确认";
    case "mcp-strategy-deny":
      return "MCP 策略拒绝";
    case "mcp-inherit-allow":
      return "MCP 继承默认允许";
    case "mcp-inherit-prompt":
      return "MCP 继承默认确认";
    case "mcp-inherit-deny":
      return "MCP 继承默认拒绝";
    default:
      return reason ?? "未说明原因";
  }
}

export const TOOL_ACCESS_GOVERNANCE_EXPLANATIONS = [
  "命中允许列表 → 直接允许",
  "未命中允许列表 → 拒绝",
  "命中阻止列表 → 拒绝",
  "MCP 策略 ask → 需确认",
] as const;

export type GovernanceSurface = "builtin" | "mcp";
export type GovernanceSourceKey = "allowlist" | "blocklist" | "default" | "builtin" | "mcpStrategy" | "unknown";

export function normalizeGovernanceSourceKey(source: string | undefined): GovernanceSourceKey {
  switch (source) {
    case "runtimeControls.toolAccess.allowlist":
      return "allowlist";
    case "runtimeControls.toolAccess.blocklist":
      return "blocklist";
    case "runtimeControls.defaultPermissionMode":
      return "default";
    case "builtin-permission-rules":
      return "builtin";
    case "runtimeControls.toolAccess.mcpStrategy":
      return "mcpStrategy";
    default:
      return "unknown";
  }
}
