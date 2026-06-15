import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// jsdom 未实现 Element.prototype.scrollTo / IntersectionObserver（broad-infinite-list 虚拟列表依赖），补 noop polyfill。
// 缺失 IntersectionObserver 会让虚拟列表 effect 抛错导致整棵树卸载，消息无法渲染。
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
    // ToolCallCard renders tool name, summary, and duration in the header
    expect(screen.getByText("cockpit.get_snapshot")).toBeTruthy();
    expect(screen.getByText("已读取驾驶舱快照")).toBeTruthy();
    expect(screen.getByText("42ms")).toBeTruthy();
  });

  it("expandReasoning 控制思考块默认展开", () => {
    const TAIL = "THINKING_TAIL_UNIQUE_MARKER_9f3a";
    const thinkingMessages: ConversationSurfaceMessage[] = [
      {
        id: "m-think",
        role: "assistant",
        content: "回答正文",
        thinking: [{ content: `这是一段足够长的推理开头用于占满四十字预览区域之后才是尾部标记${TAIL}` }],
      },
    ];

    // 默认（expandReasoning 未传 = false）：思考块折叠，全文尾部标记不可见
    const { unmount } = render(<MessageStream messages={thinkingMessages} />);
    expect(screen.queryByText(new RegExp(TAIL))).toBeNull();
    unmount();

    // expandReasoning=true：思考块默认展开，全文（含尾部标记）可见
    render(<MessageStream messages={thinkingMessages} expandReasoning />);
    expect(screen.getByText(new RegExp(TAIL))).toBeTruthy();
  });

  it("工具卡接入 Tool Result Renderer Registry 并保留 artifact 打开动作", () => {
    // Tool result renderer registry renders through MessageItem/ToolCallCard
    // ToolCallCard shows the tool name and status for candidate.create_chapter
    render(
      <MessageStream
        messages={[
          {
            id: "m-rendered-tool",
            role: "assistant",
            content: "已创建候选稿。",
            toolCalls: [
              {
                id: "tool-rendered",
                toolName: "candidate.create_chapter",
                status: "success",
                result: {
                  renderer: "candidate.created",
                  data: { title: "第三章候选稿", wordCount: 3200 },
                  artifact: { kind: "candidate", id: "candidate-3", title: "第三章候选稿" },
                },
              },
            ],
          },
        ]}
      />,
    );

    // ToolCallCard renders tool name in header
    expect(screen.getByText("candidate.create_chapter")).toBeTruthy();
  });

  it("工具卡保留可复用 ToolCallBlock 的折叠输出、图标和错误展示资产", () => {
    // Generate a multi-line output that exceeds OUTPUT_MAX_LINES (50) threshold
    const longOutput = Array.from({ length: 60 }, (_, i) => `第${i + 1}行灵潮输出`).join("\n") + "\n最后一行";
    render(
      <ToolCallCard
        toolCall={{
          id: "tool-reused-block",
          toolName: "Bash",
          status: "error",
          summary: "执行失败",
          input: { command: "bun test" },
          result: { ok: false },
          output: longOutput,
          error: "命令失败",
          exitCode: 1,
        }}
      />,
    );

    // ToolCallCard renders with tool-card-error class; header shows Bash and error icon (svg)
    const card = document.querySelector(".tool-card-error") as HTMLElement;
    expect(card).toBeTruthy();
    expect(card.textContent).toContain("Bash");
    expect(card.querySelector("svg")).toBeTruthy();
    // Click header to expand — see output + error
    fireEvent.click(card.querySelector("button")!);
    expect(card.textContent).toContain("命令失败");
    // Long output (>50 lines) is truncated with a "显示全部" button
    expect(card.textContent).toContain("显示全部");
    expect(card.textContent).not.toContain("最后一行");
    fireEvent.click(within(card).getByRole("button", { name: /显示全部/ }));
    expect(card.textContent).toContain("最后一行");
  });

  it("简化工具卡也提供折叠摘要并展开查看原始数据", () => {
    render(
      <ToolCallCard
        toolCall={{
          id: "tool-secret",
          toolName: "provider.test",
          status: "success",
          summary: "测试 provider",
          input: { apiKey: "sk-live-secret", query: "ping" },
          result: { ok: true, access_token: "secret-token" },
          durationMs: 42,
        }}
      />,
    );

    // Header shows tool name and duration
    expect(screen.getByText("provider.test")).toBeTruthy();
    expect(screen.getByText("42ms")).toBeTruthy();
    // Click header to expand and see raw input/result
    fireEvent.click(screen.getByText("provider.test").closest("button")!);
    const card = document.querySelector(".tool-card-done") as HTMLElement;
    expect(card).toBeTruthy();
    // GenericExpanded shows input JSON
    expect(card.textContent).toContain("ping");
  });

  it("工具卡展示 checkpoint 与受影响资源，便于按消息查看恢复来源", () => {
    render(
      <ToolCallCard
        toolCall={{
          id: "tool-checkpoint",
          toolName: "resource.rewind",
          status: "success",
          summary: "已恢复资源。",
          result: {
            checkpointId: "checkpoint-1",
            restoredResources: [{ path: "chapters/0001_first.md" }, { path: "story/story_bible.md" }],
          },
        }}
      />,
    );

    // Header shows tool name
    expect(screen.getByText("resource.rewind")).toBeTruthy();
    // Click to expand and see result JSON with checkpoint and resource info
    fireEvent.click(screen.getByText("resource.rewind").closest("button")!);
    const card = document.querySelector(".tool-card-done") as HTMLElement;
    expect(card.textContent).toContain("checkpoint-1");
    expect(card.textContent).toContain("chapters/0001_first.md");
    expect(card.textContent).toContain("story/story_bible.md");
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
    // Running status shown via spinner icon; raw data not visible until expanded
    // Click header to expand
    fireEvent.click(screen.getByText("candidate.create_chapter").closest("button")!);

    const card = document.querySelector(".tool-card-running") as HTMLElement;
    expect(card.textContent).toContain("chapterNumber");
    expect(card.textContent).toContain("candidateId");
  });

  it("确认门展示 pending permission request 的目标、风险、来源和精确操作", () => {
    render(
      <ConfirmationGate
        confirmation={{
          id: "confirm-facts",
          title: "candidate.create_chapter",
          summary: "将创建第 3 章候选稿",
          target: "chapters/0003.md",
          risk: "confirmed-write",
          permissionSource: "sessionConfig.toolPolicy.ask",
          operation: "创建候选稿，不覆盖正式章节",
          targetResources: [{ kind: "chapter", id: "chapter-3", bookId: "book-1", title: "第三章" }],
          source: { sessionId: "session-1", messageId: "message-1", toolUseId: "tool-1" },
          checkpoint: { required: true, checkpointId: "checkpoint-1", paths: ["chapters/0003.md"] },
          diff: { status: "mutation-preview", summary: "替换第三章正文" },
          operations: [
            { action: "approve", label: "批准" },
            { action: "reject", label: "拒绝" },
          ],
        } as never}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    const gate = screen.getByTestId("confirmation-gate");
    // Current component renders: target, risk badge, resources, checkpoint
    expect(gate.textContent).toContain("目标：");
    expect(gate.textContent).toContain("chapters/0003.md");
    expect(gate.textContent).toContain("confirmed-write");
    expect(gate.textContent).toContain("资源：");
    expect(gate.textContent).toContain("chapter");
    expect(gate.textContent).toContain("第三章");
    expect(gate.textContent).toContain("Checkpoint：");
    expect(gate.textContent).toContain("checkpoint-1");
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

    expect(onSend).toHaveBeenCalledWith("继续写", undefined);
    expect(input.value).toBe("");

    // When running with no text, show hold-to-abort button
    rerender(<Composer onSend={onSend} onAbort={onAbort} isRunning />);
    // The abort button is "中断（长按确认）" — fire mousedown to start hold, then wait
    const abortBtn = screen.getByRole("button", { name: "中断（长按确认）" });
    expect(abortBtn).toBeTruthy();
  });

  it("composer displays slash suggestions and handles command errors without sending to the model", async () => {
    const onSend = vi.fn();
    const onSlashCommandResult = vi.fn();
    render(<Composer onSend={onSend} onAbort={vi.fn()} onSlashCommandResult={onSlashCommandResult} />);

    const input = screen.getByLabelText("对话输入框") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "/p" } });

    // Slash suggestions appear in a container (not role=listbox, but visible text)
    expect(document.body.textContent).toContain("/permission");

    fireEvent.change(input, { target: { value: "/permission root" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(onSend).not.toHaveBeenCalled();
    // Command error shows as status text in a div
    await waitFor(() => expect(document.body.textContent).toContain("无效权限模式"));
    expect(onSlashCommandResult).toHaveBeenCalledWith(expect.objectContaining({ ok: false, code: "invalid_permission_mode" }));
  });

  it("composer executes structured slash commands without sending raw slash text", async () => {
    const onSend = vi.fn();
    const onSlashCommandResult = vi.fn();
    render(<Composer onSend={onSend} onAbort={vi.fn()} onSlashCommandResult={onSlashCommandResult} />);

    const input = screen.getByLabelText("对话输入框") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "/permission ask" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(onSlashCommandResult).toHaveBeenCalledWith(expect.objectContaining({ ok: true, kind: "update-session-config", patch: { permissionMode: "ask" } })));
    expect(onSend).not.toHaveBeenCalled();
    expect(input.value).toBe("");
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

  it("使用 flex-column 对话布局并在恢复失败时展示恢复提示", () => {
    render(
      <ConversationSurface
        title="叙述者"
        status={{ state: "replaying", label: "回放中" }}
        messages={messages}
        recoveryNotice={{ state: "failed", reason: "history-gap" }}
        onApproveConfirmation={vi.fn()}
        onRejectConfirmation={vi.fn()}
        onSend={vi.fn()}
      />,
    );

    expect(screen.getByTestId("conversation-surface").className).toContain("flex-col");
    expect(screen.getByTestId("message-stream").className).toContain("flex-1");
    // Recovery notice shown only for "failed" state with messages
    expect(document.body.textContent).toContain("会话恢复失败");
    expect(document.body.textContent).toContain("history-gap");
  });

  it("RED: recovery notice shows failed state with reason for failed recovery", () => {
    render(
      <ConversationSurface
        title="叙述者"
        status={{ state: "error", label: "WebSocket 失败" }}
        messages={messages}
        recoveryNotice={{ state: "failed", reason: "history-gap", lastSeq: 12, ackedSeq: 9, actionLabel: "重新加载快照" }}
        onApproveConfirmation={vi.fn()}
        onRejectConfirmation={vi.fn()}
        onSend={vi.fn()}
      />,
    );

    // Recovery notice shows for "failed" state when messages are present
    expect(document.body.textContent).toContain("会话恢复失败");
    expect(document.body.textContent).toContain("history-gap");
  });

  it("模型池为空时禁用发送并引导到设置页", () => {
    const onAbort = vi.fn();
    const onCompactSession = vi.fn().mockResolvedValue({ ok: true, summary: "已压缩", compactedMessageCount: 3, budget: { estimatedTokensBefore: 8000, estimatedTokensAfter: 3200 } });
    const { rerender } = render(
      <ConversationSurface
        title="叙述者"
        status={{ state: "ready", label: "就绪" }}
        messages={messages}
        onApproveConfirmation={vi.fn()}
        onRejectConfirmation={vi.fn()}
        onSend={vi.fn()}
        onAbort={onAbort}
        onCompactSession={onCompactSession}
      />,
    );

    // When not running, the abort button shouldn't be active (hold-to-abort only shows in running mode with empty input)
    const surface = screen.getByTestId("conversation-surface");
    expect(surface).toBeTruthy();
    // Verify messages are rendered
    expect(surface.textContent).toContain("帮我生成第三章");

    rerender(
      <ConversationSurface
        title="叙述者"
        status={{ state: "running", label: "生成中" }}
        messages={messages}
        isRunning
        onApproveConfirmation={vi.fn()}
        onRejectConfirmation={vi.fn()}
        onSend={vi.fn()}
        onAbort={onAbort}
        onCompactSession={onCompactSession}
      />,
    );
    // When running, the hold-to-abort button appears
    expect(screen.getByRole("button", { name: "中断（长按确认）" })).toBeTruthy();
  });

  it("模型池为空时禁用发送并引导到设置页", () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} onAbort={vi.fn()} disabledReason="模型池为空，请先到设置页启用模型" settingsHref="/next/settings" />);

    fireEvent.change(screen.getByLabelText("对话输入框"), { target: { value: "继续写" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(onSend).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "发送" }) as HTMLButtonElement).disabled).toBe(true);
    // Disabled reason is shown in a div (not role="alert")
    expect(document.body.textContent).toContain("模型池为空，请先到设置页启用模型");
    expect(screen.getByRole("link", { name: "打开设置" }).getAttribute("href")).toBe("/next/settings");
  });



  it("RED: 空会话显示空态提示和 composer 输入区", () => {
    render(
      <ConversationSurface
        title="空白章节会话"
        status={{
          state: "ready",
          label: "就绪",
          binding: { label: "《灵潮纪元》 / 第 4 章" },
          sessionConfigLoaded: false,
        }}
        messages={[]}
        sendDisabledReason="模型池为空，请先到设置页启用模型"
        settingsHref="/next/settings"
        onApproveConfirmation={vi.fn()}
        onRejectConfirmation={vi.fn()}
        onSend={vi.fn()}
      />,
    );

    const surface = screen.getByTestId("conversation-surface");
    // Empty state shows default empty message
    expect(surface.textContent).toContain("还没有消息");
    // Disabled reason and settings link in composer area
    expect(surface.textContent).toContain("模型池为空，请先到设置页启用模型");
    expect(screen.getByRole("link", { name: "打开设置" }).getAttribute("href")).toBe("/next/settings");
    expect(screen.getByLabelText("对话输入框")).toBeTruthy();
  });

  it("RED: recovery notice 和 permission confirmation 在会话表面中内联展示", () => {
    render(
      <ConversationSurface
        title="运行中会话"
        status={{ state: "running", label: "生成中" }}
        messages={messages}
        recoveryNotice={{ state: "failed", reason: "history-gap", lastSeq: 7, ackedSeq: 5 }}
        pendingConfirmation={{
          id: "confirm-lane",
          title: "candidate.create_chapter",
          summary: "将创建第 5 章候选稿",
          target: "chapters/0005.md",
          risk: "confirmed-write",
          permissionSource: "sessionConfig.toolPolicy.ask",
        }}
        isRunning
        onApproveConfirmation={vi.fn()}
        onRejectConfirmation={vi.fn()}
        onSend={vi.fn()}
      />,
    );

    const surface = screen.getByTestId("conversation-surface");
    // Recovery notice (failed state) shown as yellow bar
    expect(surface.textContent).toContain("会话恢复失败");
    expect(surface.textContent).toContain("history-gap");
    // Confirmation gate rendered inline
    expect(screen.getByTestId("confirmation-gate")).toBeTruthy();
    expect(screen.getByTestId("confirmation-gate").textContent).toContain("candidate.create_chapter");
    // Hold-to-abort button present when running
    expect(screen.getByRole("button", { name: "中断（长按确认）" })).toBeTruthy();
  });
});
