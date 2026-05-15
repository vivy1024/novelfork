/**
 * Dream system — periodic background task that discovers hidden connections
 * across chapters. Run after each volume (30 chapters) is completed.
 */

export interface DreamDiscovery {
  type: "hidden_connection" | "forgotten_thread" | "potential_callback" | "pattern";
  entities: string[];
  description: string;
  confidence: number;
  suggestedAction?: string;
}

/**
 * Build prompt for the dream system to discover hidden connections.
 */
export function buildDreamPrompt(
  volumeSummary: string,
  cooccurrenceHighlights: Array<{ entityA: string; entityB: string; count: number }>,
  unresolvedChains: Array<{ event: string; chapter: number }>,
): string {
  const coocLines = cooccurrenceHighlights
    .slice(0, 20)
    .map(c => `${c.entityA} ↔ ${c.entityB} (共现${c.count}次)`)
    .join("\n");

  const chainLines = unresolvedChains
    .slice(0, 10)
    .map(c => `- ${c.event}（第${c.chapter}章）`)
    .join("\n");

  return `你是一个小说分析助手。请分析以下信息，发现隐藏的联系、被遗忘的线索、潜在的回调机会。

本卷摘要：
${volumeSummary}

高频共现实体对：
${coocLines || "（无数据）"}

未解决的因果链：
${chainLines || "（无）"}

请以 JSON 数组格式输出发现，每条包含：
- type: "hidden_connection" | "forgotten_thread" | "potential_callback" | "pattern"
- entities: 涉及的实体名称数组
- description: 发现描述
- confidence: 置信度 0-1
- suggestedAction: 建议的后续动作（可选）

输出 3-8 条最有价值的发现。如果没有有意义的发现，输出空数组。`;
}

/**
 * Parse dream discoveries from LLM response.
 */
export function parseDreamDiscoveries(llmResponse: string): DreamDiscovery[] {
  try {
    const jsonMatch = llmResponse.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]) as unknown[];
    return (parsed as DreamDiscovery[]).filter(
      d => d && typeof d.type === "string" && Array.isArray(d.entities) && (d.confidence ?? 0) > 0.5
    );
  } catch {
    return [];
  }
}
