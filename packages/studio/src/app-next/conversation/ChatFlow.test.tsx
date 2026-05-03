import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatFlow, type ChatMessage, type ChatToolCall } from "./ChatFlow";

afterEach(() => { cleanup(); });

const messages: ChatMessage[] = [
  { id: "m1", role: "user", content: "写第一章" },
  { id: "m2", role: "assistant", content: "好的，我来查看当前书籍状态。", toolCalls: [
    { id: "tc1", toolName: "cockpit.get_snapshot", status: "completed", result: { ok: true, summary: "书籍状态：0章" }, durationMs: 3 },
  ] },
  { id: "m3", role: "assistant", content: "驾驶舱显示当前0章，准备开始写作。" },
];

describe("ChatFlow", () => {
  it("renders user and assistant messages", () => {
    render(<ChatFlow messages={messages} />);

    expect(screen.getByText("写第一章")).toBeTruthy();
    expect(screen.getByText("好的，我来查看当前书籍状态。")).toBeTruthy();
    expect(screen.getByText("驾驶舱显示当前0章，准备开始写作。")).toBeTruthy();
  });

  it("renders tool call cards inline", () => {
    render(<ChatFlow messages={messages} />);

    expect(screen.getByText("cockpit.get_snapshot")).toBeTruthy();
    expect(screen.getByText("完成")).toBeTruthy();
    expect(screen.getByText("3ms")).toBeTruthy();
    expect(screen.getByText("书籍状态：0章")).toBeTruthy();
  });

  it("shows empty state when no messages", () => {
    render(<ChatFlow messages={[]} />);
    expect(screen.getByText("发送消息开始对话。")).toBeTruthy();
  });

  it("shows streaming indicator when generating", () => {
    render(<ChatFlow messages={messages} isStreaming />);
    // 打字动画点
    const dots = screen.getByTestId("chat-flow").querySelectorAll(".chat-typing-dot");
    expect(dots.length).toBe(3);
  });

  it("shows streaming content with cursor", () => {
    render(<ChatFlow messages={messages} isStreaming streamingContent="正在生成第一章..." />);
    expect(screen.getByText(/正在生成第一章/)).toBeTruthy();
  });

  it("uses custom tool call renderer", () => {
    const customRenderer = (tc: ChatToolCall) => <div data-testid="custom-tc">{tc.toolName} 自定义</div>;
    render(<ChatFlow messages={messages} renderToolCall={customRenderer} />);

    expect(screen.getByTestId("custom-tc")).toBeTruthy();
    expect(screen.getByText("cockpit.get_snapshot 自定义")).toBeTruthy();
  });

  it("does not render system messages", () => {
    const withSystem: ChatMessage[] = [
      { id: "s1", role: "system", content: "你是写作助手" },
      ...messages,
    ];
    render(<ChatFlow messages={withSystem} />);
    expect(screen.queryByText("你是写作助手")).toBeNull();
  });
});
