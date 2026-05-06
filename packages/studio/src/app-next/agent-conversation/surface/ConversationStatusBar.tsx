import { useState } from "react";

import type { SessionPermissionMode, SessionReasoningEffort, SessionToolPolicy } from "../../../shared/session-types";

export interface ConversationModelOption {
  providerId: string;
  providerLabel?: string;
  modelId: string;
  modelLabel?: string;
  supportsTools?: boolean;
  supportsReasoning?: boolean;
}

export interface ConversationBindingFact {
  label: string;
  worktree?: string;
}

export interface ConversationWorkspaceFact {
  path?: string;
  git?:
    | { status: "clean"; summary?: string }
    | { status: "dirty"; summary: string }
    | { status: "unavailable"; reason: string };
}

export interface ConversationUsageBucket {
  input_tokens?: number;
  output_tokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface ConversationCostSummary {
  status: "unknown" | "known";
  amount?: number | null;
  currency?: string;
}

export interface ConversationUsage extends ConversationUsageBucket {
  currentTurn?: ConversationUsageBucket;
  cumulative?: ConversationUsageBucket;
  cost?: ConversationCostSummary;
}

export interface ConversationStatus {
  state: string;
  label: string;
  providerId?: string;
  providerLabel?: string;
  modelId?: string;
  modelLabel?: string;
  permissionMode?: SessionPermissionMode;
  reasoningEffort?: SessionReasoningEffort;
  usage?: ConversationUsage;
  messageCount?: number;
  binding?: ConversationBindingFact;
  workspace?: ConversationWorkspaceFact;
  modelOptions?: readonly ConversationModelOption[];
  toolPolicySummary?: SessionToolPolicy;
  unsupportedToolsReason?: string;
  reasoningUnsupportedReason?: string;
  permissionModeDisabledReasons?: Partial<Record<SessionPermissionMode, string>>;
  sessionConfigLoaded?: boolean;
}

export interface ConversationSessionConfigPatch {
  providerId?: string;
  modelId?: string;
  permissionMode?: SessionPermissionMode;
  reasoningEffort?: SessionReasoningEffort;
}

export interface ConversationStatusBarProps {
  status: ConversationStatus;
  onUpdateSessionConfig?: (patch: ConversationSessionConfigPatch) => Promise<void> | void;
}

const PERMISSION_LABELS: Record<SessionPermissionMode, string> = {
  ask: "询问",
  edit: "编辑",
  allow: "允许",
  read: "只读",
  plan: "计划",
};

const PERMISSION_OPTIONS: readonly SessionPermissionMode[] = ["ask", "edit", "allow", "read", "plan"];
const REASONING_OPTIONS: readonly SessionReasoningEffort[] = ["low", "medium", "high"];

function optionValue(option: ConversationModelOption) {
  return `${option.providerId}::${option.modelId}`;
}

function formatModelLabel(status: ConversationStatus) {
  const provider = status.providerLabel ?? status.providerId;
  const model = status.modelLabel ?? status.modelId;
  if (provider && model) return `${provider} / ${model}`;
  return model ?? provider ?? "未选择模型";
}

function tokenTotal(usage?: ConversationUsageBucket): number {
  return usage?.totalTokens ?? ((usage?.promptTokens ?? usage?.input_tokens ?? 0) + (usage?.completionTokens ?? usage?.output_tokens ?? 0));
}

function formatCost(cost?: ConversationCostSummary): string | null {
  if (!cost) return null;
  if (cost.status === "unknown") return "成本 未知";
  if (typeof cost.amount === "number") return `成本 ${cost.currency ?? "USD"} ${cost.amount}`;
  return null;
}

function formatTokens(usage?: ConversationUsage) {
  if (!usage) return "Tokens：0";
  const parts: string[] = [];
  if (usage.currentTurn) parts.push(`当前 ${tokenTotal(usage.currentTurn)}`);
  if (usage.cumulative) parts.push(`累计 ${tokenTotal(usage.cumulative)}`);
  const cost = formatCost(usage.cost);
  if (cost) parts.push(cost);
  if (parts.length > 0) return `Tokens：${parts.join(" / ")}`;
  return `Tokens：${tokenTotal(usage)}`;
}

function formatPolicyList(label: string, values?: readonly string[]): string | null {
  return values?.length ? `${label}：${values.join("、")}` : null;
}

function formatToolPolicySummary(policy?: SessionToolPolicy): string | null {
  const parts = [
    formatPolicyList("可用", policy?.allow),
    formatPolicyList("禁用", policy?.deny),
    formatPolicyList("询问", policy?.ask),
  ].filter((part): part is string => Boolean(part));
  return parts.length ? parts.join("；") : null;
}

function formatGitFact(git?: ConversationWorkspaceFact["git"]): string | null {
  if (!git) return null;
  if (git.status === "clean") return `Git：${git.summary ?? "干净"}`;
  if (git.status === "dirty") return `Git：${git.summary}`;
  return `Git：不可用（${git.reason}）`;
}

export function ConversationStatusBar({ status, onUpdateSessionConfig = () => undefined }: ConversationStatusBarProps) {
  const [updateError, setUpdateError] = useState<string | null>(null);
  const selectedModel = status.modelOptions?.find((option) => option.providerId === status.providerId && option.modelId === status.modelId);
  const toolsUnsupported = selectedModel?.supportsTools === false || Boolean(status.unsupportedToolsReason);
  const toolPolicySummary = formatToolPolicySummary(status.toolPolicySummary);
  const sessionConfigLoaded = status.sessionConfigLoaded ?? Boolean(status.providerId || status.modelId || status.permissionMode || status.reasoningEffort);
  const gitFact = formatGitFact(status.workspace?.git);
  const reasoningDisabled = Boolean(status.reasoningUnsupportedReason || selectedModel?.supportsReasoning === false);

  async function updateSessionConfig(patch: ConversationSessionConfigPatch) {
    setUpdateError(null);
    try {
      await onUpdateSessionConfig(patch);
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="conversation-status-bar" data-testid="conversation-status-bar">
      <span>{status.label}</span>
      <span>{formatModelLabel(status)}</span>
      {status.permissionMode ? <span>权限：{PERMISSION_LABELS[status.permissionMode]}</span> : null}
      {status.reasoningEffort ? <span>推理：{status.reasoningEffort}</span> : null}
      {typeof status.messageCount === "number" ? <span>消息：{status.messageCount}</span> : null}
      {status.binding?.label ? <span>绑定：{status.binding.label}</span> : null}
      {status.workspace?.path ? <span>工作区：{status.workspace.path}</span> : null}
      {gitFact ? <span>{gitFact}</span> : null}
      {status.usage ? <span>{formatTokens(status.usage)}</span> : null}
      {toolPolicySummary ? <span data-testid="tool-policy-summary">工具策略：{toolPolicySummary}</span> : null}
      {!sessionConfigLoaded ? <span>session config 未加载：未配置会话模型</span> : null}

      {sessionConfigLoaded && status.modelOptions?.length ? (
        <label>
          模型
          <select
            aria-label="模型"
            value={status.providerId && status.modelId ? `${status.providerId}::${status.modelId}` : ""}
            onChange={(event) => {
              const next = status.modelOptions?.find((option) => optionValue(option) === event.currentTarget.value);
              if (next) void updateSessionConfig({ providerId: next.providerId, modelId: next.modelId });
            }}
          >
            {status.modelOptions.map((option) => (
              <option key={optionValue(option)} value={optionValue(option)}>
                {(option.providerLabel ?? option.providerId)} / {(option.modelLabel ?? option.modelId)}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {sessionConfigLoaded && status.permissionMode ? (
        <label>
          权限
          <select aria-label="权限" value={status.permissionMode} onChange={(event) => void updateSessionConfig({ permissionMode: event.currentTarget.value as SessionPermissionMode })}>
            {PERMISSION_OPTIONS.map((mode) => (
              <option key={mode} value={mode} disabled={Boolean(status.permissionModeDisabledReasons?.[mode])}>{PERMISSION_LABELS[mode]}</option>
            ))}
          </select>
        </label>
      ) : null}

      {sessionConfigLoaded && status.reasoningEffort ? (
        <label>
          推理强度
          <select aria-label="推理强度" value={status.reasoningEffort} disabled={reasoningDisabled} onChange={(event) => void updateSessionConfig({ reasoningEffort: event.currentTarget.value as SessionReasoningEffort })}>
            {REASONING_OPTIONS.map((effort) => (
              <option key={effort} value={effort}>{effort}</option>
            ))}
          </select>
        </label>
      ) : null}

      {toolsUnsupported ? <span data-testid="unsupported-tools-notice">{status.unsupportedToolsReason ?? "当前模型不支持工具调用"}</span> : null}
      {status.reasoningUnsupportedReason ? <span data-testid="reasoning-unsupported-notice">{status.reasoningUnsupportedReason}</span> : null}
      {Object.entries(status.permissionModeDisabledReasons ?? {}).map(([mode, reason]) => reason ? <span key={mode}>{reason}</span> : null)}
      {updateError ? <span data-testid="status-update-error">{updateError}</span> : null}
    </div>
  );
}
