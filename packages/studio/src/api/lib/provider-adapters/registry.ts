/**
 * Adapter 注册表 — 按 ProviderProtocol 路由到对应的 RuntimeAdapter。
 *
 * 替代旧的 ProviderAdapterRegistry（按 RuntimeAdapterId 路由）。
 */
import type { ProviderProtocol } from "../../../shared/provider-catalog.js";
import type { RuntimeAdapter } from "./index.js";
import { CompletionsAdapter } from "./completions.js";
import { ResponsesAdapter } from "./responses.js";
import { AnthropicAdapter } from "./anthropic.js";
import { CodexAdapter } from "./codex.js";
import { ClaudeCodeAdapter } from "./claude-code.js";

/**
 * 按 protocol 获取对应的 adapter 实例。
 */
export function getAdapterForProtocol(protocol: ProviderProtocol): RuntimeAdapter {
  switch (protocol) {
    case "completions":
      return completionsAdapter;
    case "responses":
      return responsesAdapter;
    case "anthropic":
      return anthropicAdapter;
    case "codex":
      return codexAdapter;
    case "claude-code":
      return claudeCodeAdapter;
    default:
      return completionsAdapter;
  }
}

// 单例 adapter 实例（无状态，可安全复用）
const completionsAdapter = new CompletionsAdapter();
const responsesAdapter = new ResponsesAdapter();
const anthropicAdapter = new AnthropicAdapter();
const codexAdapter = new CodexAdapter();
const claudeCodeAdapter = new ClaudeCodeAdapter();
