import { useState } from "react";

import type { SessionPermissionMode, SessionReasoningEffort } from "../../../shared/session-types";

export interface ConversationModelOption {
  providerId: string;
  providerLabel?: string;
  modelId: string;
  modelLabel?: string;
  supportsTools?: boolean;
}

export interface ConversationUsage {
  input_tokens?: number;
  output_tokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
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
  modelOptions?: readonly ConversationModelOption[];
  unsupportedToolsReason?: string;
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

function formatTokens(usage?: ConversationUsage) {
  const total = usage?.totalTokens ?? ((usage?.promptTokens ?? usage?.input_tokens ?? 0) + (usage?.completionTokens ?? usage?.output_tokens ?? 0));
  return `Tokens：${total}`;
}

export function ConversationStatusBar({ status, onUpdateSessionConfig = () => undefined }: ConversationStatusBarProps) {
  const [updateError, setUpdateError] = useState<string | null>(null);
  const selectedModel = status.modelOptions?.find((option) => option.providerId === status.providerId && option.modelId === status.modelId);
  const toolsUnsupported = selectedModel?.supportsTools === false || Boolean(status.unsupportedToolsReason);

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
      {status.usage ? <span>{formatTokens(status.usage)}</span> : null}

      {status.modelOptions?.length ? (
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

      {status.permissionMode ? (
        <label>
          权限
          <select aria-label="权限" value={status.permissionMode} onChange={(event) => void updateSessionConfig({ permissionMode: event.currentTarget.value as SessionPermissionMode })}>
            {PERMISSION_OPTIONS.map((mode) => (
              <option key={mode} value={mode}>{PERMISSION_LABELS[mode]}</option>
            ))}
          </select>
        </label>
      ) : null}

      {status.reasoningEffort ? (
        <label>
          推理强度
          <select aria-label="推理强度" value={status.reasoningEffort} onChange={(event) => void updateSessionConfig({ reasoningEffort: event.currentTarget.value as SessionReasoningEffort })}>
            {REASONING_OPTIONS.map((effort) => (
              <option key={effort} value={effort}>{effort}</option>
            ))}
          </select>
        </label>
      ) : null}

      {toolsUnsupported ? <span data-testid="unsupported-tools-notice">{status.unsupportedToolsReason ?? "当前模型不支持工具调用"}</span> : null}
      {updateError ? <span data-testid="status-update-error">{updateError}</span> : null}
    </div>
  );
}
