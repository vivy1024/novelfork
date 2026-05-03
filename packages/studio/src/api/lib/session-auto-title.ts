/**
 * 根据对话内容自动生成会话标题。
 * 调用摘要模型（modelDefaults.summaryModel），生成最多 20 字的标题。
 * 摘要模型未配置时使用用户消息前 30 字符作为 fallback。
 */

import type { NarratorSessionChatMessage } from "../../shared/session-types.js";
import { generateSessionReply } from "./llm-runtime-service.js";
import { loadUserConfig } from "./user-config-service.js";

const MAX_TITLE_LENGTH = 30;
const FALLBACK_LENGTH = 30;

function parseSummaryModelRef(summaryModel: string): { providerId: string; modelId: string } | null {
  if (!summaryModel) return null;
  const colonIndex = summaryModel.indexOf(":");
  if (colonIndex <= 0) return null;
  const providerId = summaryModel.slice(0, colonIndex);
  const modelId = summaryModel.slice(colonIndex + 1);
  return providerId && modelId ? { providerId, modelId } : null;
}

function firstUserContent(messages: readonly NarratorSessionChatMessage[]): string {
  for (const message of messages) {
    if (message.role === "user" && message.content.trim()) {
      return message.content.trim();
    }
  }
  return "";
}

export async function generateSessionTitle(
  messages: readonly NarratorSessionChatMessage[],
): Promise<string> {
  if (messages.length === 0) {
    return "Untitled Session";
  }

  const userContent = firstUserContent(messages);
  if (!userContent) {
    return "Untitled Session";
  }

  let summaryModelRef: { providerId: string; modelId: string } | null = null;
  try {
    const config = await loadUserConfig();
    summaryModelRef = parseSummaryModelRef(config.modelDefaults.summaryModel);
  } catch {
    // config load failure → fallback
  }

  if (!summaryModelRef) {
    return userContent.slice(0, FALLBACK_LENGTH);
  }

  try {
    const contextMessages = messages.slice(0, 3);
    const result = await generateSessionReply({
      sessionConfig: {
        providerId: summaryModelRef.providerId,
        modelId: summaryModelRef.modelId,
        permissionMode: "allow",
        reasoningEffort: "low",
      },
      messages: [
        { type: "message" as const, id: "system-title", role: "system" as const, content: "根据以下对话内容生成一个简短的中文标题（最多20字，不要引号）" },
        ...contextMessages.map((m, i) => ({
          type: "message" as const,
          id: `ctx-${i}`,
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      ],
    });

    if (result.success && result.type === "message" && result.content.trim()) {
      return result.content.trim().slice(0, MAX_TITLE_LENGTH);
    }
  } catch {
    // LLM failure → fallback
  }

  return userContent.slice(0, FALLBACK_LENGTH);
}
