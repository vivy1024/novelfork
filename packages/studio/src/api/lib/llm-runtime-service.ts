import type { SessionToolDefinition } from "../../shared/agent-native-workspace.js";
import type { NarratorSessionChatMessage, SessionConfig } from "../../shared/session-types.js";
import type { AgentTurnItem } from "./agent-turn-runtime.js";
import { getAggregation, isAggregationId, resolveAggregation } from "./model-aggregation-service.js";
import {
  createProviderAdapterRegistry,
  type ProviderAdapterRegistry,
  type RuntimeAdapterFailureCode,
  type RuntimeAdapterId,
  type RuntimeChatMessage,
  type RuntimeToolUse,
} from "./provider-adapters/index.js";
import { buildRuntimeModelPool } from "./runtime-model-pool.js";
import { ProviderRuntimeStore, type RuntimeProviderRecord } from "./provider-runtime-store.js";

export type LlmRuntimeFailureCode = RuntimeAdapterFailureCode | "model-unavailable" | "provider-unavailable" | "empty-response" | "unsupported-tools" | "all-providers-failed";

export interface LlmRuntimeMetadata {
  readonly providerId: string;
  readonly providerName: string;
  readonly modelId: string;
  readonly usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  readonly fallbackAttempts?: number;
}

export type LlmRuntimeGenerateResult =
  | { readonly success: true; readonly type: "message"; readonly content: string; readonly metadata: LlmRuntimeMetadata }
  | { readonly success: true; readonly type: "tool_use"; readonly toolUses: readonly RuntimeToolUse[]; readonly metadata: LlmRuntimeMetadata }
  | { readonly success: false; readonly code: LlmRuntimeFailureCode; readonly error: string; readonly metadata?: Partial<LlmRuntimeMetadata> };

export type LlmRuntimeInputMessage = NarratorSessionChatMessage | AgentTurnItem;

export interface LlmRuntimeGenerateInput {
  readonly sessionConfig: SessionConfig;
  readonly messages: readonly LlmRuntimeInputMessage[];
  readonly tools?: readonly SessionToolDefinition[];
  readonly onStreamChunk?: (chunk: string) => void;
  readonly signal?: AbortSignal;
}

export interface LlmRuntimeServiceOptions {
  readonly store?: ProviderRuntimeStore;
  readonly adapters?: ProviderAdapterRegistry;
}

function globalModelId(providerId: string, modelId: string): string {
  return providerId ? `${providerId}:${modelId}` : modelId;
}

function adapterIdForProvider(provider: RuntimeProviderRecord): RuntimeAdapterId {
  if (provider.id === "codex") return "codex-platform";
  if (provider.id === "kiro") return "kiro-platform";
  if (provider.compatibility === "anthropic-compatible") return "anthropic-compatible";
  return "openai-compatible";
}

function providerRef(provider: RuntimeProviderRecord) {
  const baseUrl = provider.baseUrl || (provider.config as Record<string, unknown> | undefined)?.baseUrl as string | undefined;
  return {
    providerId: provider.id,
    providerName: provider.name,
    ...(baseUrl ? { baseUrl } : {}),
    ...(provider.config?.apiKey ? { apiKey: provider.config.apiKey } : {}),
  };
}

function toRuntimeMessages(messages: readonly LlmRuntimeInputMessage[]): RuntimeChatMessage[] {
  return messages.flatMap((message): RuntimeChatMessage[] => {
    if ("type" in message) {
      if (message.type === "message") {
        if (message.content.trim().length === 0) return [];
        const reasoningContent = "reasoning_content" in message && typeof message.reasoning_content === "string" ? message.reasoning_content : undefined;
        return [{ role: message.role, content: message.content, ...(reasoningContent ? { reasoning_content: reasoningContent } : {}) }];
      }
      if (message.type === "tool_call") {
        return [{ role: "assistant", content: "", toolCalls: [{ id: message.id, name: message.name, input: message.input }] }];
      }
      return [{ role: "tool", toolCallId: message.toolCallId, name: message.name, content: message.content }];
    }

    if (message.role !== "user" && message.role !== "assistant" && message.role !== "system") {
      return [];
    }
    if (message.content.trim().length === 0) {
      return [];
    }
    const reasoningContent = "reasoning_content" in message && typeof message.reasoning_content === "string" ? message.reasoning_content : undefined;
    return [{ role: message.role, content: message.content, ...(reasoningContent ? { reasoning_content: reasoningContent } : {}) }];
  });
}

export class LlmRuntimeService {
  private readonly store: ProviderRuntimeStore;
  private readonly adapters: ProviderAdapterRegistry;

  constructor(options: LlmRuntimeServiceOptions = {}) {
    this.store = options.store ?? new ProviderRuntimeStore();
    this.adapters = options.adapters ?? createProviderAdapterRegistry();
  }

