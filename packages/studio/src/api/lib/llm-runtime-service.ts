import type { SessionToolDefinition } from "../../shared/agent-native-workspace.js";
import type { NarratorSessionChatMessage, SessionConfig } from "../../shared/session-types.js";
import type { RetryRule, RuntimeRecoverySettings } from "../../types/settings.js";
import type { AgentTurnItem } from "./agent-turn-runtime.js";
import { getAggregation, isAggregationId, resolveAggregation } from "./model-aggregation-service.js";
import {
  createProviderAdapterRegistry,
  type ProviderAdapterRegistry,
  type RuntimeAdapterFailureCode,
  type RuntimeAdapterId,
  type RuntimeChatMessage,
  type RuntimeToolUse,
  type RuntimeToolStreamEvent,
} from "./provider-adapters/index.js";
import { getAdapterForProtocol } from "./provider-adapters/registry.js";
import { detectModelProvider } from "./provider-adapters/model-transforms.js";
import { buildRuntimeModelPool } from "./runtime-model-pool.js";
import { ProviderRuntimeStore, type RuntimeProviderRecord } from "./provider-runtime-store.js";
import { inferProtocol } from "../../shared/provider-catalog.js";
import { loadUserConfig } from "./user-config-service.js";

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
  readonly onToolEvent?: (event: RuntimeToolStreamEvent) => void;
  readonly onRetry?: (attempt: number, maxAttempts: number) => void;
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
  // Legacy routing — kept for backward compatibility
  if (provider.id === "codex") return "codex-platform";
  if (provider.id === "kiro") return "kiro-platform";
  if (provider.compatibility === "anthropic-compatible") return "anthropic-compatible";
  return "openai-compatible";
}

/** 获取 provider 对应的 adapter（优先使用 protocol 路由） */
function getAdapter(provider: RuntimeProviderRecord, legacyAdapters?: ProviderAdapterRegistry) {
  if (legacyAdapters) {
    return legacyAdapters.get(adapterIdForProvider(provider));
  }
  const protocol = inferProtocol(provider);
  return getAdapterForProtocol(protocol);
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
  const result: RuntimeChatMessage[] = [];
  let pendingReasoning: string | undefined;
  let pendingSignature: string | undefined;

  for (const message of messages) {
    if ("type" in message) {
      if (message.type === "message") {
        const reasoningContent = "reasoning_content" in message && typeof message.reasoning_content === "string" ? message.reasoning_content : undefined;
        const reasoningSignature = "reasoning_signature" in message && typeof message.reasoning_signature === "string" ? message.reasoning_signature : undefined;
        // If this is an empty assistant message with only reasoning_content,
        // hold it as pending — it will be merged into the next tool_call message
        if (message.role === "assistant" && message.content.trim().length === 0 && reasoningContent) {
          pendingReasoning = reasoningContent;
          pendingSignature = reasoningSignature;
          continue;
        }
        if (message.content.trim().length === 0 && !reasoningContent) continue;
        result.push({ role: message.role, content: message.content, ...(reasoningContent ? { reasoning_content: reasoningContent } : {}), ...(reasoningSignature ? { reasoning_signature: reasoningSignature } : {}) });
        continue;
      }
      if (message.type === "tool_call") {
        // Merge consecutive tool_calls into a single assistant message with multiple toolCalls
        // (required by Claude API: one assistant message can have multiple tool_use blocks)
        const lastMsg = result[result.length - 1];
        if (lastMsg && lastMsg.role === "assistant" && lastMsg.toolCalls && lastMsg.toolCalls.length > 0) {
          // Replace last message with expanded toolCalls array; also attach pending reasoning if present
          const mergedReasoning = pendingReasoning ?? lastMsg.reasoning_content;
          const mergedSignature = pendingSignature ?? lastMsg.reasoning_signature;
          result[result.length - 1] = { ...lastMsg, toolCalls: [...lastMsg.toolCalls, { id: message.id, name: message.name, input: message.input }], ...(mergedReasoning ? { reasoning_content: mergedReasoning } : {}), ...(mergedSignature ? { reasoning_signature: mergedSignature } : {}) };
        } else {
          result.push({ role: "assistant", content: "", toolCalls: [{ id: message.id, name: message.name, input: message.input }], ...(pendingReasoning ? { reasoning_content: pendingReasoning } : {}), ...(pendingSignature ? { reasoning_signature: pendingSignature } : {}) });
        }
        pendingReasoning = undefined;
        pendingSignature = undefined;
        continue;
      }
      if (message.type === "tool_result") {
        result.push({ role: "tool", toolCallId: message.toolCallId, name: message.name, content: message.content });
        continue;
      }
      continue;
    }

    if (message.role !== "user" && message.role !== "assistant" && message.role !== "system") {
      continue;
    }
    if (message.content.trim().length === 0) {
      continue;
    }
    const reasoningContent = "reasoning_content" in message && typeof message.reasoning_content === "string" ? message.reasoning_content : undefined;
    result.push({ role: message.role, content: message.content, ...(reasoningContent ? { reasoning_content: reasoningContent } : {}) });
  }

  // If there's leftover pending reasoning (no tool_call followed), emit it
  if (pendingReasoning) {
    result.push({ role: "assistant", content: "", reasoning_content: pendingReasoning, ...(pendingSignature ? { reasoning_signature: pendingSignature } : {}) });
  }

  return result;
}

