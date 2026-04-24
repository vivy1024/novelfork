/**
 * Shared helpers for rendering LLM / model-configuration errors in a
 * user-friendly way. Backend responses today sometimes surface raw CLI-oriented
 * messages (e.g. `NOVELFORK_LLM_API_KEY not set. Run 'novelfork config
 * set-global'...`). Until the API ships structured `{ code, message, hint }`
 * payloads (see task 7.9.4 backend half), the frontend pattern-matches known
 * signatures and rewrites them into localized, actionable copy.
 */

export type LlmErrorCode =
  | "LLM_CONFIG_MISSING"
  | "LLM_QUOTA_EXHAUSTED"
  | "LLM_NETWORK_ERROR"
  | "UNKNOWN";

export interface LlmErrorInfo {
  readonly code: LlmErrorCode;
  readonly title: string;
  readonly description: string;
  /** Label for a primary action button; caller owns the onClick. */
  readonly actionLabel?: string;
  /** Optional raw message to show as secondary / collapsible detail. */
  readonly rawMessage?: string;
}

const API_KEY_PATTERNS: ReadonlyArray<RegExp> = [
  /NOVELFORK_LLM_API_KEY/i,
  /API key.*not set/i,
  /missing.*api[_ -]?key/i,
  /no\s+api[_ -]?key/i,
];

const QUOTA_PATTERNS: ReadonlyArray<RegExp> = [
  /quota.*exhausted/i,
  /rate[_ -]?limit/i,
  /429\b/,
  /insufficient[_ -]?quota/i,
];

const NETWORK_PATTERNS: ReadonlyArray<RegExp> = [
  /ECONNREFUSED/i,
  /ENOTFOUND/i,
  /network\s+error/i,
  /fetch\s+failed/i,
  /timeout/i,
];

export function describeLlmError(error: unknown, language: "zh" | "en" = "zh"): LlmErrorInfo {
  const raw = extractMessage(error);
  const structuredCode = extractCode(error);

  if (structuredCode === "LLM_CONFIG_MISSING" || API_KEY_PATTERNS.some((p) => p.test(raw))) {
    return {
      code: "LLM_CONFIG_MISSING",
      title: language === "en" ? "Model configuration incomplete" : "模型配置未完成",
      description:
        language === "en"
          ? "The backend writing runtime has no LLM API key yet. Configure a provider before retrying."
          : "后端写作运行时尚未配置 API Key。请先到管理中心配置供应商，或选择已启用的网关后再重试。",
      actionLabel: language === "en" ? "Open provider settings" : "去配置供应商",
      rawMessage: raw,
    };
  }

  if (structuredCode === "LLM_QUOTA_EXHAUSTED" || QUOTA_PATTERNS.some((p) => p.test(raw))) {
    return {
      code: "LLM_QUOTA_EXHAUSTED",
      title: language === "en" ? "Quota exhausted" : "模型配额已用尽",
      description:
        language === "en"
          ? "The current provider hit its quota or rate limit. Switch providers or wait a moment."
          : "当前供应商的配额或速率限制已达上限，可以切换供应商或稍后再试。",
      actionLabel: language === "en" ? "Switch provider" : "切换供应商",
      rawMessage: raw,
    };
  }

  if (structuredCode === "LLM_NETWORK_ERROR" || NETWORK_PATTERNS.some((p) => p.test(raw))) {
    return {
      code: "LLM_NETWORK_ERROR",
      title: language === "en" ? "Network issue reaching the provider" : "无法连接到模型供应商",
      description:
        language === "en"
          ? "Could not reach the LLM endpoint. Check network, proxy or gateway settings and retry."
          : "无法连通模型供应商，可能是网络、代理或网关配置问题。请检查设置后重试。",
      actionLabel: language === "en" ? "Open gateway settings" : "检查网关设置",
      rawMessage: raw,
    };
  }

  return {
    code: "UNKNOWN",
    title: language === "en" ? "Request failed" : "请求失败",
    description: raw || (language === "en" ? "Unknown error" : "发生未知错误"),
    rawMessage: raw,
  };
}

function extractCode(error: unknown): LlmErrorCode | undefined {
  if (typeof error === "object" && error !== null) {
    const maybe = error as { code?: unknown };
    if (maybe.code === "LLM_CONFIG_MISSING" || maybe.code === "LLM_QUOTA_EXHAUSTED" || maybe.code === "LLM_NETWORK_ERROR") {
      return maybe.code;
    }
  }
  return undefined;
}

function extractMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null) {
    const maybe = error as { message?: unknown; error?: unknown };
    if (typeof maybe.message === "string") return maybe.message;
    if (typeof maybe.error === "string") return maybe.error;
  }
  return String(error ?? "");
}
