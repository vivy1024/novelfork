import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { ToolCallBlock } from "./ToolCallBlock";
import { parseAssistantPayload } from "./tool-call-utils";

function defaultFetchJsonImplementation(url: string, options?: { body?: string }) {
  if (url === "/api/tools/source-preview") {
    const body = JSON.parse(options?.body ?? "{}");
    const params = body.params ?? {};
    const target = params.file_path ?? params.path ?? "packages/studio/src/components/ChatWindow.tsx";
    const locator = typeof params.offset === "number"
      ? `${target}:${params.offset + 1}-${params.offset + Math.max(params.limit ?? 1, 1)}`
      : typeof params.lineno === "number"
        ? `${target}:${params.lineno}-${params.lineno + Math.max((params.limit ?? 1) - 1, 0)}`
        : `${target}:1-5`;
    return Promise.resolve({
      title: `${body.toolName ?? "Tool"} 源码视图`,
      target,
      locator,
      line: typeof params.offset === "number" ? params.offset + 1 : (params.lineno ?? 1),
      requestPreview: [
        body.command ? `# 命令\n${body.command}` : undefined,
        "POST /api/tools/execute",
        JSON.stringify({ toolName: body.toolName, params }, null, 2),
      ].filter(Boolean).join("\n\n"),
      snippet: target === "package.json"
        ? '{\n  "name": "@vivy1024/novelfork-studio",\n  "version": "0.0.1"\n}'
        : "export function ChatWindow() {\n  return null;\n}",
    });
  }

  if (url === "/api/tools/open-in-editor") {
    const body = JSON.parse(options?.body ?? "{}");
    const params = body.params ?? {};
    const target = params.file_path ?? params.path ?? "packages/studio/src/components/ChatWindow.tsx";
    const line = typeof params.offset === "number" ? params.offset + 1 : (params.lineno ?? 1);
    return Promise.resolve({ success: true, command: "code", target, line });
  }

  return Promise.resolve({ success: true });
}

const fetchJsonMock = vi.fn(defaultFetchJsonImplementation as typeof defaultFetchJsonImplementation);

vi.mock("@/hooks/use-api", () => ({
  fetchJson: (url: string, ...rest: unknown[]) => fetchJsonMock(url, ...(rest as [{ body?: string }?])),
}));

class MockEventSource {
  static instances: MockEventSource[] = [];

  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public readonly url: string) {
    MockEventSource.instances.push(this);
  }

  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent<string>);
  }

  close() {
    return undefined;
  }
}

Object.defineProperty(globalThis, "EventSource", {
  writable: true,
  configurable: true,
  value: MockEventSource as unknown as typeof EventSource,
});
Object.defineProperty(globalThis, "navigator", {
  writable: true,
  configurable: true,
  value: {
    clipboard: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  },
});

afterEach(() => {
  cleanup();
  fetchJsonMock.mockReset();
  fetchJsonMock.mockImplementation(defaultFetchJsonImplementation as typeof defaultFetchJsonImplementation);
});

const cockpitSnapshotResult = {
  ok: true,
  renderer: "cockpit.snapshot",
  summary: "已读取驾驶舱快照。",
  data: {
    status: "available",
    generatedAt: "2026-05-02T09:00:00.000Z",
    book: { id: "book-1", title: "灵潮纪元", genre: "玄幻", platform: "起点" },
    progress: {
      status: "available",
      chapterCount: 2,
      targetChapters: 10,
      totalWords: 6200,
      approvedChapters: 1,
      failedChapters: 1,
      todayWords: 1200,
      dailyTarget: 3000,
      streak: 3,
      weeklyWords: 8200,
    },
    currentFocus: { status: "available", content: "本章推进灵潮试炼", sourceFile: "current_focus.md" },
    recentChapterSummaries: { status: "available", items: [{ number: 2, summary: "主角夺回灵钥", sourceFile: "chapter_summaries.md" }] },
    openHooks: { status: "available", items: [{ id: "hook-1", text: "第1章埋下灵钥裂纹", sourceChapter: 1, status: "payoff-due", sourceFile: "pending_hooks.md", sourceKind: "pending-hooks" }] },
    recentCandidates: { status: "available", items: [{ id: "cand-1", bookId: "book-1", title: "第三章候选", source: "session-tool", status: "candidate", createdAt: "2026-05-02T08:00:00.000Z", updatedAt: "2026-05-02T08:00:00.000Z" }] },
    riskCards: { status: "available", items: [{ id: "risk-1", kind: "audit-failure", title: "第2章存在审计问题", detail: "人物动机冲突", chapterNumber: 2, navigateTo: "chapter:2", level: "danger" }] },
    modelStatus: { status: "available", hasUsableModel: true, defaultProvider: "sub2api", defaultModel: "gpt-5.4", supportsToolUse: true },
  },
};

