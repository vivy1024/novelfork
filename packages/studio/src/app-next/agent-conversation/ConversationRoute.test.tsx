import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// jsdom 未实现 scrollTo / IntersectionObserver（broad-infinite-list 虚拟列表依赖），补 noop polyfill。
beforeAll(() => {
  if (!Element.prototype.scrollTo) {
    Element.prototype.scrollTo = () => {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
  if (!("IntersectionObserver" in globalThis)) {
    class MockIntersectionObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() { return []; }
    }
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = MockIntersectionObserver;
  }
});

import { ConversationRoute, type ConversationRouteMessage } from "./ConversationRoute";

const messages: ConversationRouteMessage[] = [{ id: "message-1", role: "assistant", content: "欢迎回到叙述者会话" }];

afterEach(() => cleanup());

describe("ConversationRoute", () => {
  it("空 session 时显示新建/选择会话空状态", () => {
    render(<ConversationRoute />);

    expect(screen.getByTestId("conversation-route-empty")).toBeTruthy();
    expect(screen.getByText("选择或新建叙述者会话")).toBeTruthy();
    expect(screen.getByText("请从 shell 会话列表选择一个会话，或创建新会话后开始对话。")).toBeTruthy();
  });

  it("有 session 时挂载 ConversationSurface 并透传初始状态", () => {
    render(
      <ConversationRoute
        sessionId="session-1"
        title="第三章会话"
        initialMessages={messages}
        initialStatus={{ state: "ready", label: "就绪", modelLabel: "sub2api / gpt-5.4" }}
        initialConfirmation={{ id: "confirm-1", title: "创建候选稿", summary: "将生成第三章候选" }}
      />,
    );

    expect(screen.getByTestId("conversation-route")).toBeTruthy();
    expect(screen.getByTestId("conversation-surface")).toBeTruthy();
    expect(screen.getByText("第三章会话")).toBeTruthy();
    expect(screen.getByText("sub2api / gpt-5.4")).toBeTruthy();
    expect(screen.getByText("欢迎回到叙述者会话")).toBeTruthy();
    expect(screen.getByText("将生成第三章候选")).toBeTruthy();
  });

  it("发送消息时复用 runtime message envelope builder，不连接真实 WebSocket", () => {
    const onClientEnvelope = vi.fn();
    render(
      <ConversationRoute
        sessionId="session-1"
        sessionMode="chat"
        initialAck={7}
        initialMessages={messages}
        createMessageId={() => "client-message-1"}
        onClientEnvelope={onClientEnvelope}
      />,
    );

    fireEvent.change(screen.getByLabelText("对话输入框"), { target: { value: "  继续写  " } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(onClientEnvelope).toHaveBeenCalledWith({
      type: "session:message",
      sessionId: "session-1",
      messageId: "client-message-1",
      content: "继续写",
      sessionMode: "chat",
      ack: 7,
      canvasContext: undefined,
    });
  });

  it("中断时复用 runtime abort envelope builder", () => {
    vi.useFakeTimers();
    try {
      const onClientEnvelope = vi.fn();
      render(<ConversationRoute sessionId="session-1" initialStatus={{ state: "running", label: "生成中" }} onClientEnvelope={onClientEnvelope} />);

      // 运行中且输入框为空时，中断按钮改为「长按确认」（HoldAbortButton），需按住 800ms 才触发。
      const abortButton = screen.getByRole("button", { name: "中断（长按确认）" });
      fireEvent.mouseDown(abortButton);
      act(() => { vi.advanceTimersByTime(850); });

      expect(onClientEnvelope).toHaveBeenCalledWith({ type: "session:abort", sessionId: "session-1" });
    } finally {
      vi.useRealTimers();
    }
  });
});
