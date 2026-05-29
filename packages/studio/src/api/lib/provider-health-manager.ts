/**
 * Provider Health Manager
 *
 * 维护每个 provider/model 的健康状态，实现：
 * - 连续失败后短期熔断
 * - 分阶段超时检测（TTFT / stream idle / total）
 * - 自动降级建议
 * - 错误分类
 *
 * 设计参考 Codex CLI 的 ModelClient transport fallback 与 telemetry。
 */

export type ProviderHealthStatus = "healthy" | "degraded" | "down";

export type GenerateErrorCode =
  | "connect-timeout"
  | "ttft-timeout"
  | "stream-idle-timeout"
  | "total-timeout"
  | "network-error"
  | "upstream-error"
  | "empty-response"
  | "auth-error"
  | "rate-limit"
  | "context-too-large"
  | "unknown";

export interface ProviderTimeoutConfig {
  /** 连接超时 ms（默认 15000） */
  readonly connectTimeoutMs: number;
  /** 首 token 超时 ms（默认 60000） */
  readonly ttftTimeoutMs: number;
  /** 流 idle 超时 ms — 两个 chunk 之间最大间隔（默认 30000） */
  readonly streamIdleTimeoutMs: number;
  /** 总超时 ms（默认 300000 = 5 分钟） */
  readonly totalTimeoutMs: number;
}

export interface ProviderHealthState {
  readonly providerId: string;
  readonly modelId: string;
  readonly status: ProviderHealthStatus;
  readonly consecutiveFailures: number;
  readonly lastSuccessAt: number | null;
  readonly lastFailureAt: number | null;
  readonly lastErrorCode: GenerateErrorCode | null;
  readonly circuitBreakerUntil: number | null;
}

export interface ProviderHealthConfig {
  /** 连续失败多少次后进入 degraded */
  readonly degradedThreshold: number;
  /** 连续失败多少次后进入 down（熔断） */
  readonly downThreshold: number;
  /** 熔断持续时间 ms */
  readonly circuitBreakerDurationMs: number;
  /** 超时配置 */
  readonly timeouts: ProviderTimeoutConfig;
}

export interface GenerateTimingMetrics {
  readonly startedAtMs: number;
  readonly connectedAtMs?: number;
  readonly firstTokenAtMs?: number;
  readonly lastChunkAtMs?: number;
  readonly completedAtMs?: number;
  readonly totalDurationMs?: number;
}

export interface FallbackSuggestion {
  readonly shouldFallback: boolean;
  readonly reason?: string;
  readonly suggestedProviderId?: string;
  readonly suggestedModelId?: string;
}

const DEFAULT_TIMEOUT_CONFIG: ProviderTimeoutConfig = {
  connectTimeoutMs: 15_000,
  ttftTimeoutMs: 60_000,
  streamIdleTimeoutMs: 30_000,
  totalTimeoutMs: 300_000,
};

const DEFAULT_HEALTH_CONFIG: ProviderHealthConfig = {
  degradedThreshold: 2,
  downThreshold: 5,
  circuitBreakerDurationMs: 60_000,
  timeouts: DEFAULT_TIMEOUT_CONFIG,
};

export function classifyError(error: unknown, timing?: GenerateTimingMetrics): GenerateErrorCode {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  // 直接匹配已知的 error code（来自 LLM runtime 的 reply.code）
  if (/^network.?error$/i.test(message) || message === "network-error") return "network-error";
  if (/^upstream.?error$/i.test(message) || message === "upstream-error") return "upstream-error";
  if (/^empty.?response$/i.test(message) || message === "empty-response") return "empty-response";
  if (/model.?unavailable|all.?providers.?failed|no.?provider/i.test(message)) return "network-error";

  if (timing) {
    if (!timing.connectedAtMs && timing.totalDurationMs && timing.totalDurationMs >= DEFAULT_TIMEOUT_CONFIG.connectTimeoutMs) {
      return "connect-timeout";
    }
    if (timing.connectedAtMs && !timing.firstTokenAtMs && timing.totalDurationMs && timing.totalDurationMs >= DEFAULT_TIMEOUT_CONFIG.ttftTimeoutMs) {
      return "ttft-timeout";
    }
  }

  if (/timeout|timed?\s*out/i.test(message)) {
    if (/connect/i.test(message)) return "connect-timeout";
    if (/idle/i.test(message)) return "stream-idle-timeout";
    return "total-timeout";
  }
  if (/network|econnrefused|econnreset|enotfound|fetch failed/i.test(message)) return "network-error";
  if (/upstream|502|503|530/i.test(message)) return "upstream-error";
  if (/empty.?response|no content|empty body/i.test(message)) return "empty-response";
  if (/401|unauthorized|auth|token expired/i.test(message)) return "auth-error";
  if (/429|rate.?limit|too many/i.test(message)) return "rate-limit";
  if (/context.?length|too.?long|max.?token/i.test(message)) return "context-too-large";
  return "unknown";
}