/**
 * Strip reasoning_content/reasoning_signature from all messages.
 * Used when the target model doesn't support thinking or when switching
 * between incompatible thinking-mode providers (DeepSeek ↔ Claude ↔ Codex).
 *
 * This prevents "thinking must be passed back" errors when conversation
 * history contains thinking from a different provider.
 */
function stripReasoningFromMessages(messages: RuntimeChatMessage[]): RuntimeChatMessage[] {
  return messages.map((msg) => {
    if (msg.role === "tool") return msg;
    if (!msg.reasoning_content && !msg.reasoning_signature) return msg;
    const { reasoning_content, reasoning_signature, ...rest } = msg;
    // If the message was only reasoning (empty content, no toolCalls), skip it entirely
    if (!rest.content?.trim() && !rest.toolCalls?.length) return null;
    return rest as RuntimeChatMessage;
  }).filter((msg): msg is RuntimeChatMessage => msg !== null);
}

// --- Smart Retry Helpers ---

function isRetriableError(code: RuntimeAdapterFailureCode, errorMessage: string, customRules?: RetryRule[]): boolean {
  if (code !== "upstream-error" && code !== "network-error") return false;
  // Built-in retriable patterns
  const retriableStatuses = ["429", "502", "503", "rate_limit", "rate limit", "overloaded"];
  if (retriableStatuses.some(s => errorMessage.toLowerCase().includes(s.toLowerCase()))) {
    return true;
  }
  // User-defined custom retry rules
  if (customRules?.length) {
    const lowerMsg = errorMessage.toLowerCase();
    for (const rule of customRules) {
      if (!rule.enabled) continue;
      const matchesStatus = rule.httpStatus ? errorMessage.includes(rule.httpStatus) : false;
      const matchesKeyword = rule.contentKeyword ? lowerMsg.includes(rule.contentKeyword.toLowerCase()) : false;
      // Rule matches if at least one criterion is specified and all specified criteria match
      if (rule.httpStatus && rule.contentKeyword) {
        if (matchesStatus && matchesKeyword) return true;
      } else if (rule.httpStatus) {
        if (matchesStatus) return true;
      } else if (rule.contentKeyword) {
        if (matchesKeyword) return true;
      }
    }
  }
  return false;
}

