import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { ToolCallBlock } from "./ToolCallBlock";
import { parseAssistantPayload } from "./tool-call-utils";

vi.stubGlobal("navigator", {
  clipboard: {
    writeText: vi.fn().mockResolvedValue(undefined),
  },
});

describe("ToolCallBlock", () => {
  it("renders status, summary and expandable details", () => {
    render(
      <ToolCallBlock
        toolCall={{
          toolName: "Bash",
          status: "running",
          summary: "正在执行 git status",
          command: "git status --short",
          output: " M packages/studio/src/components/ChatWindow.tsx",
          duration: 420,
        }}
      />,
    );

    expect(screen.getByText("Bash")).toBeTruthy();
    expect(screen.getByText("执行中")).toBeTruthy();
    expect(screen.getByText("正在执行 git status")).toBeTruthy();
    expect(screen.queryByText("git status --short")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "展开工具调用详情" }));

    expect(screen.getByText("git status --short")).toBeTruthy();
    expect(screen.getByText(/ChatWindow\.tsx/)).toBeTruthy();
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
