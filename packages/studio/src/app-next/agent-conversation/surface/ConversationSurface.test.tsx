import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConversationSurface, type ConversationSurfaceMessage } from "./ConversationSurface";
import { Composer } from "./Composer";
import { ConfirmationGate } from "./ConfirmationGate";
import { ConversationStatusBar } from "./ConversationStatusBar";
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

  it("工具卡接入 Tool Result Renderer Registry 并保留 artifact 打开动作", () => {
    const onOpenArtifact = vi.fn();
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
        onOpenArtifact={onOpenArtifact}
      />,
    );

    expect(screen.getByTestId("tool-result-candidate")).toBeTruthy();
    expect(screen.getByText("3200 字")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "在画布打开" }));

    expect(onOpenArtifact).toHaveBeenCalledWith({ kind: "candidate", id: "candidate-3", title: "第三章候选稿" });
  });

  it("工具卡保留可复用 ToolCallBlock 的折叠输出、图标和错误展示资产", () => {
    const longOutput = `${"灵潮".repeat(260)}\n最后一行`;
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

    const card = screen.getByTestId("tool-call-card-tool-reused-block");
    expect(card.textContent).toContain("Bash");
    expect(card.textContent).toContain("失败");
    expect(card.textContent).toContain("Exit 1");
    expect(card.textContent).toContain("命令失败");
    expect(card.textContent).toContain("显示剩余");
    expect(card.querySelector("svg")).toBeTruthy();
    fireEvent.click(within(card).getByRole("button", { name: /显示剩余/ }));
    expect(card.textContent).toContain("最后一行");
  });

  it("简化工具卡也提供复制/全屏动作并脱敏 raw input/result", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
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

    fireEvent.click(screen.getByRole("button", { name: "复制工具调用摘要" }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0]?.[0]).not.toContain("sk-live-secret");
    expect(writeText.mock.calls[0]?.[0]).toContain("[REDACTED]");
    expect(screen.getByRole("button", { name: "全屏查看" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "展开工具原始数据" }));
    const card = screen.getByTestId("tool-call-card-tool-secret");
    expect(card.textContent).not.toContain("sk-live-secret");
    expect(card.textContent).not.toContain("secret-token");
    expect(card.textContent).toContain("[REDACTED]");
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

    expect(screen.getByText("Checkpoint checkpoint-1")).toBeTruthy();
    expect(screen.getByText("chapters/0001_first.md")).toBeTruthy();
    expect(screen.getByText("story/story_bible.md")).toBeTruthy();
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
        } as never}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    const gate = screen.getByTestId("confirmation-gate");
    expect(gate.textContent).toContain("目标：chapters/0003.md");
    expect(gate.textContent).toContain("风险：confirmed-write");
    expect(gate.textContent).toContain("来源：sessionConfig.toolPolicy.ask");
    expect(gate.textContent).toContain("操作：创建候选稿，不覆盖正式章节");
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

  it("composer displays slash suggestions and handles command errors without sending to the model", async () => {
    const onSend = vi.fn();
    const onSlashCommandResult = vi.fn();
    render(<Composer onSend={onSend} onAbort={vi.fn()} onSlashCommandResult={onSlashCommandResult} />);

    const input = screen.getByLabelText("对话输入框") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "/p" } });

    expect(screen.getByRole("listbox", { name: "斜杠命令建议" }).textContent).toContain("/permission");

    fireEvent.change(input, { target: { value: "/permission root" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(onSend).not.toHaveBeenCalled();
    expect((await screen.findByRole("status")).textContent).toContain("无效权限模式");
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

  it("使用 flex-column 对话布局并以内联 notice 呈现恢复状态", () => {
    render(
      <ConversationSurface
        title="叙述者"
        status={{ state: "replaying", label: "回放中" }}
        messages={messages}
        recoveryNotice={{ state: "replaying", reason: "history-gap" }}
        onApproveConfirmation={vi.fn()}
        onRejectConfirmation={vi.fn()}
        onSend={vi.fn()}
      />,
    );

    expect(screen.getByTestId("conversation-surface").className).toContain("flex-col");
    expect(screen.getByTestId("message-stream").className).toContain("flex-1");
    expect(screen.getByTestId("conversation-recovery-notice").textContent).toContain("history-gap");
  });

  it("RED: recovery notice exposes one normalized state, actionable copy, and last cursor without raw state leakage", () => {
    render(
      <ConversationSurface
        title="叙述者"
        status={{ state: "error", label: "WebSocket 失败" }}
        messages={[]}
        recoveryNotice={{ state: "resetting", reason: "history-gap", lastSeq: 12, ackedSeq: 9, actionLabel: "重新加载快照" }}
        onApproveConfirmation={vi.fn()}
        onRejectConfirmation={vi.fn()}
        onSend={vi.fn()}
      />,
    );

    const notice = screen.getByTestId("conversation-recovery-notice");
    expect(notice.textContent).toContain("需要重新加载快照");
    expect(notice.textContent).toContain("最近成功 cursor：9 / 12");
    expect(notice.textContent).toContain("重新加载快照");
    expect(notice.textContent).not.toContain("恢复状态：resetting");
  });

  it("状态栏展示合同模型配置并通过 session update 回调切换模型、权限和推理强度", async () => {
    const onUpdateSessionConfig = vi.fn().mockResolvedValue(undefined);
    render(
      <ConversationStatusBar
        status={{
          state: "connected",
          label: "已连接",
          providerId: "sub2api",
          providerLabel: "Sub2API",
          modelId: "gpt-5.4",
          modelLabel: "GPT-5.4",
          permissionMode: "edit",
          reasoningEffort: "medium",
          usage: {
            currentTurn: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
            cumulative: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
            cost: { status: "unknown" },
          },
          modelOptions: [
            { providerId: "sub2api", providerLabel: "Sub2API", modelId: "gpt-5.4", modelLabel: "GPT-5.4", supportsTools: true },
            { providerId: "sub2api", providerLabel: "Sub2API", modelId: "gpt-5.5", modelLabel: "GPT-5.5", supportsTools: true },
          ],
        }}
        onUpdateSessionConfig={onUpdateSessionConfig}
      />,
    );

    expect(screen.getAllByText("Sub2API / GPT-5.4").length).toBeGreaterThan(0);
    expect(screen.getByText("权限：编辑")).toBeTruthy();
    expect(screen.getByText("推理：medium")).toBeTruthy();
    expect(screen.getByText("Tokens：当前 15 / 累计 120 / 成本 未知")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("模型"), { target: { value: "sub2api::gpt-5.5" } });
    fireEvent.change(screen.getByLabelText("权限"), { target: { value: "ask" } });
    fireEvent.change(screen.getByLabelText("推理强度"), { target: { value: "high" } });

    await waitFor(() => expect(onUpdateSessionConfig).toHaveBeenCalledWith({ providerId: "sub2api", modelId: "gpt-5.5" }));
    expect(onUpdateSessionConfig).toHaveBeenCalledWith({ permissionMode: "ask" });
    expect(onUpdateSessionConfig).toHaveBeenCalledWith({ reasoningEffort: "high" });
  });

  it("对话 header facts 展示绑定、消息数、工作区和 Git unavailable 原因", () => {
    render(
      <ConversationStatusBar
        status={{
          state: "connected",
          label: "已连接",
          providerId: "sub2api",
          providerLabel: "Sub2API",
          modelId: "gpt-5.4",
          modelLabel: "GPT-5.4",
          permissionMode: "edit",
          reasoningEffort: "medium",
          messageCount: 3,
          binding: { label: "书籍 book-1 / 第 3 章", worktree: "D:/novel-worktree" },
          workspace: { path: "D:/novel-worktree", git: { status: "unavailable", reason: "未检测到 Git 仓库" } },
        } as never}
      />,
    );

    expect(screen.getByText("绑定：书籍 book-1 / 第 3 章")).toBeTruthy();
    expect(screen.getByText("消息：3")).toBeTruthy();
    expect(screen.getByText("工作区：D:/novel-worktree")).toBeTruthy();
    expect(screen.getByText("Git：不可用（未检测到 Git 仓库）")).toBeTruthy();
  });

  it("provider 不支持 reasoning 或 plan session 不允许权限模式时禁用控件并显示原因", () => {
    render(
      <ConversationStatusBar
        status={{
          state: "connected",
          label: "已连接",
          providerId: "sub2api",
          modelId: "chat-only",
          permissionMode: "plan",
          reasoningEffort: "medium",
          sessionConfigLoaded: true,
          modelOptions: [{ providerId: "sub2api", providerLabel: "Sub2API", modelId: "chat-only", modelLabel: "Chat Only", supportsTools: true, supportsReasoning: false }],
          permissionModeDisabledReasons: { allow: "规划会话不允许全部允许", edit: "规划会话不允许直接编辑" },
          reasoningUnsupportedReason: "当前 provider 不支持 reasoning effort 调整",
        } as never}
      />,
    );

    expect((screen.getByLabelText("推理强度") as HTMLSelectElement).disabled).toBe(true);
    expect(screen.getByText("当前 provider 不支持 reasoning effort 调整")).toBeTruthy();
    expect((screen.getByRole("option", { name: "允许" }) as HTMLOptionElement).disabled).toBe(true);
    expect((screen.getByRole("option", { name: "编辑" }) as HTMLOptionElement).disabled).toBe(true);
    expect(screen.getByText("规划会话不允许全部允许")).toBeTruthy();
  });

  it("状态栏展示 context threshold、overflow warning 与 planned runtime panels", () => {
    render(
      <ConversationStatusBar
        status={{
          state: "connected",
          label: "已连接",
          providerId: "sub2api",
          modelId: "gpt-5.4",
          permissionMode: "edit",
          reasoningEffort: "medium",
          contextUsage: { usedTokens: 6200, maxTokens: 8000, trimThreshold: 6000, compactThreshold: 7200, checkpointNotice: "checkpoint 已保护正式章节" },
          plannedRuntimePanels: ["Git stage/commit", "container logs"],
        } as never}
      />,
    );

    expect(screen.getByText("上下文：6200 / 8000 tokens")).toBeTruthy();
    expect(screen.getByText("超过裁剪阈值 6000 tokens")).toBeTruthy();
    expect(screen.getByText("距离 compact 阈值 1000 tokens")).toBeTruthy();
    expect(screen.getByText("checkpoint 已保护正式章节")).toBeTruthy();
    expect(screen.getByText("planned 面板：Git stage/commit、container logs")).toBeTruthy();
  });

  it("状态栏展示 session tool policy 可用/禁用/询问概览", () => {
    render(
      <ConversationStatusBar
        status={{
          state: "connected",
          label: "已连接",
          providerId: "sub2api",
          modelId: "gpt-5.4",
          permissionMode: "edit",
          reasoningEffort: "medium",
          toolPolicySummary: { allow: ["cockpit.*"], deny: ["candidate.create_chapter"], ask: ["guided.exit"] },
        }}
      />,
    );

    expect(screen.getByTestId("tool-policy-summary").textContent).toContain("可用：cockpit.*");
    expect(screen.getByTestId("tool-policy-summary").textContent).toContain("禁用：candidate.create_chapter");
    expect(screen.getByTestId("tool-policy-summary").textContent).toContain("询问：guided.exit");
  });

  it("运行控制只把有真实处理器的动作启用，其余显示 disabled reason", () => {
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

    const idleControls = screen.getByTestId("conversation-runtime-controls");
    expect((within(idleControls).getByRole("button", { name: "中断运行" }) as HTMLButtonElement).disabled).toBe(true);
    expect(idleControls.textContent).toContain("无运行中的会话");
    expect((within(idleControls).getByRole("button", { name: "Compact" }) as HTMLButtonElement).disabled).toBe(false);
    expect((within(idleControls).getByRole("button", { name: "重试" }) as HTMLButtonElement).disabled).toBe(true);
    expect(idleControls.textContent).toContain("重试未接入真实 API");
    expect((within(idleControls).getByRole("button", { name: "Fork" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(idleControls).getByRole("button", { name: "Resume" }) as HTMLButtonElement).disabled).toBe(true);

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
    fireEvent.click(within(screen.getByTestId("conversation-runtime-controls")).getByRole("button", { name: "中断运行" }));
    expect(onAbort).toHaveBeenCalledOnce();
  });

  it("模型池为空时禁用发送并引导到设置页", () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} onAbort={vi.fn()} disabledReason="模型池为空，请先到设置页启用模型" settingsHref="/next/settings" />);

    fireEvent.change(screen.getByLabelText("对话输入框"), { target: { value: "继续写" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(onSend).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "发送" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain("模型池为空，请先到设置页启用模型");
    expect(screen.getByRole("link", { name: "打开设置" }).getAttribute("href")).toBe("/next/settings");
  });

  it("模型不支持工具时显示 unsupported-tools 降级说明，并暴露 session update 失败", async () => {
    const onUpdateSessionConfig = vi.fn().mockRejectedValue(new Error("session update 失败"));
    render(
      <ConversationStatusBar
        status={{
          state: "connected",
          label: "已连接",
          providerId: "sub2api",
          providerLabel: "Sub2API",
          modelId: "chat-only",
          modelLabel: "Chat Only",
          permissionMode: "edit",
          reasoningEffort: "medium",
          modelOptions: [{ providerId: "sub2api", providerLabel: "Sub2API", modelId: "chat-only", modelLabel: "Chat Only", supportsTools: false }],
        }}
        onUpdateSessionConfig={onUpdateSessionConfig}
      />,
    );

    expect(screen.getByTestId("unsupported-tools-notice").textContent).toContain("当前模型不支持工具调用");
    fireEvent.change(screen.getByLabelText("权限"), { target: { value: "allow" } });

    await waitFor(() => expect(screen.getByTestId("status-update-error").textContent).toContain("session update 失败"));
  });

  it("RED: 没有持久化 session config 时不展示可编辑模型/权限/推理控件", () => {
    render(
      <ConversationSurface
        title="叙述者"
        status={{
          state: "ready",
          label: "就绪",
          modelOptions: [
            { providerId: "sub2api", providerLabel: "Sub2API", modelId: "gpt-5.4", modelLabel: "GPT-5.4", supportsTools: true },
          ],
        }}
        messages={messages}
        onApproveConfirmation={vi.fn()}
        onRejectConfirmation={vi.fn()}
        onSend={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText("模型")).toBeNull();
    expect(screen.queryByLabelText("权限")).toBeNull();
    expect(screen.queryByLabelText("推理强度")).toBeNull();
    expect(screen.getByText(/session config.*未加载|未配置会话模型/)).toBeTruthy();
  });
});
