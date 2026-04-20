import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ToolCallBlock } from "./ToolCallBlock";
import { parseAssistantPayload } from "./tool-call-utils";

vi.stubGlobal("navigator", {
  clipboard: {
    writeText: vi.fn().mockResolvedValue(undefined),
  },
});

afterEach(() => {
  cleanup();
});

describe("ToolCallBlock", () => {
  it("renders status, summary and differentiated bash details", () => {
    render(
      <ToolCallBlock
        toolCall={{
          toolName: "Bash",
          status: "running",
          summary: "正在执行 git status",
          command: "git status --short",
          output: " M packages/studio/src/components/ChatWindow.tsx",
          duration: 420,
          startedAt: 1710000000000,
        }}
      />,
    );

    expect(screen.getByText("Bash")).toBeTruthy();
    expect(screen.getByText("执行中")).toBeTruthy();
    expect(screen.getByText("正在执行 git status")).toBeTruthy();
    expect(screen.getByText("Shell")).toBeTruthy();
    expect(screen.getByRole("button", { name: "复制工具命令" })).toBeTruthy();
    expect(screen.queryByText("标准输出")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "展开工具调用详情" }));

    expect(screen.getAllByText("git status --short").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("标准输出")).toBeTruthy();
    expect(screen.getByText(/ChatWindow\.tsx/)).toBeTruthy();
  });

  it("shows file target for read tool calls", () => {
    render(
      <ToolCallBlock
        toolCall={{
          toolName: "Read",
          status: "success",
          summary: "已读取大纲",
          input: { file_path: "books/demo/outline.md" },
          output: "# 大纲",
          duration: 38,
        }}
      />,
    );

    expect(screen.getByText("读取")).toBeTruthy();
    expect(screen.getByText(/books\/demo\/outline\.md/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "复制工具输出" })).toBeTruthy();
  });

  it("renders a dedicated subagent card for agent tool calls", () => {
    render(
      <ToolCallBlock
        toolCall={{
          toolName: "Agent",
          status: "success",
          summary: "并行处理 ProjectCreate 对象流",
          input: {
            description: "project create flow",
            subagent_type: "general",
            model: "codex:gpt-5.4",
            prompt: "推进 ProjectCreate 对象流",
          },
          result: {
            status: "completed",
            summary: "完成项目创建链路改造",
          },
          duration: 1800,
        }}
      />,
    );

    const subagentCard = screen.getByTestId("subagent-card");
    expect(screen.getByText("子代理卡片")).toBeTruthy();
    expect(subagentCard.textContent).toContain("project create flow");
    expect(subagentCard.textContent).toContain("general");
    expect(subagentCard.textContent).toContain("codex:gpt-5.4");
    expect(subagentCard.textContent).toContain("completed");
    expect(subagentCard.textContent).toContain("完成项目创建链路改造");
  });

  it("parses mock-friendly assistant payload with tool calls", () => {
    const parsed = parseAssistantPayload({
      message: "已读取文件",
      tool_calls: [
        {
          id: "call-1",
          tool_name: "Read",
          status: "success",
          arguments: { file_path: "books/demo/outline.md" },
          result: "# 大纲",
          durationMs: 38,
        },
      ],
    });

    expect(parsed.content).toBe("已读取文件");
    expect(parsed.toolCalls).toHaveLength(1);
    expect(parsed.toolCalls[0]).toMatchObject({
      id: "call-1",
      toolName: "Read",
      status: "success",
      duration: 38,
      output: "# 大纲",
    });
  });
});
