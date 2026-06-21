import type { AgentTurnItem } from "./agent-turn-runtime.js";
import { estimateTokenCount, getContextTokensFromUsage } from "./token-utils.js";

/**
 * 粗估 token 数：content.length / 4
 * 不依赖 tiktoken，适用于英文和中文混合文本的快速估算。
 * 委托给 token-utils.ts estimateTokenCount（唯一来源）。
 */
export const roughTokenEstimation = estimateTokenCount;

/**
 * 兼容接口：返回 { tokens } 对象，供 context-manager 等路由使用。
 */
export function countTokens(content: string): { tokens: number } {
  return { tokens: roughTokenEstimation(content) };
}

/**
 * Usage 数据结构，对应 API 返回的 token 用量。
 */
export interface TokenUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

/**
 * 从 API usage 提取上下文占用（四字段全算）。
 * 委托给 token-utils.getContextTokensFromUsage（单一权威来源）。
 */
export function tokenCountFromUsage(usage: TokenUsage): number {
  return getContextTokensFromUsage(usage);
}

/**
 * 从消息内容中提取文本用于粗估。
 */
function extractTextFromItem(item: AgentTurnItem): string {
  if (item.type === "message") return item.content;
  if (item.type === "tool_call") return item.name + JSON.stringify(item.input);
  if (item.type === "tool_result") return item.content;
  return "";
}

/**
 * 混合计数：从消息数组中找最后一条有 usage 的 metadata，
 * 使用精确计数 + 粗估后续消息的 token 数。
 *
 * 如果没有任何消息带 usage，则全部使用粗估。
 */
export function tokenCountWithEstimation(messages: readonly AgentTurnItem[]): number {
  // 从后往前找最后一条有 usage 的消息
  let lastUsageIndex = -1;
  let lastUsage: TokenUsage | undefined;

  for (let i = messages.length - 1; i >= 0; i--) {
    const item = messages[i];
    if (item.type === "message" && item.metadata?.usage) {
      const usage = item.metadata.usage as TokenUsage;
      if (typeof usage.input_tokens === "number" || typeof usage.output_tokens === "number") {
        lastUsageIndex = i;
        lastUsage = usage;
        break;
      }
    }
  }

  // 没有任何 usage 数据，全部粗估
  if (lastUsageIndex < 0 || !lastUsage) {
    let total = 0;
    for (const item of messages) {
      total += estimateTokenCount(extractTextFromItem(item));
    }
    return total;
  }

  // 精确计数 + 后续消息粗估
  const precise = tokenCountFromUsage(lastUsage);
  let estimated = 0;
  for (let i = lastUsageIndex + 1; i < messages.length; i++) {
    estimated += estimateTokenCount(extractTextFromItem(messages[i]));
  }
  return precise + estimated;
}

/**
 * 已知模型的上下文窗口大小映射。
 * 键格式为 "providerId:modelId" 或模型名称前缀匹配。
 */
const KNOWN_CONTEXT_WINDOWS: Record<string, number> = {
  // Claude 系列
  "claude-3-5-sonnet": 200000,
  "claude-3-5-haiku": 200000,
  "claude-3-opus": 200000,
  "claude-3-sonnet": 200000,
  "claude-3-haiku": 200000,
  "claude-4-sonnet": 200000,
  "claude-4-opus": 200000,
  // GPT 系列
  "gpt-4o": 128000,
  "gpt-4-turbo": 128000,
  "gpt-4": 8192,
  "gpt-3.5-turbo": 16385,
  // DeepSeek 系列
  "deepseek-chat": 128000,
  "deepseek-coder": 128000,
  "deepseek-r1": 128000,
  "deepseek-v3": 128000,
  // Gemini 系列
  "gemini-2.5-pro": 1000000,
  "gemini-2.5-flash": 1000000,
  "gemini-2.0-flash": 1000000,
  "gemini-1.5-pro": 2000000,
  "gemini-1.5-flash": 1000000,
  // Qwen 系列
  "qwen-turbo": 131072,
  "qwen-plus": 131072,
  "qwen-max": 32768,
};

const DEFAULT_CONTEXT_WINDOW = 200000;

/**
 * 获取模型上下文窗口大小。
 * 先尝试精确匹配 modelId，再尝试前缀匹配，最后返回默认值 200000。
 */
export function getContextWindowForModel(_providerId: string, modelId: string): number {
  // 精确匹配
  if (KNOWN_CONTEXT_WINDOWS[modelId] !== undefined) {
    return KNOWN_CONTEXT_WINDOWS[modelId];
  }

  // 前缀匹配：按键长度降序排列，优先匹配更长的前缀
  const sortedKeys = Object.keys(KNOWN_CONTEXT_WINDOWS).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    if (modelId.startsWith(key)) {
      return KNOWN_CONTEXT_WINDOWS[key];
    }
  }

  return DEFAULT_CONTEXT_WINDOW;
}
