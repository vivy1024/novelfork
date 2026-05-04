import type { ProviderRuntimeStatus } from "../../lib/ai-gate";
import type { RuntimeModelPoolEntry } from "../../api/lib/runtime-model-pool";
import type { RuntimeProviderView } from "../../api/lib/provider-runtime-store";
import type { ContractClient } from "./contract-client";

const PROVIDER_REDACTION_METADATA = {
  redaction: "provider-secret-fields-omitted",
  note: "Provider capability payloads intentionally expose runtime/model availability only; secret values remain redacted by backend contract.",
};

export function createProviderClient(contract: ContractClient) {
  return {
    getStatus: <T = { status: ProviderRuntimeStatus }>() => contract.get<T>("/api/providers/status", { capability: { id: "providers.status", status: "current" } }),
    listModels: <T = { models: readonly RuntimeModelPoolEntry[] }>() => contract.get<T>("/api/providers/models", { capability: { id: "providers.models", status: "current", metadata: PROVIDER_REDACTION_METADATA } }),
    getSummary: <T = { summary: Record<string, unknown> }>() => contract.get<T>("/api/providers/summary", { capability: { id: "providers.summary", status: "current", metadata: PROVIDER_REDACTION_METADATA } }),
    testProviderModel: <T = { success: true; model?: RuntimeProviderView["models"][number] }>(providerId: string, modelId: string) =>
      contract.post<T>(`/api/providers/${encodeURIComponent(providerId)}/models/${encodeURIComponent(modelId)}/test`, undefined, {
        capability: { id: "providers.model.test", status: "current" },
      }),
  };
}
