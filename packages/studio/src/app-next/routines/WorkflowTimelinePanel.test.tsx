// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { WorkflowTimelinePanel } from "@vivy1024/novelfork-novel-plugin/pages/writing-workbench";

const mockBackendRecipes = [
  {
    id: "backend-suspense-flow",
    name: "后端反转悬疑流",
    commandId: "/novel:suspense",
    description: "从后端 story/workflow_recipes.json 加载的真实数据",
    genre: "suspense",
    steps: [
      {
        id: "step-1",
        kind: "context-load" as const,
        label: "拉取悬疑大纲",
        enabled: true,
        executionMode: "tool-only" as const,
        tools: ["cockpit.snapshot", "lore.read"],
      },
      {
        id: "step-2",
        kind: "writer-generate" as const,
        label: "起草高压反转",
        enabled: true,
        executionMode: "subagent" as const,
        agentId: "writer",
        modelOverride: "deepseek-v4-pro",
        tools: ["pipeline.write"],
        customPrompt: "注意伏笔反转",
        requiresApproval: true,
      },
    ],
    resultStrategy: "formal-chapter" as const,
    requireFinalApproval: true,
    maxRetries: 1,
  },
];

describe("WorkflowTimelinePanel (Studio DOM Integration)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ recipes: mockBackendRecipes }),
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("通过 fetch 从作品专属后端路由加载工作流并渲染真实数据", async () => {
    render(<WorkflowTimelinePanel bookId="book-test" currentChapter={5} />);

    await waitFor(() => {
      expect(screen.getByText("后端反转悬疑流 (2 阶段)")).toBeTruthy();
    });

    expect(screen.getByText("拉取悬疑大纲")).toBeTruthy();
    expect(screen.getByText("起草高压反转")).toBeTruthy();
    expect(screen.getByText("第 5 章")).toBeTruthy();
    expect(screen.getByText("创作工作流推演与调度")).toBeTruthy();
    expect(screen.getByText(/人工审核门禁 \(HITL\)/)).toBeTruthy();
  });

  it("点击调度叙述者时完整将选定 recipe 结构参数传递给主叙述者并复位 running 状态", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(
      <WorkflowTimelinePanel
        bookId="book-test"
        currentChapter={3}
        onSendToNarrator={onSend}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("拉取悬疑大纲")).toBeTruthy();
    });

    const startBtn = screen.getByRole("button", { name: /调度叙述者推进本章/ });
    fireEvent.click(startBtn);

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledTimes(1);
    });

    const sentMessage = onSend.mock.calls[0][0];
    expect(sentMessage).toContain("【创作工作流执行请求】");
    expect(sentMessage).toContain("后端反转悬疑流");
    expect(sentMessage).toContain("第 3 章");
    expect(sentMessage).toContain("起草高压反转");
    expect(sentMessage).toContain("deepseek-v4-pro");
    expect(sentMessage).toContain("注意伏笔反转");

    await waitFor(() => {
      const button = screen.getByRole("button", { name: /调度叙述者推进本章/ }) as HTMLButtonElement;
      expect(button.disabled).toBe(false);
    });
  });

  it("后端加载失败时不展示假内置预设，并提供重试交互", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    }));

    render(<WorkflowTimelinePanel bookId="book-fail" currentChapter={1} />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
      expect(screen.getByText(/加载工作流配置失败: HTTP 500/)).toBeTruthy();
    });

    expect(screen.queryByText("拉取悬疑大纲")).toBeNull();
    const button = screen.getByRole("button", { name: /调度叙述者推进本章/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("切换不同作品时通过 AbortSignal 取消旧请求，避免跨作品竞态串书", async () => {
    let abortCalled = false;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url, opts) => {
      const signal = opts?.signal as AbortSignal | undefined;
      if (signal) {
        signal.addEventListener("abort", () => {
          abortCalled = true;
        });
      }
      return new Promise(() => {});
    }));

    const { rerender } = render(<WorkflowTimelinePanel bookId="book-A" />);
    rerender(<WorkflowTimelinePanel bookId="book-B" />);

    expect(abortCalled).toBe(true);
  });
});