  async generate(input: LlmRuntimeGenerateInput): Promise<LlmRuntimeGenerateResult> {
    let providerId = input.sessionConfig.providerId?.trim();
    let modelId = input.sessionConfig.modelId?.trim();

    // 聚合模型解析：如果 modelId 匹配聚合 ID，解析为实际的 provider/model
    if (modelId && isAggregationId(modelId)) {
      const aggregation = await getAggregation(modelId);
      if (!aggregation) {
        return {
          success: false,
          code: "model-unavailable",
          error: `Aggregation not found: ${modelId}`,
          metadata: { providerId: providerId ?? "", modelId: modelId ?? "", providerName: "" },
        };
      }
      const resolved = await resolveAggregation(aggregation, { store: this.store });
      if (!resolved) {
        return {
          success: false,
          code: "model-unavailable",
          error: `No available member in aggregation: ${aggregation.displayName}`,
          metadata: { providerId: providerId ?? "", modelId: modelId ?? "", providerName: "" },
        };
      }
      providerId = resolved.providerId;
      modelId = resolved.modelId;
    }

    if (!providerId || !modelId) {
      return {
        success: false,
        code: "model-unavailable",
        error: "Session has no configured runtime model",
        metadata: { providerId: providerId ?? "", modelId: modelId ?? "", providerName: "" },
      };
    }

    const modelPool = await buildRuntimeModelPool(this.store);

    // Build candidate list: primary provider first, then fallback providers with the same model
    const candidates = this.buildFallbackCandidates(providerId, modelId, modelPool);

    if (candidates.length === 0) {
      return {
        success: false,
        code: "model-unavailable",
        error: `Runtime model is not available: ${globalModelId(providerId, modelId)}`,
        metadata: { providerId, modelId, providerName: "" },
      };
    }

    const requestedTools = input.tools?.length ? input.tools : undefined;
    const MAX_FALLBACK_ATTEMPTS = 3;
    let lastFailure: LlmRuntimeGenerateResult | undefined;

    for (let attempt = 0; attempt < Math.min(candidates.length, MAX_FALLBACK_ATTEMPTS); attempt++) {
      const candidate = candidates[attempt];

      if (requestedTools && candidate.capabilities.functionCalling !== true) {
        // Skip candidates that don't support tools
        continue;
      }

      const provider = await this.store.getProvider(candidate.providerId);
      if (!provider || provider.enabled === false) {
        continue;
      }

      const adapter = this.adapters.get(adapterIdForProvider(provider));
      const result = await adapter.generate({
        ...providerRef(provider),
        modelId: candidate.rawModelId,
        messages: toRuntimeMessages(input.messages),
        ...(requestedTools ? { tools: requestedTools } : {}),
        ...(input.onStreamChunk ? { onStreamChunk: input.onStreamChunk } : {}),
        ...(input.signal ? { signal: input.signal } : {}),
      });

      const metadata: LlmRuntimeMetadata = {
        providerId: candidate.providerId,
        providerName: candidate.providerName,
        modelId: candidate.rawModelId,
        ...(result.success && result.usage ? { usage: result.usage } : {}),
        ...(attempt > 0 ? { fallbackAttempts: attempt } : {}),
      };

      if (!result.success) {
        // Only fallback on network-error or upstream-error
        if (result.code === "network-error" || result.code === "upstream-error") {
          lastFailure = { success: false, code: result.code, error: result.error, metadata };
          continue;
        }
        // Non-retriable errors: return immediately
        return { success: false, code: result.code, error: result.error, metadata };
      }

      if (result.type === "tool_use") {
        return { success: true, type: "tool_use", toolUses: result.toolUses, metadata };
      }

      if (!result.content.trim()) {
        return { success: false, code: "empty-response", error: "LLM runtime returned an empty response", metadata };
      }

      return { success: true, type: "message", content: result.content, metadata };
    }

    // All candidates exhausted
    if (lastFailure) {
      return lastFailure;
    }

    return {
      success: false,
      code: "all-providers-failed",
      error: `All fallback providers failed for model: ${modelId}`,
      metadata: { providerId, modelId, providerName: "" },
    };
  }

  private buildFallbackCandidates(
    primaryProviderId: string,
    modelId: string,
    modelPool: Array<{ modelId: string; providerId: string; providerName: string; enabled: boolean; capabilities: { functionCalling: boolean; vision: boolean; streaming: boolean } }>,
  ): Array<{ providerId: string; providerName: string; rawModelId: string; capabilities: { functionCalling: boolean; vision: boolean; streaming: boolean } }> {
    const candidates: Array<{ providerId: string; providerName: string; rawModelId: string; capabilities: { functionCalling: boolean; vision: boolean; streaming: boolean } }> = [];

    // Primary provider first
    const primaryRef = globalModelId(primaryProviderId, modelId);
    const primaryEntry = modelPool.find((e) => e.modelId === primaryRef && e.enabled === true);
    if (primaryEntry) {
      candidates.push({
        providerId: primaryEntry.providerId,
        providerName: primaryEntry.providerName,
        rawModelId: modelId,
        capabilities: primaryEntry.capabilities,
      });
    }

    // Fallback: other providers that have the same model ID
    for (const entry of modelPool) {
      if (!entry.enabled) continue;
      if (entry.providerId === primaryProviderId) continue;
      // Extract raw model ID from the pool entry (format: "providerId:modelId")
      const rawId = entry.modelId.startsWith(`${entry.providerId}:`)
        ? entry.modelId.slice(entry.providerId.length + 1)
        : entry.modelId;
      if (rawId === modelId) {
        candidates.push({
          providerId: entry.providerId,
          providerName: entry.providerName,
          rawModelId: rawId,
          capabilities: entry.capabilities,
        });
      }
    }

    return candidates;
  }
}

const defaultLlmRuntimeService = new LlmRuntimeService();

export function createLlmRuntimeService(options: LlmRuntimeServiceOptions = {}): LlmRuntimeService {
  return new LlmRuntimeService(options);
}

export function generateSessionReply(input: LlmRuntimeGenerateInput): Promise<LlmRuntimeGenerateResult> {
  return defaultLlmRuntimeService.generate(input);
}
