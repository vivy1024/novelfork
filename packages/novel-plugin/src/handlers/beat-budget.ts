/**
 * 情节点字数预算 —— 让章内节奏可核对，而不是让模型自由发挥。
 *
 * 问题：只给「本章 3000 字」这一个数字时，模型倾向平均用力：
 * 爽点和过场各占一半篇幅，读起来处处不痛不痒。
 *
 * 做法：把一章拆成若干情节点，每点标密度并给字数预算。
 * - 密（爽点/反转/打脸/情绪高潮）：值得展开，下限较高
 * - 疏（过场/赶路/信息交代）：几十字带过
 * 预算总和必须落在 [章目标, 章目标 × 上浮系数] 区间，超出即需调整。
 *
 * 纪律：本模块只判定与建议，不改数据、不决定是否阻断。
 */

/** 情节点密度。密=展开，疏=带过，中=常规铺垫。 */
export type BeatDensity = "dense" | "normal" | "sparse";

export interface BeatBudgetItem {
  /** 情节点描述，应写清「发生什么」而不只是动词。 */
  readonly summary: string;
  readonly density: BeatDensity;
  /** 分配字数。 */
  readonly words: number;
  /** 功能标签，如 信息揭示 / 冲突升级 / 情绪转折。 */
  readonly function?: string;
}

export interface BeatBudgetInput {
  readonly chapterTarget: number;
  readonly beats: readonly BeatBudgetItem[];
  /** 总和允许的上浮比例，默认 10%。 */
  readonly overflowRatio?: number;
}

export type BeatBudgetCode =
  | "no-beats"
  | "sum-below-target"
  | "sum-above-ceiling"
  | "dense-beat-too-thin"
  | "sparse-beat-too-fat"
  | "no-dense-beat"
  | "vague-beat-summary";

export interface BeatBudgetFinding {
  readonly code: BeatBudgetCode;
  readonly severity: "block" | "warn";
  readonly subject: string;
  readonly whatHappened: string;
  readonly whyItMatters: string;
  readonly suggestedAction: string;
}

export interface BeatBudgetReport {
  readonly ok: boolean;
  readonly chapterTarget: number;
  readonly ceiling: number;
  readonly total: number;
  readonly beatCount: number;
  readonly denseCount: number;
  readonly findings: readonly BeatBudgetFinding[];
  /** 一行核对串，便于作者与机器同时校验。 */
  readonly budgetLine: string;
  readonly summary: string;
}

/** 密点下限：低于这个字数的「密」点其实没展开。 */
const DENSE_MIN_WORDS = 250;
/** 疏点上限：超过这个字数的「疏」点其实是在水。 */
const SPARSE_MAX_WORDS = 150;
/** 情节点描述过短，等于没规划。 */
const MIN_SUMMARY_CHARS = 6;

function densityLabel(density: BeatDensity): string {
  return density === "dense" ? "密" : density === "sparse" ? "疏" : "中";
}

