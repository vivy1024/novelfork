import type { ProviderApiMode, ProviderCompatibility, ProviderProtocol } from "@/shared/provider-catalog";

type RuntimeModelTestStatus = "untested" | "success" | "error" | "unsupported";
type RuntimePlatformAccountAuthMode = "json-account" | "local-auth-json" | "oauth" | "device-code";
type RuntimePlatformAccountStatus = "active" | "disabled" | "expired" | "error";

const PROVIDER_PROTOCOL_LABELS: Record<ProviderProtocol, string> = {
  completions: "Completions 兼容",
  responses: "Responses 兼容",
  anthropic: "Anthropic 兼容",
  codex: "Codex 中转",
  "claude-code": "Claude Code",
};

const PROVIDER_PROTOCOL_DESCRIPTIONS: Record<ProviderProtocol, string> = {
  completions: "DeepSeek、国产模型、本地模型（Ollama）",
  responses: "GPT-4o 及更新模型",
  anthropic: "Claude 官方/兼容网关，工具调用更稳定",
  codex: "GPT-5.x 系列，支持思维强度",
  "claude-code": "Claude 官方 API 完整特性（prompt caching）",
};

const PROVIDER_PROTOCOL_BADGE_COLORS: Record<ProviderProtocol, string> = {
  completions: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  responses: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  anthropic: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  codex: "bg-gray-100 text-gray-800 dark:bg-gray-800/50 dark:text-gray-300",
  "claude-code": "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
};

const PROVIDER_API_MODE_LABELS: Record<ProviderApiMode, string> = {
  completions: "Completions",
  responses: "Responses",
  codex: "Codex",
};

const PROVIDER_COMPATIBILITY_LABELS: Record<ProviderCompatibility, string> = {
  "openai-compatible": "OpenAI 兼容",
  "anthropic-compatible": "Anthropic 兼容",
};

const MODEL_TEST_STATUS_LABELS: Record<RuntimeModelTestStatus, string> = {
  untested: "未测试",
  success: "成功",
  error: "失败",
  unsupported: "不支持",
};

const PLATFORM_ACCOUNT_STATUS_LABELS: Record<RuntimePlatformAccountStatus, string> = {
  active: "正常",
  disabled: "停用",
  expired: "已过期",
  error: "异常",
};

const PLATFORM_ACCOUNT_AUTH_MODE_LABELS: Record<RuntimePlatformAccountAuthMode, string> = {
  "json-account": "JSON 账号",
  "local-auth-json": "本机认证文件",
  oauth: "浏览器授权",
  "device-code": "设备码授权",
};

const WORKFLOW_STATUS_LABELS: Record<string, string> = {
  running: "运行中",
  failed: "失败",
  completed: "已完成",
  pending: "等待中",
  idle: "空闲",
  success: "成功",
  error: "异常",
  disabled: "已停用",
};

const RUNTIME_POLICY_SOURCE_LABELS: Record<string, string> = {
  "runtimeControls.toolAccess": "工具访问策略",
  "runtimeControls.defaultPermissionMode": "默认权限模式",
  "runtimeControls.toolAccess.allowlist": "允许列表",
  "runtimeControls.toolAccess.blocklist": "拒绝列表",
  "runtimeControls.toolAccess.mcpStrategy": "MCP 默认策略",
  "runtimeControls.contextCompressionThresholdPercent": "上下文压缩阈值",
  "runtimeControls.contextTruncateTargetPercent": "上下文截断目标",
};

const INTERNAL_VIEW_LABELS: Record<string, string> = {
  BibleCategoryView: "经纬分类视图",
  BibleEntryEditor: "经纬条目",
  OutlineEditor: "大纲编辑器",
  PublishReportViewer: "发布报告",
  MarkdownViewer: "Markdown 文件",
  MaterialViewer: "素材文件",
};

export function providerApiModeLabel(value: ProviderApiMode | string | undefined): string {
  return value && value in PROVIDER_API_MODE_LABELS ? PROVIDER_API_MODE_LABELS[value as ProviderApiMode] : "未知接口模式";
}

export function providerCompatibilityLabel(value: ProviderCompatibility | string | undefined): string {
  return value && value in PROVIDER_COMPATIBILITY_LABELS ? PROVIDER_COMPATIBILITY_LABELS[value as ProviderCompatibility] : "未知兼容协议";
}

export function providerProtocolLabel(value: ProviderProtocol | string | undefined): string {
  return value && value in PROVIDER_PROTOCOL_LABELS ? PROVIDER_PROTOCOL_LABELS[value as ProviderProtocol] : "未知协议";
}

export function providerProtocolDescription(value: ProviderProtocol | string | undefined): string {
  return value && value in PROVIDER_PROTOCOL_DESCRIPTIONS ? PROVIDER_PROTOCOL_DESCRIPTIONS[value as ProviderProtocol] : "";
}

export function providerProtocolBadgeColor(value: ProviderProtocol | string | undefined): string {
  return value && value in PROVIDER_PROTOCOL_BADGE_COLORS ? PROVIDER_PROTOCOL_BADGE_COLORS[value as ProviderProtocol] : "bg-gray-100 text-gray-800";
}

export function modelTestStatusLabel(value: RuntimeModelTestStatus | string | undefined): string {
  return value && value in MODEL_TEST_STATUS_LABELS ? MODEL_TEST_STATUS_LABELS[value as RuntimeModelTestStatus] : "未知状态";
}

export function platformAccountStatusLabel(value: RuntimePlatformAccountStatus | string | undefined): string {
  return value && value in PLATFORM_ACCOUNT_STATUS_LABELS ? PLATFORM_ACCOUNT_STATUS_LABELS[value as RuntimePlatformAccountStatus] : "未知状态";
}

export function platformAccountAuthModeLabel(value: RuntimePlatformAccountAuthMode | string | undefined): string {
  return value && value in PLATFORM_ACCOUNT_AUTH_MODE_LABELS ? PLATFORM_ACCOUNT_AUTH_MODE_LABELS[value as RuntimePlatformAccountAuthMode] : "未知认证方式";
}

export function workflowStatusLabel(value: string | undefined): string {
  return value && value in WORKFLOW_STATUS_LABELS ? WORKFLOW_STATUS_LABELS[value] : "未知状态";
}

export function runtimePolicySourceLabel(value: string | undefined): string {
  return value && value in RUNTIME_POLICY_SOURCE_LABELS ? RUNTIME_POLICY_SOURCE_LABELS[value] : "运行策略";
}

export function internalViewLabel(value: string | undefined): string {
  return value && value in INTERNAL_VIEW_LABELS ? INTERNAL_VIEW_LABELS[value] : "资源视图";
}
