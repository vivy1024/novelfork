/**
 * URL 拼接工具 — 每种协议的端点解析逻辑。
 *
 * 规则：
 * - 如果 baseUrl 以 /v1 结尾，直接拼接 path（不再加 /v1）
 * - 否则返回候选列表：先尝试 baseUrl + path，再尝试 baseUrl + /v1 + path
 */

export function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * 解析聊天/消息端点 URL 候选列表。
 * 返回按优先级排序的 URL 数组，调用方依次尝试。
 */
export function resolveEndpointUrls(baseUrl: string, path: string): string[] {
  const base = trimTrailingSlash(baseUrl);
  if (base.endsWith("/v1")) {
    return [`${base}${path}`];
  }
  // 先尝试带 path 的（可能 baseUrl 本身就是完整前缀），再尝试加 /v1
  const candidates = [`${base}${path}`, `${base}/v1${path}`];
  return [...new Set(candidates)];
}

/**
 * 解析模型列表端点 URL 候选列表。
 */
export function resolveModelsUrls(baseUrl: string): string[] {
  return resolveEndpointUrls(baseUrl, "/models");
}

/**
 * Completions / Codex 协议的聊天端点。
 */
export function resolveCompletionsUrls(baseUrl: string): string[] {
  return resolveEndpointUrls(baseUrl, "/chat/completions");
}

/**
 * Responses 协议的端点。
 */
export function resolveResponsesUrls(baseUrl: string): string[] {
  return resolveEndpointUrls(baseUrl, "/responses");
}

/**
 * Anthropic / Claude Code 协议的消息端点。
 */
export function resolveMessagesUrls(baseUrl: string): string[] {
  const base = trimTrailingSlash(baseUrl);
  if (base.endsWith("/v1")) {
    return [`${base}/messages`];
  }
  // Anthropic 兼容网关可能在 /v1/messages 或 /messages
  return [`${base}/v1/messages`, `${base}/messages`];
}
