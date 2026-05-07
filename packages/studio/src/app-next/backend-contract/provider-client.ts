import type { ProviderRuntimeStatus, RuntimeModelPoolEntry, RuntimeProviderView } from "../../shared/provider-catalog";
import { PROVIDER_MODELS_API_PATH, PROVIDER_STATUS_API_PATH, PROVIDER_SUMMARY_API_PATH, buildProviderModelTestApiPath } from "./api-paths";
import type { ContractClient } from "./contract-client";

const PROVIDER_REDACTION_METADATA = {
  redaction: "provider-secret-fields-omitted",
  note: "Provider capability payloads intentionally expose runtime/model availability only; secret values remain redacted by backend contract.",
};

export function createProviderClient(contract: ContractClient) {
  return {
    getStatus: <T = { status: ProviderRuntimeStatus }>() => contract.get<T>(PROVIDER_STATUS_API_PATH, { capability: { id: "providers.status", status: "current" } }),
    listModels: <T = { models: readonly RuntimeModelPoolEntry[] }>() => contract.get<T>(PROVIDER_MODELS_API_PATH, { capability: { id: "providers.models", status: "current", metadata: PROVIDER_REDACTION_METADATA } }),
    getSummary: <T = { summary: Record<string, unknown> }>() => contract.get<T>(PROVIDER_SUMMARY_API_PATH, { capability: { id: "providers.summary", status: "current", metadata: PROVIDER_REDACTION_METADATA } }),
    testProviderModel: <T = { success: true; model?: RuntimeProviderView["models"][number] }>(providerId: string, modelId: string) =>
      contract.post<T>(buildProviderModelTestApiPath(providerId, modelId), undefined, {
        capability: { id: "providers.model.test", status: "current" },
      }),
  };
}
