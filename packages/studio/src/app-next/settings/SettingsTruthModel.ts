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
    readonly subagentModelPool?: readonly string[];
    readonly codexReasoningEffort?: string;
  };
  readonly runtimeControls?: {
    readonly defaultReasoningEffort?: string;
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

export function deriveModelSettingsFacts(config: ModelSettingsInput | null | undefined): Array<SettingsFact<string>> {
  const modelDefaults = config?.modelDefaults;
  const runtimeControls = config?.runtimeControls;
  const subagentPool = modelDefaults?.subagentModelPool ?? [];
  const exploreModel = modelDefaults?.exploreSubagentModel || subagentPool[0];
  const planModel = modelDefaults?.planSubagentModel || subagentPool[1];
  const facts: Array<SettingsFact<string>> = [
    userSettingsFact({ id: "model.defaultSessionModel", label: "默认模型", value: modelDefaults?.defaultSessionModel }),
    userSettingsFact({ id: "model.summaryModel", label: "摘要模型", value: modelDefaults?.summaryModel }),
    userSettingsFact({ id: "model.exploreSubagentModel", label: "Explore 子代理模型", value: exploreModel }),
    userSettingsFact({ id: "model.planSubagentModel", label: "Plan 子代理模型", value: planModel }),
    userSettingsFact({ id: "model.subagentModelPool", label: "模型池限制", value: subagentPool.length ? `${subagentPool.length} 个` : undefined }),
    userSettingsFact({ id: "runtime.defaultReasoningEffort", label: "全局推理强度", value: runtimeControls?.defaultReasoningEffort }),
  ];

  if (hasOwn(modelDefaults, "codexReasoningEffort")) {
    facts.push(userSettingsFact({ id: "model.codexReasoningEffort", label: "Codex 推理强度", value: modelDefaults?.codexReasoningEffort }));
  }

  return facts;
}

export function settingsFactDisplayValue(fact: SettingsFact<unknown>) {
  if (Array.isArray(fact.value)) return fact.value.length ? fact.value.join("、") : "未配置";
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
