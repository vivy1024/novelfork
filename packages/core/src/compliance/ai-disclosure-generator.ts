/**
 * AI usage disclosure generator.
 */

import type { AiDisclosure, BookAiRatioReport, SupportedPlatform } from "./types.js";

export interface AiDisclosureInput {
  readonly bookId: string;
  readonly platform: SupportedPlatform;
  readonly aiRatioReport: BookAiRatioReport;
  readonly aiUsageTypes?: ReadonlyArray<string>;
  readonly modelNames?: ReadonlyArray<string>;
  readonly humanEditDescription?: string;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function generateAiDisclosure(input: AiDisclosureInput): AiDisclosure {
  const aiUsageTypes = input.aiUsageTypes?.length ? input.aiUsageTypes : ["大纲辅助", "校对", "风格检查"];
  const modelNames = input.modelNames?.length ? input.modelNames : ["未记录"];
  const humanEditDescription = input.humanEditDescription?.trim()
    || "作者对所有正文内容进行了人工确认、修改和最终定稿。";

  const markdownText = [
    "# AI 辅助使用说明",
    "",
    `- 作品 ID：${input.bookId}`,
    `- 目标平台：${input.platform}`,
    `- AI 辅助类型：${aiUsageTypes.join("、")}`,
    `- 估算 AI 辅助比例：${formatPercent(input.aiRatioReport.overallAiRatio)}`,
    `- 使用模型：${modelNames.join("、")}`,
    `- 人工修改说明：${humanEditDescription}`,
    "",
    "说明：以上比例基于 AI 味特征的粗略估算，不代表精确 AI 生成比例；最终以平台审核和作者实际创作记录为准。",
  ].join("\n");

  return {
    bookId: input.bookId,
    platform: input.platform,
    aiUsageTypes,
    estimatedAiRatio: input.aiRatioReport.overallAiRatio,
    modelNames,
    humanEditDescription,
    markdownText,
  };
}
