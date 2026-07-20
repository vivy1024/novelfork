import {
  createRuntimeAdminRequest,
  encodePathSegment,
  type RuntimeAdminClientOptions,
} from "./client";
import type { RuntimeCustomApiProtocol } from "./settings";

export type RuntimeProviderModelFamily = "openai" | "anthropic" | "gemini";

export interface RuntimeProviderModel extends Readonly<Record<string, unknown>> {
  readonly id: string;
  readonly name?: string;
  readonly display_name?: string;
  readonly owned_by?: string;
}

export interface RuntimeProviderModelsRefreshResult {
  readonly models: readonly RuntimeProviderModel[];
  readonly fromCache: boolean;
  readonly resolvedBaseUrl?: string;
  readonly resolvedModelsUrl?: string;
}

export interface RefreshRuntimeProviderModelsInput {
  readonly providerId: string;
  readonly protocol: RuntimeCustomApiProtocol;
}

export interface RefreshRuntimeNugProviderModelsResult {
  readonly models: readonly RuntimeProviderModel[];
  readonly fromCache: boolean;
  readonly modelContextWindows?: Readonly<Record<string, number>>;
}

export function runtimeProviderModelFamily(
  protocol: RuntimeCustomApiProtocol,
): RuntimeProviderModelFamily {
  if (protocol === "anthropic-official" || protocol === "anthropic-compatible") {
    return "anthropic";
  }
  if (protocol === "gemini-compatible") return "gemini";
  return "openai";
}

export function createProviderModelsClient(options: RuntimeAdminClientOptions = {}) {
  const request = createRuntimeAdminRequest(options);
  return {
    refreshProviderModels: ({ providerId, protocol }: RefreshRuntimeProviderModelsInput) => {
      const family = runtimeProviderModelFamily(protocol);
      return request<RuntimeProviderModelsRefreshResult>(
        `/api/${family}/providers/${encodePathSegment(providerId)}/models/refresh`,
        { method: "POST" },
      );
    },
    refreshNugProviderModels: (providerId: string) =>
      request<RefreshRuntimeNugProviderModelsResult>(
        `/api/nug/providers/${encodePathSegment(providerId)}/models/refresh`,
        { method: "POST" },
      ),
  } as const;
}