const guidedPlan = {
  title: "第三章候选稿计划",
  goal: "写下一章",
  target: "chapter-candidate",
  contextSummary: "承接灵潮试炼，先回收灵钥裂纹伏笔。",
  contextSources: [{ id: "ctx-1", type: "chapter", title: "第二章摘要", excerpt: "主角夺回灵钥" }],
  authorDecisions: ["本章不直接暴露反派身份"],
  proposedJingweiMutations: [{ id: "mut-1", target: "foreshadow", operation: "update", summary: "标记灵钥裂纹进入回收窗口" }],
  proposedCandidate: { chapterNumber: 3, title: "灵钥裂纹", intent: "生成第三章候选稿", expectedLength: 3200 },
  risks: ["伏笔回收过早"],
  confirmationItems: ["是否创建候选稿"],
};

describe("ToolCallBlock", () => {
  beforeEach(() => {
    MockEventSource.instances = [];
  });

  it("selects the cockpit snapshot renderer from tool result JSON without refetching business data", () => {
    render(
      <ToolCallBlock
        toolCall={{
          toolName: "cockpit.get_snapshot",
          status: "success",
          summary: "已读取驾驶舱快照。",
          input: { bookId: "book-1", includeModelStatus: true },
          result: cockpitSnapshotResult,
          duration: 86,
        }}
      />,
    );

    const card = screen.getByTestId("cockpit-snapshot-card");
    expect(card.textContent).toContain("驾驶舱快照");
    expect(card.textContent).toContain("灵潮纪元");
    expect(card.textContent).toContain("2 / 10 章");
    expect(card.textContent).toContain("今日 1200 / 3000 字");
    expect(card.textContent).toContain("本章推进灵潮试炼");
    expect(card.textContent).toContain("主角夺回灵钥");
    expect(card.textContent).toContain("第1章埋下灵钥裂纹");
    expect(card.textContent).toContain("第三章候选");
    expect(card.textContent).toContain("第2章存在审计问题");
    expect(fetchJsonMock).not.toHaveBeenCalledWith(expect.stringMatching(/^\/api\/books/), expect.anything());
  });

  it("renders first-class guided, PGI, candidate and mutation cards through the registry", () => {
    render(
      <>
        <ToolCallBlock
          toolCall={{
            toolName: "questionnaire.start",
            status: "success",
            result: {
              ok: true,
              renderer: "guided.questions",
              summary: "已启动问卷。",
              data: {
                status: "available",
                goal: "补全人物弧光",
                questions: [{ id: "q1", prompt: "主角这一卷最大的代价是什么？", type: "text", reason: "写入人物弧光", required: true, source: "questionnaire" }],
              },
            },
          }}
        />
        <ToolCallBlock
          toolCall={{
            toolName: "pgi.generate_questions",
            status: "success",
            result: {
              ok: true,
              renderer: "pgi.questions",
              summary: "已生成 1 个生成前追问。",
              data: {
                status: "available",
                chapterNumber: 3,
                heuristicsTriggered: ["foreshadow-due"],
                questions: [{ id: "p1", prompt: "本章是否回收灵钥裂纹？", type: "single", reason: "临近回收伏笔", required: true, source: "pgi", heuristicsTriggered: ["foreshadow-due"] }],
              },
            },
          }}
        />
        <ToolCallBlock
          toolCall={{
            toolName: "guided.exit",
            status: "pending",
            result: {
              ok: true,
              renderer: "guided.plan",
              summary: "工具 guided.exit 需要确认后执行。",
              data: { status: "pending-confirmation", plan: guidedPlan },
              confirmation: { id: "confirm-plan-1", toolName: "guided.exit", target: "book-1", risk: "confirmed-write", summary: "需要确认", options: ["approve", "reject", "open-in-canvas"] },
            },
          }}
        />
        <ToolCallBlock
          toolCall={{
            toolName: "candidate.create_chapter",
            status: "success",
            result: {
              ok: true,
              renderer: "candidate.created",
              summary: "已创建第 3 章候选稿：灵钥裂纹。",
              data: { status: "candidate", candidate: { id: "cand-3", bookId: "book-1", title: "灵钥裂纹", chapterNumber: 3, content: "灵钥裂纹在掌心亮起。", metadata: { nonDestructive: true } } },
              artifact: { id: "candidate:book-1:cand-3", kind: "candidate", title: "灵钥裂纹", renderer: "candidate.created", openInCanvas: true },
            },
          }}
        />
        <ToolCallBlock
          toolCall={{
            toolName: "questionnaire.submit_response",
            status: "success",
            result: {
              ok: true,
              renderer: "jingwei.mutationPreview",
              summary: "已提交问卷回答 response-1。",
              data: { status: "submitted", response: { id: "response-1" }, targetObjectId: "character:hero", mutations: [{ id: "mut-2", target: "character:hero", operation: "update", summary: "补充代价动机" }] },
            },
          }}
        />
      </>,
    );

    expect(screen.getByTestId("guided-questions-card").textContent).toContain("主角这一卷最大的代价是什么？");
    expect(screen.getByTestId("pgi-questions-card").textContent).toContain("本章是否回收灵钥裂纹？");
    expect(screen.getByTestId("guided-generation-plan-card").textContent).toContain("第三章候选稿计划");
    expect(screen.getByTestId("guided-generation-plan-card").textContent).toContain("待作者确认");
    expect(screen.getByTestId("candidate-created-card").textContent).toContain("灵钥裂纹");
    expect(screen.getByTestId("candidate-created-card").textContent).toContain("非破坏性候选稿");
    expect(screen.getByTestId("jingwei-mutation-preview-card").textContent).toContain("补充代价动机");
  });

  it("uses toolCall.result.renderer before tool name and falls back to the generic block", () => {
    render(
      <>
        <ToolCallBlock
          toolCall={{
            toolName: "custom.wrapper",
            status: "success",
            result: {
              ok: true,
              renderer: "cockpit.openHooks",
              summary: "已读取开放伏笔。",
              data: { status: "available", items: [{ id: "hook-2", text: "第2章留下血誓", sourceChapter: 2, status: "open" }] },
            },
          }}
        />
        <ToolCallBlock
          toolCall={{
            toolName: "unknown.tool",
            status: "success",
            summary: "未知工具仍使用 generic block",
            result: { ok: true, renderer: "unknown.renderer", data: { hello: "world" } },
          }}
        />
      </>,
    );

    expect(screen.getByTestId("open-hooks-card").textContent).toContain("第2章留下血誓");
    expect(screen.getByText("unknown.tool")).toBeTruthy();
    expect(screen.getByText("未知工具仍使用 generic block")).toBeTruthy();
    expect(screen.queryByTestId("unknown.renderer")).toBeNull();
  });

  it("keeps renderer cards state-aware for pending, running, success and error tool calls", () => {
    render(
      <>
        <ToolCallBlock toolCall={{ toolName: "cockpit.get_snapshot", status: "pending", result: { ok: true, renderer: "cockpit.snapshot", summary: "等待执行", data: { status: "empty", progress: { chapterCount: 0, targetChapters: null, todayWords: 0, dailyTarget: 3000 }, openHooks: { items: [] }, recentCandidates: { items: [] }, riskCards: { items: [] } } } }} />
        <ToolCallBlock toolCall={{ toolName: "cockpit.get_snapshot", status: "running", result: { ok: true, renderer: "cockpit.snapshot", summary: "正在读取", data: { status: "empty", progress: { chapterCount: 0, targetChapters: null, todayWords: 0, dailyTarget: 3000 }, openHooks: { items: [] }, recentCandidates: { items: [] }, riskCards: { items: [] } } } }} />
        <ToolCallBlock toolCall={{ toolName: "candidate.create_chapter", status: "success", result: { ok: true, renderer: "candidate.created", summary: "已创建候选", data: { candidate: { id: "cand-ok", title: "成功候选", content: "正文" } } } }} />
        <ToolCallBlock toolCall={{ toolName: "candidate.create_chapter", status: "error", error: "模型不可用", result: { ok: false, renderer: "candidate.created", summary: "候选稿生成需要配置支持模型。", error: "unsupported-model", data: { status: "unsupported", reason: "当前会话未配置可用模型。" } } }} />
      </>,
    );

    const cockpitCards = screen.getAllByTestId("cockpit-snapshot-card");
    expect(cockpitCards[0]?.textContent).toContain("待执行");
    expect(cockpitCards[1]?.textContent).toContain("执行中");
    expect(screen.getByText("成功候选")).toBeTruthy();
    const candidateCards = screen.getAllByTestId("candidate-created-card");
    expect(candidateCards[0]?.textContent).toContain("完成");
    expect(candidateCards[1]?.textContent).toContain("失败");
    expect(candidateCards[1]?.textContent).toContain("当前会话未配置可用模型");
  });

  it("renders status, summary and differentiated bash details", () => {
    render(
      <ToolCallBlock
        toolCall={{
          toolName: "Bash",
          status: "running",
          summary: "正在执行 git status",
          command: "git status --short",
          input: { cwd: "packages/studio" },
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
    const actionBar = screen.getByRole("group", { name: "工具调用动作区" });
    expect(within(actionBar).getByRole("button", { name: "复制工具命令" })).toBeTruthy();
    expect(within(actionBar).getByRole("button", { name: "查看原始载荷" })).toBeTruthy();
    expect(within(actionBar).getByRole("button", { name: "展开结果细节" })).toBeTruthy();
    expect(screen.queryByText("标准输出")).toBeNull();

    fireEvent.click(within(actionBar).getByRole("button", { name: "展开结果细节" }));

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

  it("reveals raw payload when requested", () => {
    render(
      <ToolCallBlock
        toolCall={{
          toolName: "MCP",
          status: "success",
          summary: "查询文档索引",
          input: {
            server: "docs-registry",
            tool: "searchDocs",
            query: "session state",
          },
          result: {
            matches: 3,
            source: "index-cache",
          },
          output: "命中 3 条结果",
        }}
      />,
    );

    expect(screen.queryByText(/docs-registry/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "查看原始载荷" }));

    expect(screen.getByRole("button", { name: "收起原始载荷" })).toBeTruthy();
    expect(screen.getByText(/"server": "docs-registry"/)).toBeTruthy();
    expect(screen.getByText(/"tool": "searchDocs"/)).toBeTruthy();
    expect(screen.getByText(/"source": "index-cache"/)).toBeTruthy();
  });

  it("shows run-level execution tracking and reacts to live run events", () => {
    render(
      <ToolCallBlock
        toolCall={{
          toolName: "Read",
          status: "running",
          summary: "读取章节并建立索引",
          result: {
            execution: {
              runId: "run-tool-1",
              attempts: 2,
              traceEnabled: true,
              dumpEnabled: false,
            },
          },
        }}
      />,
    );

    expect(MockEventSource.instances[0]?.url).toBe("/api/runs/run-tool-1/events");

    act(() => {
      MockEventSource.instances[0]?.emit({
        type: "snapshot",
        runId: "run-tool-1",
        run: {
          id: "run-tool-1",
          bookId: "__studio__",
          chapter: null,
          chapterNumber: null,
          action: "tool",
          status: "running",
          stage: "Tool Read",
          createdAt: "2026-04-21T10:00:00.000Z",
          updatedAt: "2026-04-21T10:00:01.000Z",
          startedAt: "2026-04-21T10:00:00.000Z",
          finishedAt: null,
          logs: [],
        },
      });
    });

    expect(screen.getByText("运行追踪")).toBeTruthy();
    expect(screen.getByText(/run-tool-1/)).toBeTruthy();
    expect(screen.getByText(/尝试 2 次/)).toBeTruthy();
    expect(screen.getByText(/trace 开/)).toBeTruthy();
    expect(screen.getByText(/dump 关/)).toBeTruthy();
    expect(screen.getByText(/阶段：Tool Read/)).toBeTruthy();

    act(() => {
      MockEventSource.instances[0]?.emit({
        type: "status",
        runId: "run-tool-1",
        status: "succeeded",
      });
    });

    expect(screen.getByText(/实时状态：succeeded/)).toBeTruthy();
  });

  it("shows richer run facts including book, chapter and latest log line", () => {
    render(
      <ToolCallBlock
        toolCall={{
          toolName: "Read",
          status: "running",
          summary: "读取章节并建立索引",
          result: {
            execution: {
              runId: "run-tool-rich",
              attempts: 2,
              traceEnabled: true,
              dumpEnabled: false,
            },
          },
        }}
      />,
    );

    act(() => {
      MockEventSource.instances[0]?.emit({
        type: "snapshot",
        runId: "run-tool-rich",
        run: {
          id: "run-tool-rich",
          bookId: "demo-book",
          chapter: 7,
          chapterNumber: 7,
          action: "tool",
          status: "running",
          stage: "Tool Read",
          createdAt: "2026-04-21T10:00:00.000Z",
          updatedAt: "2026-04-21T10:00:03.000Z",
          startedAt: "2026-04-21T10:00:00.000Z",
          finishedAt: null,
          logs: [
            {
              timestamp: "2026-04-21T10:00:02.000Z",
              level: "info",
              message: "Attempt 1/2 started",
            },
          ],
        },
      });
    });

    expect(screen.getByText(/demo-book/)).toBeTruthy();
    expect(screen.getByText(/第 7 章/)).toBeTruthy();
    expect(screen.getByText(/Attempt 1\/2 started/)).toBeTruthy();
  });

  it("shows governance explanation for permission-gated tool calls", () => {
    render(
      <ToolCallBlock
        toolCall={{
          toolName: "Read",
          status: "error",
          summary: "读取被权限链阻止",
          result: {
            allowed: false,
            confirmationRequired: true,
            source: "runtimeControls.defaultPermissionMode",
            reasonKey: "default-prompt",
            reason: "Tool falls back to defaultPermissionMode=ask",
          },
          error: "Tool falls back to defaultPermissionMode=ask",
        }}
      />,
    );

    expect(screen.getByTestId("tool-governance-card")).toBeTruthy();
    expect(screen.getByText("治理解释")).toBeTruthy();
    expect(screen.getByText(/默认权限要求确认/)).toBeTruthy();
    expect(screen.getByText(/来源：默认权限模式/)).toBeTruthy();
    expect(screen.getByText(/执行：拒绝/)).toBeTruthy();
    expect(screen.getByText(/执行：需确认/)).toBeTruthy();
    expect(screen.getByText(/原因：工具按默认权限模式进入确认/)).toBeTruthy();
    expect(screen.queryByText(/runtimeControls\.defaultPermissionMode|defaultPermissionMode=ask|Tool falls back/)).toBeNull();
  });

  it("shows fullscreen, view-source and rerun actions for completed tool calls", async () => {
    const onReplay = vi.fn();
    const onInspectRun = vi.fn();

    render(
      <ToolCallBlock
        toolCall={{
          toolName: "Bash",
          status: "success",
          summary: "已完成 git status 检查",
          command: "git status --short",
          input: { cwd: "packages/studio" },
          output: " M packages/studio/src/components/ChatWindow.tsx",
          result: {
            ok: true,
            execution: {
              runId: "run-bash-1",
              attempts: 1,
              traceEnabled: true,
              dumpEnabled: false,
            },
          },
          duration: 420,
        }}
        onReplay={onReplay}
        onInspectRun={onInspectRun}
      />,
    );

    expect(screen.getByRole("button", { name: "查看源码" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "全屏查看" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "重跑" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "定位运行" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "定位运行" }));
    expect(onInspectRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-bash-1",
      }),
      expect.objectContaining({
        toolName: "Bash",
        command: "git status --short",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "查看源码" }));
    expect(screen.getByText("工具源码")).toBeTruthy();
    expect(await screen.findByText("定位信息")).toBeTruthy();
    expect(screen.getByText(/packages\/studio\/src\/components\/ChatWindow\.tsx/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));

    fireEvent.click(screen.getByRole("button", { name: "全屏查看" }));
    expect(screen.getByText("工具调用全屏详情")).toBeTruthy();
    expect(screen.getAllByText("原始载荷").length).toBeGreaterThan(1);
    fireEvent.click(screen.getAllByRole("button", { name: "关闭" }).at(-1)!);

    fireEvent.click(screen.getByRole("button", { name: "重跑" }));
    expect(onReplay).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "Bash",
        command: "git status --short",
      }),
    );
  });

  it("shows locator and snippet in the source preview for file tools", async () => {
    render(
      <ToolCallBlock
        toolCall={{
          toolName: "Read",
          status: "success",
          summary: "已读取 package.json",
          input: { file_path: "package.json", offset: 1, limit: 2 },
          output: '{"name":"novelfork"}',
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "查看源码" }));

    expect(await screen.findByText("源码片段")).toBeTruthy();
    expect(screen.getByText(/package\.json:2-3/)).toBeTruthy();
    expect(screen.getByText(/"name": "@vivy1024\/novelfork-studio"/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "打开定位" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "打开定位" }));
    expect(fetchJsonMock).toHaveBeenCalledWith(
      "/api/tools/open-in-editor",
      expect.objectContaining({ method: "POST" }),
    );
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
