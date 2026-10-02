/**
 * 保护预算溢出守卫（T4.7）：受保护的硬核资料降档到顶仍装不进预算时，
 * 把「悄悄降级继续」升级成「显式报错」。
 *
 * 规则来自作者拍板：这些资料不许被静默裁掉，宁可停下报错也不丢。
 * 写作注入（memory.read 的 write/revise 用途、pipeline.write 的装配）走这里；
 * 一般浏览目的的 memory.read 保留原样（ok:true + warnings）。
 */

export const HARD_OVERFLOW_WARNING_PREFIX = "hard channel exceeds budget after degradation";

/** 诊断警告里的硬通道溢出原文；没有返回 null。 */
export function findHardOverflowWarning(warnings: readonly string[] | undefined): string | null {
  if (!warnings) return null;
  return warnings.find((warning) => warning.startsWith(HARD_OVERFLOW_WARNING_PREFIX)) ?? null;
}

/** 给模型/作者看的说明：现状、可选动作、为什么宁可报错。
 * `context`：`memory-read`（第三条含 budgetTokens 动作，仅该工具接受该参数）。
 */
export function hardOverflowExplanation(warning: string, context: "memory-read" | "pipeline-write" = "memory-read"): string {
  const size = warning.slice(HARD_OVERFLOW_WARNING_PREFIX.length).replace(/^\s*:?\s*/, "");
  const actions = [
    "1. 调大本书的召回预算（叙事记忆配置 retrieval.maxTokens，硬通道份额随之上调）；",
    "2. 精简受保护内容：范文档数、写前七栏条数、硬状态与知情条目；",
  ];
  if (context === "memory-read") {
    actions.push("3. 需要继续召回时，以更大的 budgetTokens（或只点名需要的通道）重调 memory_read。");
  } else {
    actions.push("3. 调整后在执行画布/叙述者处重开本章写作；本工具不接受直接改预算。");
  }
  return [
    "写作资料超出保护预算，已按规则停下：受保护的硬核资料（硬状态、知情边界、关键伏笔等）",
    `全部降档后仍装不进书级召回预算${size ? `（${size} 估算 token）` : ""}，而这些资料不许被静默裁掉。`,
    "可以这样做：",
    ...actions,
  ].join("\n");
}
