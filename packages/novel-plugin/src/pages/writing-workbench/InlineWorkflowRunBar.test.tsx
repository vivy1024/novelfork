import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InlineWorkflowRunBar } from "./InlineWorkflowRunBar";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("InlineWorkflowRunBar 写正文/筹备台内嵌工作流实时状态条", () => {
  it("无活跃运行且未开启 showLauncherWhenIdle 时不渲染任何 DOM", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ active: null, recent: [] }), { status: 200 })),
    );

    const { container } = render(<InlineWorkflowRunBar bookId="book-1" chapterNumber={3} />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="inline-workflow-run-bar"]')).toBeNull();
  });

  it("awaiting_approval 时自动展开待审候选，支持原地批准继续并唤醒叙述者", async () => {
    const activeDetail = {
      run: {
        id: "run-9",
        chapterNumber: 3,
        recipeName: "串行日更",
        status: "awaiting_approval",
        currentStepId: "step-spec",
        revision: 4,
        updatedAt: Date.now(),
        steps: [
          {
            stepId: "step-pre",
            ordinal: 1,
            label: "写前预检",
            status: "done",
            attempt: 1,
            executorKind: "domain-tool",
            requiresApproval: false,
            expectedOutput: "other",
          },
          {
            stepId: "step-spec",
            ordinal: 2,
            label: "镜头蓝图",
            status: "awaiting_approval",
            attempt: 1,
            executorKind: "narrator",
            requiresApproval: true,
            expectedOutput: "scene-spec",
          },
        ],
      },
      candidates: [
        {
          id: "cand-1",
          stepId: "step-spec",
          kind: "scene-spec",
          payload: {
            sceneSpec: {
              scenes: [{ location: "藏书楼三层", conflict: "守阁长老盘问来历", outcome: "借调令蒙混过关" }],
            },
          },
          validation: {},
          decision: "pending",
        },
      ],
    };

    const nextRunningDetail = {
      ...activeDetail,
      run: {
        ...activeDetail.run,
        status: "running",
        revision: 5,
        steps: [
          activeDetail.run.steps[0],
          { ...activeDetail.run.steps[1], status: "done" },
          {
            stepId: "step-draft",
            ordinal: 3,
            label: "正文起草",
            status: "running",
            attempt: 1,
            executorKind: "narrator",
            requiresApproval: false,
            expectedOutput: "prose",
          },
        ],
      },
      candidates: [],
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/approve") && init?.method === "POST") {
        return new Response(JSON.stringify(nextRunningDetail), { status: 200 });
      }
      return new Response(JSON.stringify({ active: activeDetail, recent: [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const onSendToNarrator = vi.fn();
    render(
      <InlineWorkflowRunBar
        bookId="book-1"
        chapterNumber={3}
        narratorId="nar-1"
        onSendToNarrator={onSendToNarrator}
      />,
    );

    const bar = await screen.findByTestId("inline-workflow-run-bar");
    expect(bar.textContent).toContain("串行日更 · 第 3 章");
    expect(bar.textContent).toContain("待你确认");
    await waitFor(() => expect(bar.textContent).toContain("藏书楼三层"));

    fireEvent.click(screen.getByTestId("inline-workflow-approve-btn"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/books/book-1/workflow-runs/run-9/steps/step-spec/approve",
        expect.objectContaining({ method: "POST" }),
      );
    });
    expect(onSendToNarrator).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("执行中")).toBeTruthy();
  });

  it("blocked 时展示受阻原因并提供原地重试与跳过按钮", async () => {
    const blockedDetail = {
      run: {
        id: "run-12",
        chapterNumber: 5,
        recipeName: "黄金开书",
        status: "blocked",
        currentStepId: "step-audit",
        revision: 2,
        updatedAt: Date.now(),
        steps: [
          {
            stepId: "step-audit",
            ordinal: 1,
            label: "对抗审稿",
            status: "failed",
            attempt: 1,
            executorKind: "subagent",
            requiresApproval: false,
            tools: ["chapter.audit"],
            expectedOutput: "audit",
            note: {
              what: "子代理调用超时",
              why: "上游模型响应超时",
              action: "点击重试或跳过本道非落盘工序",
            },
          },
        ],
      },
      candidates: [],
    };

    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ active: blockedDetail, recent: [] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const onOpenStudio = vi.fn();
    render(
      <InlineWorkflowRunBar
        bookId="book-2"
        chapterNumber={5}
        narratorId="nar-2"
        onOpenFullWorkflowStudio={onOpenStudio}
      />,
    );

    expect(await screen.findByTestId("inline-workflow-blocked-card")).toBeTruthy();
    expect(screen.getByTestId("inline-workflow-retry-btn")).toBeTruthy();
    expect(screen.getByTestId("inline-workflow-skip-btn")).toBeTruthy();

    fireEvent.click(screen.getByTestId("inline-workflow-open-studio"));
    expect(onOpenStudio).toHaveBeenCalledTimes(1);
  });
});
