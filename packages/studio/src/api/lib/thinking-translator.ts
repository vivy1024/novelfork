/**
 * 检测 AI 回复中的 thinking/reasoning block，
 * 调用摘要模型翻译为用户语言。
 */

import { generateSessionReply } from "./llm-runtime-service.js";

const THINKING_BLOCK_REGEX = /<(thinking|reasoning)>([\s\S]*?)<\/\1>/gi;

function parseSummaryModelRef(summaryModel: string): { providerId: string; modelId: string } | null {
  if (!summaryModel) return null;
  const colonIndex = summaryModel.indexOf(":");
  if (colonIndex <= 0) return null;
  const providerId = summaryModel.slice(0, colonIndex);
  const modelId = summaryModel.slice(colonIndex + 1);
  return providerId && modelId ? { providerId, modelId } : null;
}

export async function translateThinkingBlocks(
  content: string,
  options: {
    summaryModel: string;
    targetLanguage: string;
  },
): Promise<{
  originalContent: string;
  translatedContent: string;
  hasThinkingBlocks: boolean;
}> {
  const matches = [...content.matchAll(THINKING_BLOCK_REGEX)];
  if (matches.length === 0) {
    return { originalContent: content, translatedContent: content, hasThinkingBlocks: false };
  }

  const modelRef = parseSummaryModelRef(options.summaryModel);
  if (!modelRef) {
    return { originalContent: content, translatedContent: content, hasThinkingBlocks: true };
  }

  let translatedContent = content;
  for (const match of matches) {
    const fullMatch = match[0];
    const tagName = match[1];
    const thinkingContent = match[2];
    if (!thinkingContent?.trim()) continue;

    try {
      const langLabel = options.targetLanguage === "zh" ? "中文" : options.targetLanguage;
      const result = await generateSessionReply({
        sessionConfig: {
          providerId: modelRef.providerId,
          modelId: modelRef.modelId,
          permissionMode: "allow",
          reasoningEffort: "low",
        },
        messages: [
          {
            type: "message" as const,
            id: "system-translate",
            role: "system" as const,
            content: `将以下 AI 推理内容翻译为${langLabel}，保持技术术语准确：\n\n${thinkingContent}`,
          },
        ],
      });

      if (result.success && result.type === "message" && result.content.trim()) {
        translatedContent = translatedContent.replace(
          fullMatch,
          `<${tagName}>${result.content.trim()}</${tagName}>`,
        );
      }
    } catch {
      // 翻译失败 → 保留原始内容
    }
  }

  return { originalContent: content, translatedContent, hasThinkingBlocks: true };
}