export function checkBeatBudget(input: BeatBudgetInput): BeatBudgetReport {
  const target = Math.max(0, Math.trunc(input.chapterTarget));
  const overflow = input.overflowRatio ?? 0.1;
  const ceiling = Math.round(target * (1 + overflow));
  const beats = input.beats ?? [];
  const findings: BeatBudgetFinding[] = [];

  const total = beats.reduce((sum, beat) => sum + Math.max(0, Math.trunc(beat.words)), 0);
  const denseCount = beats.filter((beat) => beat.density === "dense").length;

  if (beats.length === 0) {
    return {
      ok: false,
      chapterTarget: target,
      ceiling,
      total: 0,
      beatCount: 0,
      denseCount: 0,
      findings: [{
        code: "no-beats",
        severity: "block",
        subject: "情节点",
        whatHappened: "这一章没有拆情节点，只有一个总字数目标。",
        whyItMatters: "没有分配就没有节奏：模型会平均用力，爽点和过场占一样的篇幅，读起来处处不痛不痒。",
        suggestedAction: "把本章拆成若干情节点，每点标密/疏并给字数，总和落在目标区间内。",
      }],
      budgetLine: `预算合计：0字（目标${target}，范围${target}-${ceiling}）`,
      summary: "未拆情节点，无法校验章内节奏。",
    };
  }

  if (total < target) {
    findings.push({
      code: "sum-below-target",
      severity: "block",
      subject: "预算总和",
      whatHappened: `情节点预算合计 ${total} 字，低于本章目标 ${target} 字。`,
      whyItMatters: "缺口会在写作时被模型即兴填补，通常填成注水段落或重复描写。",
      suggestedAction: "把爽点类情节点拆得更细（一个爽点可拆成铺垫、释放、余波三拍），而不是给现有点数直接加字数。",
    });
  } else if (total > ceiling) {
    findings.push({
      code: "sum-above-ceiling",
      severity: "block",
      subject: "预算总和",
      whatHappened: `情节点预算合计 ${total} 字，超出上限 ${ceiling} 字（目标 ${target} + ${Math.round(overflow * 100)}%）。`,
      whyItMatters: "超编会导致写作时硬砍，砍掉的往往是过渡和铺垫，读者会觉得跳。",
      suggestedAction: "压缩或合并「疏」类情节点，先删过场再动爽点。",
    });
  }

  for (const beat of beats) {
    const words = Math.max(0, Math.trunc(beat.words));
    const label = beat.summary.trim() || "(未命名情节点)";

    if (beat.density === "dense" && words < DENSE_MIN_WORDS) {
      findings.push({
        code: "dense-beat-too-thin",
        severity: "warn",
        subject: label,
        whatHappened: `「${label}」标为密点，但只分配了 ${words} 字（建议不少于 ${DENSE_MIN_WORDS} 字）。`,
        whyItMatters: "密点是读者花时间等的部分。字数不够就等于把高潮一句话带过，前面的铺垫白费。",
        suggestedAction: `给它 ${DENSE_MIN_WORDS} 字以上，或把它改成中/疏点并另找一个真正的爽点。`,
      });
    }

    if (beat.density === "sparse" && words > SPARSE_MAX_WORDS) {
      findings.push({
        code: "sparse-beat-too-fat",
        severity: "warn",
        subject: label,
        whatHappened: `「${label}」标为疏点，却分配了 ${words} 字（建议不超过 ${SPARSE_MAX_WORDS} 字）。`,
        whyItMatters: "过场写长是注水的主要来源，会拉低单章的信息密度。",
        suggestedAction: "压到百字内带过，或者承认它其实是个中点并重排预算。",
      });
    }

    if (label.length < MIN_SUMMARY_CHARS || label === "(未命名情节点)") {
      findings.push({
        code: "vague-beat-summary",
        severity: "warn",
        subject: label,
        whatHappened: `情节点描述「${label}」过短，看不出实际发生了什么。`,
        whyItMatters: "只写「发现线索」这类动词，模型只能自己编内容，蓝图就失去了约束作用。",
        suggestedAction: "写清具体事件，例如「在账单上发现 4800 元转出」。",
      });
    }
  }

  if (denseCount === 0) {
    findings.push({
      code: "no-dense-beat",
      severity: "warn",
      subject: "章节节奏",
      whatHappened: "本章没有任何密点。",
      whyItMatters: "低压章可以没有爽点，但连续多章都没有会掉追读。",
      suggestedAction: "确认这是有意的呼吸章；否则挑一个情节点升为密点并给足字数。",
    });
  }

  const hasBlock = findings.some((item) => item.severity === "block");
  return {
    ok: !hasBlock,
    chapterTarget: target,
    ceiling,
    total,
    beatCount: beats.length,
    denseCount,
    findings,
    budgetLine: `预算合计：${total}字（目标${target}，范围${target}-${ceiling}）`,
    summary: buildSummary(hasBlock, total, target, ceiling, beats.length, denseCount, findings.length),
  };
}

function buildSummary(
  hasBlock: boolean,
  total: number,
  target: number,
  ceiling: number,
  beatCount: number,
  denseCount: number,
  findingCount: number,
): string {
  const head = hasBlock ? "预算不合规" : "预算合规";
  const detail = `${beatCount} 个情节点（密 ${denseCount}），合计 ${total} 字，目标区间 ${target}-${ceiling}`;
  return findingCount === 0
    ? `${head}：${detail}。`
    : `${head}：${detail}；${findingCount} 条提示。`;
}

/** 从工具入参安全解析情节点列表。 */
export function parseBeatBudget(raw: unknown): BeatBudgetItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const summary = typeof record.summary === "string" ? record.summary.trim() : "";
    const words = Number(record.words);
    if (!summary && !Number.isFinite(words)) return [];
    return [{
      summary,
      density: normalizeDensity(record.density),
      words: Number.isFinite(words) && words > 0 ? Math.trunc(words) : 0,
      ...(typeof record.function === "string" && record.function.trim()
        ? { function: record.function.trim() }
        : {}),
    }];
  });
}

function normalizeDensity(value: unknown): BeatDensity {
  return value === "dense" || value === "sparse" || value === "normal" ? value : "normal";
}

/** 渲染成写作提示可注入的一段文本。 */
export function renderBeatBudget(beats: readonly BeatBudgetItem[]): string {
  if (beats.length === 0) return "";
  const lines = beats.map((beat, index) =>
    `${index + 1}. ${beat.summary}【${beat.function ?? "推进"}·${densityLabel(beat.density)}${beat.words}】`,
  );
  return lines.join("\n");
}
