/**
 * 内部 Demo / Mock：如何在对话流中使用工具展示组件。
 *
 * 这个文件展示了如何集成 ToolUseCard、ToolResultCard 和 PermissionPrompt
 * 到示例对话界面中；不接生产工具执行器，不从生产组件 barrel 导出。
 */

import { useState } from "react";
import { ToolUseCard } from "./ToolUseCard";
import { ToolResultCard } from "./ToolResultCard";
import { PermissionPrompt } from "./PermissionPrompt";

// 工具调用的数据结构
interface ToolCall {
  id: string;
  toolName: string;
  params: Record<string, unknown>;
  status: "pending" | "success" | "error";
  timestamp: Date;
  result?: {
    success: boolean;
    data?: unknown;
    error?: string;
  };
}

// 消息类型
interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCall[];
}

export function ToolUsageExample() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [pendingTool, setPendingTool] = useState<{
    toolName: string;
    params: Record<string, unknown>;
  } | null>(null);

  // 处理工具权限请求
  const handleToolPermission = (toolName: string, params: Record<string, unknown>) => {
    setPendingTool({ toolName, params });
  };

  // 批准工具执行
  const handleApprove = async () => {
    if (!pendingTool) return;

    const toolCall: ToolCall = {
      id: crypto.randomUUID(),
      toolName: pendingTool.toolName,
      params: pendingTool.params,
      status: "pending",
      timestamp: new Date(),
    };

    // 添加工具调用到最后一条消息
    setMessages((prev) => {
      const lastMessage = prev[prev.length - 1];
      if (lastMessage && lastMessage.role === "assistant") {
        return [
          ...prev.slice(0, -1),
          {
            ...lastMessage,
            toolCalls: [...(lastMessage.toolCalls || []), toolCall],
          },
        ];
      }
      return prev;
    });

    setPendingTool(null);

    // 模拟工具执行
    try {
      const result = await executeToolMock(pendingTool.toolName, pendingTool.params);

      // 更新工具调用状态
      setMessages((prev) => {
        const lastMessage = prev[prev.length - 1];
        if (lastMessage && lastMessage.role === "assistant") {
          const updatedToolCalls = lastMessage.toolCalls?.map((tc) =>
            tc.id === toolCall.id
              ? { ...tc, status: "success" as const, result }
              : tc
          );
          return [
            ...prev.slice(0, -1),
            { ...lastMessage, toolCalls: updatedToolCalls },
          ];
        }
        return prev;
      });
    } catch (error) {
      // 处理错误
      setMessages((prev) => {
        const lastMessage = prev[prev.length - 1];
        if (lastMessage && lastMessage.role === "assistant") {
          const updatedToolCalls = lastMessage.toolCalls?.map((tc) =>
            tc.id === toolCall.id
              ? {
                  ...tc,
                  status: "error" as const,
                  result: {
                    success: false,
                    error: error instanceof Error ? error.message : "未知错误",
                  },
                }
              : tc
          );
          return [
            ...prev.slice(0, -1),
            { ...lastMessage, toolCalls: updatedToolCalls },
          ];
        }
        return prev;
      });
    }
  };

  // 拒绝工具执行
  const handleDeny = () => {
    setPendingTool(null);
    // 可以在这里通知 AI 工具被拒绝
  };

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
        内部 Demo / Mock：此示例仅展示工具卡片交互，不连接生产工具执行器。
      </div>
      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message) => (
          <div key={message.id} className="space-y-3">
            {/* 消息内容 */}
            <div
              className={`p-4 rounded-lg ${
                message.role === "user"
                  ? "bg-blue-50 dark:bg-blue-950"
                  : "bg-gray-50 dark:bg-gray-900"
              }`}
            >
              {message.content}
            </div>

            {/* 工具调用展示 */}
            {message.toolCalls && message.toolCalls.length > 0 && (
              <div className="ml-4 space-y-2">
                {message.toolCalls.map((toolCall) => (
                  <div key={toolCall.id} className="space-y-2">
                    {/* 工具使用卡片 */}
                    <ToolUseCard
                      toolName={toolCall.toolName}
                      params={toolCall.params}
                      status={toolCall.status}
                      timestamp={toolCall.timestamp}
                    />

                    {/* 工具结果卡片（仅在有结果时显示） */}
                    {toolCall.result && (
                      <ToolResultCard
                        toolName={toolCall.toolName}
                        result={toolCall.result}
                        timestamp={toolCall.timestamp}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 权限请求弹窗 */}
      {pendingTool && (
        <PermissionPrompt
          open={true}
          toolName={pendingTool.toolName}
          params={pendingTool.params}
          onApprove={handleApprove}
          onDeny={handleDeny}
          onClose={handleDeny}
        />
      )}

      {/* 测试按钮 */}
      <div className="p-4 border-t">
        <button
          onClick={() => {
            handleToolPermission("Read", {
              file_path: "/path/to/file.txt",
              limit: 100,
            });
          }}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          测试工具权限请求
        </button>
      </div>
    </div>
  );
}

// 模拟工具执行
async function executeToolMock(
  toolName: string,
  params: Record<string, unknown>
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  // 模拟网络延迟
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // 模拟不同工具的返回结果
  switch (toolName) {
    case "Read":
      return {
        success: true,
        data: "File contents here...\nLine 1\nLine 2\nLine 3",
      };
    case "Write":
      return {
        success: true,
        data: "File written successfully",
      };
    case "Bash":
      return {
        success: true,
        data: "Command output:\ntotal 48\ndrwxr-xr-x 12 user staff 384 Apr 17 10:00 .",
      };
    default:
      return {
        success: true,
        data: `工具 ${toolName} 已执行，参数：${JSON.stringify(params)}`,
      };
  }
}
