import type { ToolCall } from "@/shared/session-types";
import type { ConversationToolCall } from "./ToolCallCard";

/**
 * 将 ConversationSurface 的简化 ConversationToolCall 适配为
 * ToolCallBlock 需要的完整 ToolCall 类型。
 */
export function adaptConversationToolCall(ctc: ConversationToolCall): ToolCall {
  return {
    id: ctc.id,
    toolName: ctc.toolName,
    status: ctc.status,
    summary: ctc.summary,
    input: ctc.input,
    output: ctc.output,
    error: ctc.error,
    exitCode: ctc.exitCode,
    duration: ctc.durationMs,
    result: ctc.result != null ? (ctc.result as Record<string, unknown>) : undefined,
  };
}
