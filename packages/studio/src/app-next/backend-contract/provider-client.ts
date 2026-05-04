import type { ContractClient } from "./contract-client";

export function createProviderClient(contract: ContractClient) {
  return {
    getStatus: () => contract.get("/api/providers/status", { capability: { id: "providers.status", status: "current" } }),
    listModels: () => contract.get("/api/providers/models", { capability: { id: "providers.models", status: "current" } }),
    getSummary: () => contract.get("/api/providers/summary", { capability: { id: "providers.summary", status: "current" } }),
    testProviderModel: (providerId: string, modelId: string) =>
      contract.post(`/api/providers/${encodeURIComponent(providerId)}/models/${encodeURIComponent(modelId)}/test`, undefined, {
        capability: { id: "providers.model.test", status: "current" },
      }),
  };
}
