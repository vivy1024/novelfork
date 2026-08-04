import type { RuntimeTextGenerator } from "@vivy1024/novelfork-core/plugins";
import type { ArcBeat, ArcBeatDirection } from "./arc-types.js";
import type { CharacterInput } from "./rule-engine.js";

// ---------------------------------------------------------------------------
// Prompt template
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

export interface LlmRefinementResult {
  readonly beats: ArcBeat[];
  readonly refined: boolean;
  readonly warning?: string;
}

const DIRECTIONS = new Set<ArcBeatDirection>(["advance", "regression", "neutral"]);

function parseJsonArray(text: string): unknown[] {
  const normalized = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = normalized.indexOf("[");
  const end = normalized.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("模型没有返回 JSON 数组。");
  const parsed = JSON.parse(normalized.slice(start, end + 1)) as unknown;
  if (!Array.isArray(parsed)) throw new Error("模型返回的 beats 不是数组。");
  return parsed;
}

function parseBeat(value: unknown, chapterNumber: number): ArcBeat | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const event = typeof item.event === "string" ? item.event.trim() : "";
  const change = typeof item.change === "string" ? item.change.trim() : "";
  const direction = item.direction;
  if (!event || !change || typeof direction !== "string" || !DIRECTIONS.has(direction as ArcBeatDirection)) return null;

  const rawConfidence = typeof item.confidence === "number" && Number.isFinite(item.confidence)
    ? item.confidence
    : 0.5;
  return {
    chapter: chapterNumber,
    event,
    change,
    direction: direction as ArcBeatDirection,
    source: "auto-llm",
    confidence: Math.min(Math.max(rawConfidence, 0), 1),
  };
}

/**
 * Refine rule-based beats with the current Runtime model.
 * Invalid or unavailable model output fails closed to the rule result and is
 * reported to the caller instead of claiming that an LLM refinement happened.
 */
export async function refineBeatsWithLlm(
  content: string,
  characters: CharacterInput[],
  ruleBeats: ArcBeat[],
  chapterNumber: number,
  generateText?: RuntimeTextGenerator,
): Promise<LlmRefinementResult> {
  if (!generateText) {
    return {
      beats: ruleBeats,
      refined: false,
      warning: "未提供当前 Runtime 文本模型，已保留规则引擎结果，未执行 LLM 精修。",
    };
  }

  const prompt = LLM_REFINER_PROMPT_TEMPLATE
    .replace("{content}", content.slice(0, 16000))
    .replace("{characters}", JSON.stringify(characters))
    .replace("{ruleBeats}", JSON.stringify(ruleBeats));

  try {
    const response = await generateText({
      messages: [
        { role: "system", content: "你只返回合法 JSON 数组，不要使用 Markdown 代码围栏或额外解释。" },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
      maxTokens: 2000,
    });
    const beats = parseJsonArray(response.text)
      .map((item) => parseBeat(item, chapterNumber))
      .filter((item): item is ArcBeat => item !== null);
    if (beats.length === 0) throw new Error("模型没有返回有效的角色弧线 beat。");
    return { beats, refined: true };
  } catch (error) {
    return {
      beats: ruleBeats,
      refined: false,
      warning: `LLM 精修失败，已保留规则引擎结果：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
