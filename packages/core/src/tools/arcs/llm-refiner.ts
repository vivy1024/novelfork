import type { ArcBeat } from "./arc-types.js";
import type { CharacterInput } from "./rule-engine.js";

// ---------------------------------------------------------------------------
// Prompt template (reserved for future LLM integration)
// ---------------------------------------------------------------------------

export const LLM_REFINER_PROMPT_TEMPLATE = `你是一个小说角色弧线分析专家。

给定以下章节内容和规则引擎初步检测到的角色弧线节拍（beats），请：
1. 验证每个 beat 是否准确反映了角色在本章的变化
2. 修正不准确的 beat（调整 direction 或 event 描述）
3. 补充规则引擎遗漏的重要角色变化
4. 为每个 beat 给出 0-1 的置信度分数

## 章节内容
{content}

## 角色列表
{characters}

## 规则引擎检测结果
{ruleBeats}

请以 JSON 数组格式返回精炼后的 beats，每个 beat 包含：
- chapter: number
- event: string (简短描述)
- change: string (关键词)
- direction: "advance" | "regression" | "neutral"
- source: "auto-llm"
- confidence: number (0-1)
`;

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Refine rule-based beats using LLM.
 * Currently a placeholder that returns ruleBeats unchanged.
 * Will be connected to LLM provider in a future iteration.
 */
export async function refineBeatsWithLlm(
  _content: string,
  _characters: CharacterInput[],
  ruleBeats: ArcBeat[],
): Promise<ArcBeat[]> {
  // TODO: Integrate with LLM provider when available.
  // For now, return rule beats as-is.
  return ruleBeats;
}
