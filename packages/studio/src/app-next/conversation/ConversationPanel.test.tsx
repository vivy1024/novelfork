import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConversationPanel, ConversationHeader, GitStatusBar, InputArea } from "./ConversationPanel";

afterEach(() => { cleanup(); });

describe("ConversationHeader", () => {
  it("renders title and action buttons", () => {
    const onDetails = vi.fn();
    const onArchive = vi.fn();
    render(<ConversationHeader title="凡人修仙写作" onShowDetails={onDetails} onArchive={onArchive} />);

    expect(screen.getByText("凡人修仙写作")).toBeTruthy();
    fireEvent.click(screen.getByTitle("会话详情"));
    expect(onDetails).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByTitle("归档"));
    expect(onArchive).toHaveBeenCalledOnce();
  });
});

describe("GitStatusBar", () => {
  it("renders branch and diff stats", () => {
    render(<GitStatusBar branch="master" additions={100} deletions={50} />);
    expect(screen.getByText("master")).toBeTruthy();
    expect(screen.getByText("+100")).toBeTruthy();
    expect(screen.getByText("-50")).toBeTruthy();
  });

  it("renders nothing when no branch", () => {
    const { container } = render(<GitStatusBar />);
    expect(container.innerHTML).toBe("");
  });
});

describe("InputArea", () => {
  it("sends message on Enter and clears input", () => {
    const onSend = vi.fn();
    render(<InputArea onSend={onSend} />);

    const input = screen.getByLabelText("消息输入框") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "写第一章" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSend).toHaveBeenCalledWith("写第一章");
    expect(input.value).toBe("");
  });

  it("shows abort button when generating", () => {
    const onAbort = vi.fn();
    render(<InputArea onSend={vi.fn()} onAbort={onAbort} isGenerating />);

    expect(screen.getByText("中断")).toBeTruthy();
    fireEvent.click(screen.getByText("中断"));
    expect(onAbort).toHaveBeenCalledOnce();
  });

  it("shows context percent indicator", () => {
    render(<InputArea onSend={vi.fn()} contextPercent={34.7} />);
    expect(screen.getByText("34.7%")).toBeTruthy();
  });

  it("disables send when input is empty", () => {
    render(<InputArea onSend={vi.fn()} />);
    expect(screen.getByText("发送").closest("button")?.disabled).toBe(true);
  });
});

describe("ConversationPanel", () => {
  it("shows empty state when no session", () => {
    render(<ConversationPanel />);
    expect(screen.getByTestId("conversation-empty")).toBeTruthy();
    expect(screen.getByText(/从叙事线选择书籍/)).toBeTruthy();
  });

  it("renders chat content when session is active", () => {
    render(
      <ConversationPanel
        hasSession
        title="写作会话"
        chatContent={<div>对话消息</div>}
        inputProps={{ onSend: vi.fn() }}
      />,
    );

    expect(screen.getByTestId("conversation-panel")).toBeTruthy();
    expect(screen.getByText("写作会话")).toBeTruthy();
    expect(screen.getByText("对话消息")).toBeTruthy();
  });

  it("switches between chat and git views", () => {
    render(
      <ConversationPanel
        hasSession
        chatContent={<div>对话内容</div>}
        gitContent={<div>Git 变更</div>}
        inputProps={{ onSend: vi.fn() }}
      />,
    );

    expect(screen.getByText("对话内容")).toBeTruthy();
    expect(screen.queryByText("Git 变更")).toBeNull();

    fireEvent.click(screen.getByText("Git"));
    expect(screen.queryByText("对话内容")).toBeNull();
    expect(screen.getByText("Git 变更")).toBeTruthy();

    fireEvent.click(screen.getByText("对话"));
    expect(screen.getByText("对话内容")).toBeTruthy();
  });

  it("shows git status bar", () => {
    render(
      <ConversationPanel
        hasSession
        gitStatus={{ branch: "feature/ch1", additions: 200, deletions: 30 }}
        inputProps={{ onSend: vi.fn() }}
      />,
    );

    expect(screen.getByText("feature/ch1")).toBeTruthy();
  });
});
