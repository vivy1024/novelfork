/**
 * AI usage disclosure generator.
 */

import type { AiDisclosure, BookAiTasteReport, SupportedPlatform } from "./types.js";

export interface AiDisclosureInput {
  readonly bookId: string;
  readonly platform: SupportedPlatform;
  readonly aiTasteReport: BookAiTasteReport;
  readonly aiUsageTypes?: ReadonlyArray<string>;
  readonly modelNames?: ReadonlyArray<string>;
  readonly humanEditDescription?: string;
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
    `- 本地 AI 味风险：${input.aiTasteReport.overallRiskLevel}`,
    `- 使用模型：${modelNames.join("、")}`,
    `- 人工修改说明：${humanEditDescription}`,
    "",
    "说明：AI 味风险只用于提示可能需要复核的表达特征，不能判断 AI 生成比例，也不代表平台审核结论。",
  ].join("\n");

  return {
    bookId: input.bookId,
    platform: input.platform,
    aiUsageTypes,
    aiTasteRiskLevel: input.aiTasteReport.overallRiskLevel,
    modelNames,
    humanEditDescription,
    markdownText,
  };
}
