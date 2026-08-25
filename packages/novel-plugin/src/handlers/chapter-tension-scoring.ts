/**
 * T1 · 章节张力评分（墨枢方案移植）。
 *
 * 与摘要生成解耦的独立章后 LLM 调用：
 * - 模型只输出三维原始分（情节/情感/节奏，0-100），综合分由服务端加权（40/30/30）
 * - 容错解析：数值字段被模型写成评语时取首个数字；JSON 断流走外层花括号兜底
 * - -1 哨兵：评分失败持久化为 UNEVALUATED，前端据此区分「低分」与「评分失败」，绝不伪造中性分
 */

export const TENSION_UNEVALUATED = -1;

export interface TensionDimensions {
  /** 情节张力 0-100：冲突烈度与信息增量。 */
  plot: number;
  /** 情感张力 0-100：情绪浓度与代价感。 */
  emotional: number;
  /** 节奏张力 0-100：场景推进速度与钩子强度。 */
  pacing: number;
}

export type TensionScoreResult =
  | { status: "evaluated"; composite: number; dims: TensionDimensions }
  | { status: "unevaluated"; reason: string };

const DIM_WEIGHTS: Readonly<Record<keyof TensionDimensions, number>> = { plot: 0.4, emotional: 0.3, pacing: 0.3 };

const DIM_KEYS: ReadonlyArray<readonly [keyof TensionDimensions, RegExp]> = [
  ["plot", /plot[_-]?tension/iu],
  ["emotional", /emotion(?:al)?[_-]?tension/iu],
  ["pacing", /pacing[_-]?tension/iu],
];

/** 从可能夹带评语的字段值里提取 0-100 数值；无数字返回 undefined。 */
function coerceDimension(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(100, Math.max(0, value));
  }
  if (typeof value === "string") {
    const match = value.match(/(\d+(?:\.\d+)?)/u);
    if (match) return Math.min(100, Math.max(0, Number(match[1]!)));
  }
  return undefined;
}

/** 外层花括号兜底：模型把 JSON 包进解释文字时截取最外层对象。 */
function extractJsonObject(text: string): Record<string, unknown> | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/iu)?.[1]?.trim();
  const candidate = fenced ?? text.trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1)) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** 容错解析评分响应。少于两个可信维度视为未评估——绝不猜分。 */
export function parseTensionScoringResponse(text: string): TensionScoreResult {
  const payload = extractJsonObject(text);
  if (!payload) return { status: "unevaluated", reason: "响应中找不到 JSON 对象" };

  const resolved = new Map<keyof TensionDimensions, number>();
  for (const [dim, pattern] of DIM_KEYS) {
    for (const [key, value] of Object.entries(payload)) {
      if (!pattern.test(key)) continue;
      const coerced = coerceDimension(value);
      // 字段存在但完全无数字（如"较高"）→ 按墨枢语义取中性 50 兜底该维度。
      resolved.set(dim, coerced ?? 50);
      break;
    }
  }

  if (resolved.size < 2) {
    return { status: "unevaluated", reason: `仅解析到 ${resolved.size} 个有效维度（至少需要 2 个）` };
  }

  const weightSum = [...resolved.keys()].reduce((sum, dim) => sum + DIM_WEIGHTS[dim]!, 0);
  const weighted = [...resolved.entries()].reduce(
    (sum, [dim, value]) => sum + value * (DIM_WEIGHTS[dim]! / weightSum),
    0,
  );
  const dims = { plot: 50, emotional: 50, pacing: 50, ...Object.fromEntries(resolved) } as unknown as TensionDimensions;
  return {
    status: "evaluated",
    composite: Math.round(weighted) / 10,
    dims,
  };
}

export interface TensionScoringInput {
  chapterNumber: number;
  title?: string;
  contentExcerpt: string;
  /** 前章综合分换算到 0-100；缺省表示无基线（第一章或历史无评分）。 */
  previousScore100?: number;
}

export function buildTensionScoringMessages(input: TensionScoringInput): Array<{ role: "system" | "user"; content: string }> {
  const system = [
    "你是网文章节张力评分器。只输出严格 JSON（不要解释、不要代码块围栏）：",
    '{"plot_tension":0到100的整数,"emotional_tension":0到100的整数,"pacing_tension":0到100的整数}',
    "",
    "三维定义：",
    "- plot_tension 情节张力：冲突烈度与信息增量。",
    "- emotional_tension 情感张力：情绪浓度、代价感与人物煎熬。",
    "- pacing_tension 节奏张力：场景推进速度、悬念与章末钩子强度。",
    "",
    "分段标尺（每维同尺）：0-15 纯日常过渡；16-35 铺垫微澜；36-60 有明确冲突或推进；61-85 强冲突/重大转折；86-100 绝境修罗场。",
    "反中庸铁律：严禁三个维度全部落在 40-60 安全区！日常铺垫章必须敢于低于 30，高潮爆发章必须敢于高于 85。评语式的含糊打分是失职。",
  ];
  if (typeof input.previousScore100 === "number" && Number.isFinite(input.previousScore100)) {
    system.push(
      `前章综合张力 ${Math.round(input.previousScore100)}/100。若前章≥70，本章可以短暂回落但必须保留余震；若前章≤30，本章需要明显拉升冲突或信息增量。`,
    );
  }
  return [
    { role: "system", content: system.join("\n") },
    {
      role: "user",
      content: `第${input.chapterNumber}章${input.title ? `《${input.title}》` : ""}正文：\n${input.contentExcerpt}`,
    },
  ];
}

type GenerateText = (request: { messages: ReadonlyArray<{ role: "system" | "user" | "assistant"; content: string }>; temperature?: number; maxTokens?: number }) => Promise<{ text: string }>;

/** 独立评分调用：任何异常都收敛为 unevaluated，不向上抛、不阻断结算主体。 */
export async function scoreChapterTension(
  input: Omit<TensionScoringInput, "contentExcerpt"> & { content: string },
  generateText: GenerateText,
): Promise<TensionScoreResult> {
  try {
    const response = await generateText({
      messages: buildTensionScoringMessages({ ...input, contentExcerpt: input.content.slice(0, 3000) }),
      temperature: 0.2,
      maxTokens: 160,
    });
    const parsed = parseTensionScoringResponse(response.text);
    return parsed.status === "evaluated"
      ? parsed
      : { status: "unevaluated", reason: `${parsed.reason}；原始响应：${response.text.slice(0, 120)}` };
  } catch (error) {
    return { status: "unevaluated", reason: error instanceof Error ? error.message : String(error) };
  }
}
