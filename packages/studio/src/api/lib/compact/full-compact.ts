/**
 * Full Compact — AI 摘要压缩
 *
 * 参考 Claude Code CLI 的 compact.ts + prompt.ts。
 * 调用摘要模型生成对话摘要，替换旧消息。
 */

import type { AgentTurnItem } from "../agent-turn-runtime.js";
import type { SessionConfig } from "../../../shared/session-types.js";
import { generateSessionReply } from "../llm-runtime-service.js";
import { loadUserConfig } from "../user-config-service.js";

const COMPACT_MAX_OUTPUT_TOKENS = 20_000;
const MAX_CONSECUTIVE_FAILURES = 3;

let consecutiveFailures = 0;

const COMPACT_SYSTEM_PROMPT = "你是一个对话摘要助手。你的任务是将一段长对话压缩为结构化摘要，保留所有关键信息。";

const COMPACT_USER_PROMPT_TEMPLATE = `请将以下对话压缩为结构化摘要。保留以下信息：

1. **用户的主要写作请求和意图**
2. **当前章节进度和书籍状态**（书名、已完成章节数、当前焦点）
3. **经纬/设定变更记录**（人物、地点、势力、伏笔的增删改）
4. **工具调用历史摘要**（调用了哪些工具、关键结果）
5. **待办任务和下一步**（用户明确要求但尚未完成的事项）
6. **当前活跃的引导式生成状态**（如果有 guided generation plan）

输出格式：
<summary>
[结构化摘要内容]
</summary>

对话内容：
`;

/**
 * 将消息数组格式化为可读的对话文本。
 */
function formatMessagesForCompact(messages: readonly AgentTurnItem[]): string {
  return messages.map((msg) => {
    if (msg.type === "message") {
      const role = msg.role === "user" ? "用户" : msg.role === "assistant" ? "AI" : "系统";
      return `[${role}] ${msg.content}`;
    }
    if (msg.type === "tool_call") {
      return `[工具调用] ${msg.name}(${JSON.stringify(msg.input).substring(0, 200)})`;
    }
    if (msg.type === "tool_result") {
      return `[工具结果] ${msg.name}: ${msg.content.substring(0, 300)}`;
    }
    return "";
  }).filter(Boolean).join("\n\n");
}

/**
 * 从 AI 回复中提取 <summary> 标签内容。
 */
function extractSummary(content: string): string {
  const match = content.match(/<summary>([\s\S]*?)<\/summary>/);
  if (match?.[1]) {
    return match[1].trim();
  }
  // 没有 summary 标签，返回整个内容
  return content.trim();
}

export interface FullCompactResult {
  readonly success: boolean;
  readonly messages: readonly AgentTurnItem[];
  readonly summary?: string;
  readonly error?: string;
}

/**
 * Full Compact: 调用摘要模型生成对话摘要，替换旧消息。
 *
 * 返回压缩后的消息数组（system prompt + 摘要 + 最近的用户消息）。
 * 连续失败 3 次后熔断，返回原消息。
 */
export async function fullCompact(
  messages: readonly AgentTurnItem[],
  sessionConfig: SessionConfig,
): Promise<FullCompactResult> {
  // 熔断检查
  if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    return {
      success: false,
      messages,
      error: `Full compact 已熔断：连续失败 ${consecutiveFailures} 次`,
    };
  }

  // 读取摘要模型配置
  const userConfig = await loadUserConfig();
  const summaryModelRef = userConfig.modelDefaults.summaryModel;

  if (!summaryModelRef) {
    return {
      success: false,
      messages,
      error: "未配置摘要模型，无法执行 Full Compact",
    };
  }

  // 解析 providerId:modelId
  const [providerId, modelId] = summaryModelRef.split(":");
  if (!providerId || !modelId) {
    return {
      success: false,
      messages,
      error: `摘要模型配置格式错误: ${summaryModelRef}`,
    };
  }

  // 构建压缩请求
  const conversationText = formatMessagesForCompact(messages);
  const compactPrompt = `${COMPACT_USER_PROMPT_TEMPLATE}${conversationText}`;

  try {
    const result = await generateSessionReply({
      sessionConfig: {
        ...sessionConfig,
        providerId,
        modelId,
      },
      messages: [
        { type: "message", role: "system", content: COMPACT_SYSTEM_PROMPT },
        { type: "message", role: "user", content: compactPrompt },
      ],
    });

    if (!result.success) {
      consecutiveFailures += 1;
      return {
        success: false,
        messages,
        error: `摘要模型调用失败: ${result.error}`,
      };
    }

    if (result.type === "tool_use" || !result.content?.trim()) {
      consecutiveFailures += 1;
      return {
        success: false,
        messages,
        error: "摘要模型返回了空内容或工具调用",
      };
    }

    // 成功，重置失败计数
    consecutiveFailures = 0;

    const summary = extractSummary(result.content);

    // 构建压缩后的消息：system + 摘要 + 最近一条用户消息
    const compactedMessages: AgentTurnItem[] = [];

    // 保留原始 system prompt（如果有）
    const systemMsg = messages.find((m) => m.type === "message" && m.role === "system");
    if (systemMsg) {
      compactedMessages.push(systemMsg);
    }

    // 添加摘要作为 assistant 消息
    compactedMessages.push({
      type: "message",
      role: "assistant",
      content: `[对话摘要]\n\n${summary}`,
      id: `compact-summary-${Date.now()}`,
    });

    // 保留最近的用户消息（如果有）
    const lastUserMsg = [...messages].reverse().find((m) => m.type === "message" && m.role === "user");
    if (lastUserMsg) {
      compactedMessages.push(lastUserMsg);
    }

    return {
      success: true,
      messages: compactedMessages,
      summary,
    };
  } catch (error) {
    consecutiveFailures += 1;
    return {
      success: false,
      messages,
      error: `Full compact 异常: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 重置熔断计数（用于测试或手动恢复）。
 */
export function resetCompactFailures(): void {
  consecutiveFailures = 0;
}

/**
 * 获取当前连续失败次数。
 */
export function getCompactFailureCount(): number {
  return consecutiveFailures;
}