export function getErrorUserMessage(code: GenerateErrorCode): string {
  switch (code) {
    case "connect-timeout": return "无法连接到模型服务，请检查网络或 API 配置。";
    case "ttft-timeout": return "模型长时间未开始生成，可能上游过载。";
    case "stream-idle-timeout": return "模型生成中途中断，流无响应。";
    case "total-timeout": return "生成超时（超过 5 分钟），请重试或切换模型。";
    case "network-error": return "网络连接失败或模型不可用，请检查代理、API 配置或本地服务状态。";
    case "upstream-error": return "上游服务异常，模型提供商可能临时不可用。";
    case "empty-response": return "模型返回空响应，可能上下文过大或服务异常。";
    case "auth-error": return "认证失败，请检查 API Key 配置。";
    case "rate-limit": return "请求频率超限，请稍后重试。";
    case "context-too-large": return "上下文超出模型限制，请压缩对话历史。";
    case "unknown": return "生成失败，原因未知。";
  }
}

export class ProviderHealthManager {
  private readonly config: ProviderHealthConfig;
  private readonly states = new Map<string, ProviderHealthState>();
  private fallbackProviders: Array<{ providerId: string; modelId: string }> = [];

  constructor(config: Partial<ProviderHealthConfig> = {}) {
    this.config = { ...DEFAULT_HEALTH_CONFIG, ...config, timeouts: { ...DEFAULT_TIMEOUT_CONFIG, ...config.timeouts } };
  }

  get timeouts(): ProviderTimeoutConfig {
    return this.config.timeouts;
  }

  setFallbackProviders(providers: Array<{ providerId: string; modelId: string }>): void {
    this.fallbackProviders = [...providers];
  }

  private key(providerId: string, modelId: string): string {
    return `${providerId}::${modelId}`;
  }

  private getState(providerId: string, modelId: string): ProviderHealthState {
    const k = this.key(providerId, modelId);
    return this.states.get(k) ?? {
      providerId,
      modelId,
      status: "healthy",
      consecutiveFailures: 0,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastErrorCode: null,
      circuitBreakerUntil: null,
    };
  }

  getStatus(providerId: string, modelId: string): ProviderHealthStatus {
    const state = this.getState(providerId, modelId);
    if (state.circuitBreakerUntil && Date.now() < state.circuitBreakerUntil) {
      return "down";
    }
    return state.status;
  }

  isAvailable(providerId: string, modelId: string): boolean {
    return this.getStatus(providerId, modelId) !== "down";
  }

  recordSuccess(providerId: string, modelId: string): void {
    const k = this.key(providerId, modelId);
    this.states.set(k, {
      providerId,
      modelId,
      status: "healthy",
      consecutiveFailures: 0,
      lastSuccessAt: Date.now(),
      lastFailureAt: this.getState(providerId, modelId).lastFailureAt,
      lastErrorCode: null,
      circuitBreakerUntil: null,
    });
  }

  recordFailure(providerId: string, modelId: string, errorCode: GenerateErrorCode): void {
    const k = this.key(providerId, modelId);
    const prev = this.getState(providerId, modelId);
    const failures = prev.consecutiveFailures + 1;
    let status: ProviderHealthStatus = "healthy";
    let circuitBreakerUntil: number | null = null;

    if (failures >= this.config.downThreshold) {
      status = "down";
      circuitBreakerUntil = Date.now() + this.config.circuitBreakerDurationMs;
    } else if (failures >= this.config.degradedThreshold) {
      status = "degraded";
    }

    this.states.set(k, {
      providerId,
      modelId,
      status,
      consecutiveFailures: failures,
      lastSuccessAt: prev.lastSuccessAt,
      lastFailureAt: Date.now(),
      lastErrorCode: errorCode,
      circuitBreakerUntil,
    });
  }

  suggestFallback(providerId: string, modelId: string): FallbackSuggestion {
    const status = this.getStatus(providerId, modelId);
    if (status === "healthy") return { shouldFallback: false };

    const state = this.getState(providerId, modelId);
    const available = this.fallbackProviders.find(
      (p) => !(p.providerId === providerId && p.modelId === modelId) && this.isAvailable(p.providerId, p.modelId),
    );

    if (available) {
      return {
        shouldFallback: true,
        reason: `${providerId}/${modelId} 状态 ${status}（连续失败 ${state.consecutiveFailures} 次，最近错误: ${state.lastErrorCode}）`,
        suggestedProviderId: available.providerId,
        suggestedModelId: available.modelId,
      };
    }

    return {
      shouldFallback: status === "down",
      reason: `${providerId}/${modelId} 状态 ${status}，无可用备选。`,
    };
  }

  getAllStates(): ProviderHealthState[] {
    return [...this.states.values()];
  }

  describe(): string {
    const states = this.getAllStates();
    if (states.length === 0) return "ProviderHealth: no providers tracked yet";
    return states.map((s) => `${s.providerId}/${s.modelId}: ${s.status} (failures=${s.consecutiveFailures})`).join("; ");
  }
}
