import type { SessionToolDefinition } from "../../shared/agent-native-workspace.js";
import type { NarratorSessionChatMessage, SessionConfig } from "../../shared/session-types.js";
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

export type LlmRuntimeFailureCode = RuntimeAdapterFailureCode | "model-unavailable" | "provider-unavailable" | "empty-response" | "unsupported-tools";

export interface LlmRuntimeMetadata {
  readonly providerId: string;
  readonly providerName: string;
  readonly modelId: string;
}

export type LlmRuntimeGenerateResult =
  | { readonly success: true; readonly type: "message"; readonly content: string; readonly metadata: LlmRuntimeMetadata }
  | { readonly success: true; readonly type: "tool_use"; readonly toolUses: readonly RuntimeToolUse[]; readonly metadata: LlmRuntimeMetadata }
  | { readonly success: false; readonly code: LlmRuntimeFailureCode; readonly error: string; readonly metadata?: Partial<LlmRuntimeMetadata> };

export interface LlmRuntimeGenerateInput {
  readonly sessionConfig: SessionConfig;
  readonly messages: readonly NarratorSessionChatMessage[];
  readonly tools?: readonly SessionToolDefinition[];
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
  return {
    providerId: provider.id,
    providerName: provider.name,
    ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
    ...(provider.config?.apiKey ? { apiKey: provider.config.apiKey } : {}),
  };
}

function toRuntimeMessages(messages: readonly NarratorSessionChatMessage[]): RuntimeChatMessage[] {
  return messages
    .filter((message) => message.role === "user" || message.role === "assistant" || message.role === "system")
    .map((message) => ({ role: message.role, content: message.content }))
    .filter((message) => message.content.trim().length > 0);
}

export class LlmRuntimeService {
  private readonly store: ProviderRuntimeStore;
  private readonly adapters: ProviderAdapterRegistry;

  constructor(options: LlmRuntimeServiceOptions = {}) {
    this.store = options.store ?? new ProviderRuntimeStore();
    this.adapters = options.adapters ?? createProviderAdapterRegistry();
  }

  async generate(input: LlmRuntimeGenerateInput): Promise<LlmRuntimeGenerateResult> {
    const providerId = input.sessionConfig.providerId?.trim();
    const modelId = input.sessionConfig.modelId?.trim();
    if (!providerId || !modelId) {
      return {
        success: false,
        code: "model-unavailable",
        error: "Session has no configured runtime model",
        metadata: { providerId, modelId },
      };
    }

    const modelRef = globalModelId(providerId, modelId);
    const modelPool = await buildRuntimeModelPool(this.store);
    const poolEntry = modelPool.find((entry) => entry.modelId === modelRef && entry.enabled === true);
    if (!poolEntry) {
      return {
        success: false,
        code: "model-unavailable",
        error: `Runtime model is not available: ${modelRef}`,
        metadata: { providerId, modelId },
      };
    }

    const provider = await this.store.getProvider(providerId);
    if (!provider || provider.enabled === false) {
      return {
        success: false,
        code: "provider-unavailable",
        error: `Runtime provider is not available: ${providerId}`,
        metadata: { providerId, modelId, providerName: poolEntry.providerName },
      };
    }

    const requestedTools = input.tools?.length ? input.tools : undefined;
    if (requestedTools && poolEntry.capabilities.functionCalling !== true) {
      return {
        success: false,
        code: "unsupported-tools",
        error: "当前模型不支持工具循环",
        metadata: { providerId, modelId, providerName: poolEntry.providerName },
      };
    }

    const adapter = this.adapters.get(adapterIdForProvider(provider));
    const result = await adapter.generate({
      ...providerRef(provider),
      modelId,
      messages: toRuntimeMessages(input.messages),
      ...(requestedTools ? { tools: requestedTools } : {}),
    });

    const metadata: LlmRuntimeMetadata = {
      providerId,
      providerName: provider.name,
      modelId,
    };

    if (!result.success) {
      return {
        success: false,
        code: result.code,
        error: result.error,
        metadata,
      };
    }

    if (result.type === "tool_use") {
      return {
        success: true,
        type: "tool_use",
        toolUses: result.toolUses,
        metadata,
      };
    }

    if (!result.content.trim()) {
      return {
        success: false,
        code: "empty-response",
        error: "LLM runtime returned an empty response",
        metadata,
      };
    }

    return {
      success: true,
      type: "message",
      content: result.content,
      metadata,
    };
  }
}

const defaultLlmRuntimeService = new LlmRuntimeService();

export function createLlmRuntimeService(options: LlmRuntimeServiceOptions = {}): LlmRuntimeService {
  return new LlmRuntimeService(options);
}

export function generateSessionReply(input: LlmRuntimeGenerateInput): Promise<LlmRuntimeGenerateResult> {
  return defaultLlmRuntimeService.generate(input);
}
