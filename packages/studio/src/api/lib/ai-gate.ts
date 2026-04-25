export type AiAction =
  | "ai-writing"
  | "ai-rewrite"
  | "ai-review"
  | "generate-jingwei"
  | "deep-ai-taste-scan"
  | "workbench-agent";

export interface ProviderRuntimeStatus {
  readonly hasUsableModel: boolean;
  readonly defaultProvider?: string;
  readonly defaultModel?: string;
  readonly lastConnectionError?: string;
}

export type AiGateResult =
  | {
      readonly ok: true;
      readonly action: AiAction;
      readonly provider?: string;
      readonly model?: string;
    }
  | {
      readonly ok: false;
      readonly action: AiAction;
      readonly reason: "model-not-configured";
      readonly message: string;
      readonly defaultProvider?: string;
      readonly defaultModel?: string;
      readonly lastConnectionError?: string;
    };

export function requireModelForAiAction(
  action: AiAction,
  status: ProviderRuntimeStatus,
): AiGateResult {
  if (status.hasUsableModel) {
    return {
      ok: true,
      action,
      provider: status.defaultProvider,
      model: status.defaultModel,
    };
  }

  return {
    ok: false,
    action,
    reason: "model-not-configured",
    message: "此功能需要配置 AI 模型。你可以先配置模型，也可以继续使用本地写作功能。",
    ...(status.defaultProvider ? { defaultProvider: status.defaultProvider } : {}),
    ...(status.defaultModel ? { defaultModel: status.defaultModel } : {}),
    ...(status.lastConnectionError ? { lastConnectionError: status.lastConnectionError } : {}),
  };
}
