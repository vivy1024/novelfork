import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConversationSurface, type ConversationSurfaceMessage } from "./ConversationSurface";
import { Composer } from "./Composer";
import { ConfirmationGate } from "./ConfirmationGate";
import { MessageStream } from "./MessageStream";
import { ToolCallCard } from "./ToolCallCard";

const messages: ConversationSurfaceMessage[] = [
  { id: "m-user", role: "user", content: "帮我生成第三章" },
  {
    id: "m-assistant",
    role: "assistant",
    content: "我先读取驾驶舱，再给出候选计划。",
    toolCalls: [
      {
        id: "tool-1",
        toolName: "cockpit.get_snapshot",
        status: "success",
        summary: "已读取驾驶舱快照",
        input: { bookId: "book-1" },
        result: { ok: true, renderer: "cockpit.snapshot", data: { book: "灵潮纪元" } },
        durationMs: 42,
      },
    ],
  },
];

afterEach(() => cleanup());

describe("Conversation Surface", () => {
  it("渲染单栏消息流和内联工具卡", () => {
    render(<MessageStream messages={messages} />);

    expect(screen.getByTestId("message-stream")).toBeTruthy();
    expect(screen.getByText("帮我生成第三章")).toBeTruthy();
    expect(screen.getByText("我先读取驾驶舱，再给出候选计划。")).toBeTruthy();
    const card = screen.getByTestId("tool-call-card-tool-1");
    expect(card.textContent).toContain("cockpit.get_snapshot");
    expect(card.textContent).toContain("完成");
    expect(card.textContent).toContain("已读取驾驶舱快照");
    expect(card.textContent).toContain("42ms");
  });

  it("工具卡保留输入和结果的 raw data 展开能力", () => {
    render(
      <ToolCallCard
        toolCall={{
          id: "tool-raw",
          toolName: "candidate.create_chapter",
          status: "running",
          summary: "正在创建候选稿",
          input: { chapterNumber: 3 },
          result: { ok: true, data: { candidateId: "cand-3" } },
        }}
      />,
    );

    expect(screen.getByText("candidate.create_chapter")).toBeTruthy();
    expect(screen.getByText("执行中")).toBeTruthy();
    expect(screen.queryByText(/chapterNumber/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "展开工具原始数据" }));

    expect(screen.getByText(/"chapterNumber": 3/)).toBeTruthy();
    expect(screen.getByText(/"candidateId": "cand-3"/)).toBeTruthy();
  });

  it("确认门触发 approve/reject 回调", () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    render(
      <ConfirmationGate
        confirmation={{ id: "confirm-1", title: "创建候选稿", summary: "将创建第 3 章候选稿" }}
        onApprove={onApprove}
        onReject={onReject}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "批准" }));
    expect(onApprove).toHaveBeenCalledWith("confirm-1");
    fireEvent.click(screen.getByRole("button", { name: "拒绝" }));
    expect(onReject).toHaveBeenCalledWith("confirm-1");
  });

  it("composer 支持发送和中断", () => {
    const onSend = vi.fn();
    const onAbort = vi.fn();
    const { rerender } = render(<Composer onSend={onSend} onAbort={onAbort} />);

    const input = screen.getByLabelText("对话输入框") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "  继续写  " } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(onSend).toHaveBeenCalledWith("继续写");
    expect(input.value).toBe("");

    rerender(<Composer onSend={onSend} onAbort={onAbort} isRunning />);
    fireEvent.click(screen.getByRole("button", { name: "中断" }));
    expect(onAbort).toHaveBeenCalledOnce();
  });

  it("ConversationSurface 组合状态栏、确认门、消息流和 composer", () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    const onSend = vi.fn();
    render(
      <ConversationSurface
        title="叙述者"
        status={{ state: "ready", label: "就绪", modelLabel: "sub2api / gpt-5.4" }}
        messages={messages}
        pendingConfirmation={{ id: "confirm-surface", title: "确认计划" }}
        onApproveConfirmation={onApprove}
        onRejectConfirmation={onReject}
        onSend={onSend}
      />,
    );

    expect(screen.getByTestId("conversation-surface")).toBeTruthy();
    expect(screen.getByText("叙述者")).toBeTruthy();
    expect(screen.getByText("sub2api / gpt-5.4")).toBeTruthy();
    fireEvent.click(within(screen.getByTestId("confirmation-gate")).getByRole("button", { name: "批准" }));
    expect(onApprove).toHaveBeenCalledWith("confirm-surface");
  });
});
