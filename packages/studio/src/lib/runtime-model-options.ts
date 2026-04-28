export interface RuntimeModelOption {
  readonly modelId: string;
  readonly modelName: string;
  readonly providerId?: string;
  readonly providerName: string;
  readonly enabled?: boolean;
  readonly contextWindow?: number;
  readonly maxOutputTokens?: number;
  readonly source?: string;
  readonly lastTestStatus?: string;
  readonly capabilities?: Record<string, boolean>;
}

export interface RuntimeModelSelection {
  readonly providerId: string;
  readonly modelId: string;
  readonly modelRef: string;
}

export function usableRuntimeModels(models: readonly RuntimeModelOption[] | undefined): RuntimeModelOption[] {
  return (models ?? []).filter((model) => model.enabled !== false);
}

export function runtimeModelLabel(model: RuntimeModelOption): string {
  return `${model.providerName} · ${model.modelName}`;
}

export function splitRuntimeModelRef(model: Pick<RuntimeModelOption, "modelId" | "providerId">): RuntimeModelSelection {
  const separatorIndex = model.modelId.indexOf(":");
  const providerId = model.providerId?.trim() || (separatorIndex > 0 ? model.modelId.slice(0, separatorIndex) : "");
  const prefix = `${providerId}:`;
  const rawModelId = providerId && model.modelId.startsWith(prefix)
    ? model.modelId.slice(prefix.length)
    : model.modelId;

  return {
    providerId,
    modelId: rawModelId,
    modelRef: providerId ? `${providerId}:${rawModelId}` : rawModelId,
  };
}

export function runtimeModelRef(providerId: string, modelId: string): string {
  return providerId ? `${providerId}:${modelId}` : modelId;
}

export function findRuntimeModelByRef(
  models: readonly RuntimeModelOption[],
  modelRef: string,
): RuntimeModelOption | undefined {
  return models.find((model) => splitRuntimeModelRef(model).modelRef === modelRef || model.modelId === modelRef);
}
