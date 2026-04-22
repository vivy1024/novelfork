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

vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
vi.stubGlobal("navigator", {
  clipboard: {
    writeText: vi.fn().mockResolvedValue(undefined),
  },
});

afterEach(() => {
  cleanup();
  fetchJsonMock.mockReset();
  fetchJsonMock.mockImplementation(defaultFetchJsonImplementation as typeof defaultFetchJsonImplementation);
});

describe("ToolCallBlock", () => {
  beforeEach(() => {
    MockEventSource.instances = [];
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

  it("shows fullscreen, view-source and rerun actions for completed tool calls", async () => {
    const onReplay = vi.fn();

    render(
      <ToolCallBlock
        toolCall={{
          toolName: "Bash",
          status: "success",
          summary: "已完成 git status 检查",
          command: "git status --short",
          input: { cwd: "packages/studio" },
          output: " M packages/studio/src/components/ChatWindow.tsx",
          result: { ok: true },
          duration: 420,
        }}
        onReplay={onReplay}
      />,
    );

    expect(screen.getByRole("button", { name: "查看源码" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "全屏查看" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "重跑" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "查看源码" }));
    expect(screen.getByText("工具源码")).toBeTruthy();
    expect(await screen.findByText("定位信息")).toBeTruthy();
    expect(screen.getByText(/packages\/studio\/src\/components\/ChatWindow\.tsx/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    fireEvent.click(screen.getByRole("button", { name: "全屏查看" }));
    expect(screen.getByText("工具调用全屏详情")).toBeTruthy();
    expect(screen.getAllByText("原始载荷").length).toBeGreaterThan(1);
    fireEvent.click(screen.getAllByRole("button", { name: "Close" }).at(-1)!);

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
