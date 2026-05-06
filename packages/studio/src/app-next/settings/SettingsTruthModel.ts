export type SettingsFactGroup =
  | "profile"
  | "models"
  | "agent-runtime"
  | "appearance"
  | "providers"
  | "server"
  | "storage"
  | "runtime-resources"
  | "usage"
  | "about"
  | "parity";

export type SettingsFactSource =
  | "user-settings"
  | "provider-summary"
  | "model-inventory"
  | "platform-accounts"
  | "session-config"
  | "runtime-state"
  | "capability-matrix"
  | "narrafork-reference"
  | "claude-source-reference"
  | "default";

export type SettingsFactStatus = "current" | "partial" | "unconfigured" | "unsupported" | "planned" | "unknown";

export type SettingsFactVerifiedBy = "browser" | "unit" | "integration" | "manual-source";

export interface SettingsFact<T> {
  readonly id: string;
  readonly label: string;
  readonly value?: T;
  readonly group: SettingsFactGroup;
  readonly source: SettingsFactSource;
  readonly status: SettingsFactStatus;
  readonly writable: boolean;
  readonly readApi?: string;
  readonly writeApi?: string;
  readonly reason?: string;
  readonly verifiedBy?: SettingsFactVerifiedBy;
}

export interface ModelSettingsInput {
  readonly modelDefaults?: {
    readonly defaultSessionModel?: string;
    readonly summaryModel?: string;
    readonly exploreSubagentModel?: string;
    readonly planSubagentModel?: string;
    readonly generalSubagentModel?: string;
    readonly subagentModelPool?: readonly string[];
    readonly codexReasoningEffort?: string;
  };
  readonly runtimeControls?: {
    readonly defaultReasoningEffort?: string;
  };
}

export interface AgentRuntimeSettingsInput extends ModelSettingsInput {
  readonly runtimeControls?: ModelSettingsInput["runtimeControls"] & {
    readonly defaultPermissionMode?: string;
    readonly maxTurnSteps?: number;
    readonly contextCompressionThresholdPercent?: number;
    readonly contextTruncateTargetPercent?: number;
    readonly largeWindowCompressionThresholdPercent?: number;
    readonly largeWindowTruncateTargetPercent?: number;
    readonly recovery?: {
      readonly maxRetryAttempts?: number;
      readonly initialRetryDelayMs?: number;
      readonly maxRetryDelayMs?: number;
      readonly backoffMultiplier?: number;
    };
    readonly toolAccess?: {
      readonly mcpStrategy?: string;
      readonly allowlist?: readonly string[];
      readonly blocklist?: readonly string[];
    };
    readonly runtimeDebug?: {
      readonly tokenDebugEnabled?: boolean;
      readonly rateDebugEnabled?: boolean;
      readonly dumpEnabled?: boolean;
    };
    readonly sendMode?: string;
  };
  readonly proxy?: {
    readonly webFetch?: string;
  };
}

const USER_SETTINGS_API = "/api/settings/user";

function hasOwn(object: unknown, key: string) {
  return typeof object === "object" && object !== null && Object.prototype.hasOwnProperty.call(object, key);
}

function isConfigured(value: unknown) {
  if (Array.isArray(value)) return value.length > 0;
  return typeof value === "string" ? value.trim().length > 0 : value !== undefined && value !== null;
}

function userSettingsFact<T>({
  id,
  label,
  value,
  reason,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: T | undefined;
  readonly reason?: string;
}): SettingsFact<T> {
  const configured = isConfigured(value);
  return {
    id,
    label,
    value,
    group: "models",
    source: "user-settings",
    status: configured ? "current" : "unconfigured",
    writable: true,
    readApi: USER_SETTINGS_API,
    writeApi: USER_SETTINGS_API,
    reason: configured ? undefined : (reason ?? "用户设置尚未配置该字段"),
    verifiedBy: "unit",
  };
}

function agentRuntimeFact<T>({
  id,
  label,
  value,
  readApi = USER_SETTINGS_API,
  writeApi = USER_SETTINGS_API,
  reason,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: T | undefined;
  readonly readApi?: string;
  readonly writeApi?: string;
  readonly reason?: string;
}): SettingsFact<T> {
  const configured = Array.isArray(value) ? true : isConfigured(value);
  return {
    id,
    label,
    value,
    group: "agent-runtime",
    source: "user-settings",
    status: configured ? "current" : "unconfigured",
    writable: true,
    readApi,
    writeApi,
    reason: configured ? undefined : (reason ?? "用户设置尚未配置该字段"),
    verifiedBy: "unit",
  };
}

export function deriveModelSettingsFacts(config: ModelSettingsInput | null | undefined): Array<SettingsFact<string>> {
  const modelDefaults = config?.modelDefaults;
  const runtimeControls = config?.runtimeControls;
  const subagentPool = modelDefaults?.subagentModelPool ?? [];
  const facts: Array<SettingsFact<string>> = [
    userSettingsFact({ id: "model.defaultSessionModel", label: "默认模型", value: modelDefaults?.defaultSessionModel }),
    userSettingsFact({ id: "model.summaryModel", label: "摘要模型", value: modelDefaults?.summaryModel }),
    userSettingsFact({ id: "model.exploreSubagentModel", label: "Explore 子代理模型", value: modelDefaults?.exploreSubagentModel }),
    userSettingsFact({ id: "model.planSubagentModel", label: "Plan 子代理模型", value: modelDefaults?.planSubagentModel }),
  ];

  if (hasOwn(modelDefaults, "generalSubagentModel")) {
    facts.push(userSettingsFact({ id: "model.generalSubagentModel", label: "General 子代理模型", value: modelDefaults?.generalSubagentModel }));
  }

  if (hasOwn(modelDefaults, "codexReasoningEffort")) {
    facts.push(userSettingsFact({ id: "model.codexReasoningEffort", label: "Codex 推理强度", value: modelDefaults?.codexReasoningEffort }));
  }

  facts.push(
    userSettingsFact({ id: "model.subagentModelPool", label: "模型池限制", value: subagentPool.length ? `${subagentPool.length} 个` : undefined }),
    userSettingsFact({ id: "runtime.defaultReasoningEffort", label: "全局推理强度", value: runtimeControls?.defaultReasoningEffort }),
  );

  return facts;
}

