/**
 * 模型族默认上下文窗口大小映射。
 * 移植自 NarraFork Runtime: frontend/components/providers/model-context-defaults.ts
 */

function parseClaudeVersion(modelId: string): { major: number; minor: number } | null {
  // claude-sonnet-4.6, claude-opus-4-6, anthropic:claude-3-5-sonnet 等
  const patterns = [
    /claude[- ](?:sonnet|opus|haiku|fable|mythos)[- ](\d+)[.-](\d+)/i,
    /claude[- ](\d+)[.-](\d+)/i,
  ];
  for (const pattern of patterns) {
    const match = modelId.match(pattern);
    if (match) return { major: Number(match[1]), minor: Number(match[2]) };
  }
  return null;
}

/**
 * 根据模型 ID 推断默认上下文窗口大小（tokens）。
 * 返回 null 表示无法识别，不应自动填充。
 */
export function getModelDefaultContextWindow(modelId: string): number | null {
  const lower = modelId.toLowerCase();

  // mimo 系列
  if (lower.includes("mimo")) return 1_048_576;

  // DeepSeek v4 系列
  if (lower.includes("deepseek") && lower.includes("v4")) return 1_000_000;

  // GPT-5 系列
  if (/gpt[- ]?5/.test(lower)) return 272_000;

  // Claude mythos preview
  if (lower.includes("mythos") && lower.includes("preview")) return 1_000_000;

  // Claude >= 4.6 或 fable/mythos
  const ver = parseClaudeVersion(lower);
  if (ver) {
    if (ver.major > 4 || (ver.major === 4 && ver.minor >= 6)) return 1_000_000;
    if (ver.major === 3 && ver.minor >= 5) return 200_000;
    return 200_000;
  }
  if (lower.includes("fable") || lower.includes("mythos")) return 1_000_000;

  // Claude 通用（含 claude 关键字但无法解析版本）
  if (lower.includes("claude")) return 200_000;

  // Gemini 2.x
  if (/gemini[- ]?2/i.test(lower)) return 1_048_576;
  if (lower.includes("gemini")) return 1_000_000;

  return null;
}