function calculateRetryDelay(attempt: number, settings: RuntimeRecoverySettings): number {
  const baseDelay = settings.initialRetryDelayMs * Math.pow(settings.backoffMultiplier, attempt);
  const cappedDelay = Math.min(baseDelay, settings.maxRetryDelayMs);
  const jitter = cappedDelay * (settings.jitterPercent / 100) * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(cappedDelay + jitter));
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal.reason);
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }
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

    // Load retry settings from user config
    const userConfig = await loadUserConfig();
    const retrySettings = userConfig.runtimeControls.recovery;
    const customRetryRules = userConfig.runtimeControls.retryRules;

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

      const adapter = getAdapter(provider, this.adapters);

      // Retry loop with exponential backoff for transient errors
      let retryAttempt = 0;

      while (true) {
        // Check abort before each attempt
        if (input.signal?.aborted) {
          return {
            success: false,
            code: "network-error" as LlmRuntimeFailureCode,
            error: "Request aborted",
            metadata: { providerId: candidate.providerId, providerName: candidate.providerName, modelId: candidate.rawModelId },
          };
        }

        const runtimeMessages = toRuntimeMessages(input.messages);
        // Strip reasoning from historical messages to prevent cross-model thinking errors.
        // Intra-turn reasoning passback is handled by agent-turn-runtime before messages reach here.
        // Only keep reasoning for the last assistant message (current turn's tool loop).
        let lastAssistantIdx = -1;
        for (let i = runtimeMessages.length - 1; i >= 0; i--) {
          if (runtimeMessages[i]!.role === "assistant" && (runtimeMessages[i] as { reasoning_content?: string }).reasoning_content) {
            lastAssistantIdx = i;
            break;
          }
        }
        const cleanedMessages = runtimeMessages.map((msg, idx) => {
          if (msg.role === "tool" || idx === lastAssistantIdx) return msg;
          if (!(msg as { reasoning_content?: string }).reasoning_content && !(msg as { reasoning_signature?: string }).reasoning_signature) return msg;
          const { reasoning_content, reasoning_signature, ...rest } = msg as RuntimeChatMessage & { reasoning_content?: string; reasoning_signature?: string };
          if (!rest.content?.trim() && !(rest as { toolCalls?: unknown[] }).toolCalls?.length) return null;
          return rest as RuntimeChatMessage;
        }).filter((msg): msg is RuntimeChatMessage => msg !== null);

        const result = await adapter.generate({
          ...providerRef(provider),
          modelId: candidate.rawModelId,
          messages: cleanedMessages,
          ...(requestedTools ? { tools: requestedTools } : {}),
          ...(input.onStreamChunk ? { onStreamChunk: input.onStreamChunk } : {}),
          ...(input.onToolEvent ? { onToolEvent: input.onToolEvent } : {}),
          ...(input.signal ? { signal: input.signal } : {}),
          ...(input.sessionConfig.reasoningEffort ? { reasoningEffort: input.sessionConfig.reasoningEffort } : {}),
          ...(input.sessionConfig.serviceTier ? { serviceTier: input.sessionConfig.serviceTier } : {}),
        });

        const metadata: LlmRuntimeMetadata = {
          providerId: candidate.providerId,
          providerName: candidate.providerName,
          modelId: candidate.rawModelId,
          ...(result.success && result.usage ? { usage: result.usage } : {}),
          ...(attempt > 0 ? { fallbackAttempts: attempt } : {}),
        };

        if (!result.success) {
          // Check if this is a retriable transient error
          if (isRetriableError(result.code, result.error, customRetryRules) && retryAttempt < retrySettings.maxRetryAttempts) {
            const delayMs = calculateRetryDelay(retryAttempt, retrySettings);
            console.log(JSON.stringify({
              component: "llm-runtime",
              event: "retry",
              attempt: retryAttempt + 1,
              delayMs,
              reason: result.error,
              providerId: candidate.providerId,
              modelId: candidate.rawModelId,
            }));

            input.onRetry?.(retryAttempt + 1, retrySettings.maxRetryAttempts);

            try {
              await abortableSleep(delayMs, input.signal);
            } catch {
              // Aborted during sleep
              return {
                success: false,
                code: "network-error" as LlmRuntimeFailureCode,
                error: "Request aborted during retry backoff",
                metadata,
              };
            }

            retryAttempt++;
            continue;
          }

          // Not retriable or retries exhausted — fallback to next provider on network/upstream errors
          if (result.code === "network-error" || result.code === "upstream-error") {
            lastFailure = { success: false, code: result.code, error: result.error, metadata };
            break;
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
    }

    // All candidates exhausted
    if (lastFailure) {
      // Append proxy hint only for real network errors. Upstream errors are usually
      // provider-side parameter/model issues, and proxy hints are misleading there.
      if (!lastFailure.success && lastFailure.code === "network-error") {
        return { ...lastFailure, error: `${lastFailure.error}。如果使用了代理，请检查设置 → 代理管理中的配置是否正确。` };
      }
      return lastFailure;
    }

    return {
      success: false,
      code: "all-providers-failed",
      error: `所有供应商均不可用（模型: ${modelId}）。请检查设置 → AI 供应商中的 API Key 和网络连接。`,
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