export function deriveAgentRuntimeSettingsFacts(config: AgentRuntimeSettingsInput | null | undefined): Array<SettingsFact<unknown>> {
  const runtimeControls = config?.runtimeControls;
  const recovery = runtimeControls?.recovery;
  const toolAccess = runtimeControls?.toolAccess;
  const debug = runtimeControls?.runtimeDebug;

  return [
    agentRuntimeFact({ id: "runtime.defaultPermissionMode", label: "默认权限模式", value: runtimeControls?.defaultPermissionMode }),
    agentRuntimeFact({ id: "runtime.defaultReasoningEffort", label: "默认推理强度", value: runtimeControls?.defaultReasoningEffort }),
    agentRuntimeFact({ id: "runtime.maxTurnSteps", label: "最大轮次", value: runtimeControls?.maxTurnSteps }),
    agentRuntimeFact({ id: "runtime.contextCompressionThresholdPercent", label: "上下文压缩阈值 %", value: runtimeControls?.contextCompressionThresholdPercent }),
    agentRuntimeFact({ id: "runtime.contextTruncateTargetPercent", label: "上下文截断目标 %", value: runtimeControls?.contextTruncateTargetPercent }),
    agentRuntimeFact({ id: "runtime.largeWindowCompressionThresholdPercent", label: "大窗口压缩阈值 %", value: runtimeControls?.largeWindowCompressionThresholdPercent }),
    agentRuntimeFact({ id: "runtime.largeWindowTruncateTargetPercent", label: "大窗口截断目标 %", value: runtimeControls?.largeWindowTruncateTargetPercent }),
    agentRuntimeFact({ id: "runtime.recovery.maxRetryAttempts", label: "最大重试次数", value: recovery?.maxRetryAttempts }),
    agentRuntimeFact({ id: "runtime.recovery.initialRetryDelayMs", label: "初始重试延迟 ms", value: recovery?.initialRetryDelayMs }),
    agentRuntimeFact({ id: "runtime.recovery.maxRetryDelayMs", label: "退避上限 ms", value: recovery?.maxRetryDelayMs }),
    agentRuntimeFact({ id: "runtime.recovery.backoffMultiplier", label: "退避倍率", value: recovery?.backoffMultiplier }),
    {
      id: "runtime.firstTokenTimeoutMs",
      label: "首 token 超时",
      group: "agent-runtime",
      source: "capability-matrix",
      status: "planned",
      writable: false,
      reason: "NovelFork settings schema 尚无 first-token timeout 字段",
      verifiedBy: "unit",
    },
    agentRuntimeFact({ id: "runtime.proxy.webFetch", label: "WebFetch 代理", value: config?.proxy?.webFetch, readApi: "/api/proxy", writeApi: "/api/proxy" }),
    agentRuntimeFact({ id: "runtime.toolAccess.mcpStrategy", label: "MCP 工具策略", value: toolAccess?.mcpStrategy }),
    agentRuntimeFact({ id: "runtime.toolAccess.allowlist", label: "全局目录/命令白名单", value: toolAccess?.allowlist }),
    agentRuntimeFact({ id: "runtime.toolAccess.blocklist", label: "全局目录/命令黑名单", value: toolAccess?.blocklist }),
    agentRuntimeFact({ id: "runtime.debug.tokenUsage", label: "显示 Token 用量", value: debug?.tokenDebugEnabled }),
    agentRuntimeFact({ id: "runtime.debug.outputRate", label: "显示实时输出速率", value: debug?.rateDebugEnabled }),
    agentRuntimeFact({ id: "runtime.debug.dumpApiRequests", label: "Dump API 请求", value: debug?.dumpEnabled }),
    agentRuntimeFact({ id: "runtime.sendMode", label: "发送方式", value: runtimeControls?.sendMode }),
  ];
}

export function settingsFactDisplayValue(fact: SettingsFact<unknown>) {
  if (Array.isArray(fact.value)) return fact.value.length ? fact.value.join("、") : "空列表";
  if (typeof fact.value === "string") return fact.value.trim() ? fact.value : "未配置";
  if (fact.value === undefined || fact.value === null) return "未配置";
  return String(fact.value);
}

export function settingsFactSourceLabel(source: SettingsFactSource) {
  const labels: Record<SettingsFactSource, string> = {
    "user-settings": "用户设置",
    "provider-summary": "供应商总览",
    "model-inventory": "模型清单",
    "platform-accounts": "平台账号",
    "session-config": "会话配置",
    "runtime-state": "运行状态",
    "capability-matrix": "能力矩阵",
    "narrafork-reference": "NarraFork 参考",
    "claude-source-reference": "Claude 源码参考",
    default: "默认值",
  };
  return labels[source];
}

export function settingsFactStatusLabel(status: SettingsFactStatus) {
  const labels: Record<SettingsFactStatus, string> = {
    current: "已配置",
    partial: "部分接入",
    unconfigured: "未配置",
    unsupported: "未接入",
    planned: "计划中",
    unknown: "未确认",
  };
  return labels[status];
}
