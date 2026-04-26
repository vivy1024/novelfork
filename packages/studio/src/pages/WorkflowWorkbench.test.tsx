import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const { useApiMock } = vi.hoisted(() => ({
  useApiMock: vi.fn(),
}));

vi.mock("../hooks/use-api", () => ({
  useApi: useApiMock,
}));
vi.mock("./ConfigView", () => ({ ConfigView: () => <div>ConfigView</div> }));
vi.mock("./AgentPanel", () => ({
  AgentPanel: ({ nav }: { nav: { toWorkflow?: () => void } }) => (
    <div>
      <div>AgentPanel</div>
      <button onClick={nav.toWorkflow}>返回工作流配置</button>
    </div>
  ),
}));
vi.mock("./MCPServerManager", () => ({ MCPServerManager: () => <div>MCPServerManager</div> }));
vi.mock("./PluginManager", () => ({ PluginManager: () => <div>PluginManager</div> }));
vi.mock("./LLMAdvancedConfig", () => ({ LLMAdvancedConfig: () => <div>LLMAdvancedConfig</div> }));
vi.mock("./SchedulerConfig", () => ({ SchedulerConfig: () => <div>SchedulerConfig</div> }));
vi.mock("./DetectionConfigView", () => ({ DetectionConfigView: () => <div>DetectionConfigView</div> }));
vi.mock("./HookDashboard", () => ({ HookDashboard: () => <div>HookDashboard</div> }));
vi.mock("./NotifyConfig", () => ({ NotifyConfig: () => <div>NotifyConfig</div> }));

import { WorkflowWorkbench } from "./WorkflowWorkbench";

const nav = {
  toDashboard: vi.fn(),
  toBook: vi.fn(),
  toSettings: vi.fn(),
  toWorkflow: vi.fn(),
};

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  nav.toDashboard.mockReset();
  nav.toBook.mockReset();
  nav.toSettings.mockReset();
  nav.toWorkflow.mockReset();
  MockEventSource.instances = [];
});

describe("WorkflowWorkbench", () => {
  beforeEach(() => {
    useApiMock.mockReset();
    useApiMock.mockImplementation((path: string) => {
      if (path === "/settings/user") {
        return {
          data: {
            preferences: {
              workbenchMode: true,
            },
            runtimeControls: {
              defaultPermissionMode: "ask",
              contextCompressionThresholdPercent: 80,
              contextTruncateTargetPercent: 70,
              toolAccess: {
                allowlist: ["Read", "Write"],
                blocklist: ["Edit"],
                mcpStrategy: "inherit",
              },
              recovery: {
                resumeOnStartup: true,
                maxRecoveryAttempts: 3,
                maxRetryAttempts: 5,
                initialRetryDelayMs: 1000,
                maxRetryDelayMs: 30000,
                backoffMultiplier: 2,
                jitterPercent: 20,
              },
              runtimeDebug: {
                tokenDebugEnabled: false,
                rateDebugEnabled: false,
                dumpEnabled: true,
                traceEnabled: true,
                traceSampleRatePercent: 50,
              },
            },
          },
          loading: false,
          error: null,
          refetch: vi.fn(),
        };
      }

        if (path === "/mcp/registry") {
          return {
            data: {
              summary: {
                totalServers: 2,
                connectedServers: 1,
                enabledTools: 3,
                discoveredTools: 5,
                allowTools: 2,
                promptTools: 1,
                denyTools: 2,
                policySource: "runtimeControls.toolAccess",
              },
              servers: [
                {
                  id: "fs",
                  name: "Filesystem",
                  tools: [
                    { name: "read_file", access: "prompt", source: "runtimeControls.toolAccess.mcpStrategy", reason: "MCP tool follows mcpStrategy=ask", reasonKey: "mcp-strategy-prompt" },
                    { name: "write_file", access: "prompt", source: "runtimeControls.toolAccess.mcpStrategy", reason: "MCP tool follows mcpStrategy=ask", reasonKey: "mcp-strategy-prompt" },
                    { name: "delete_file", access: "deny", source: "runtimeControls.toolAccess.blocklist", reason: "Tool is blocked by runtimeControls.toolAccess.blocklist", reasonKey: "blocklist-deny" },
                  ],
                },
              ],
            },
            loading: false,
            error: null,
            refetch: vi.fn(),
          };
        }

        if (path === "/tools/list") {
          return {
            data: {
              tools: [
                { name: "Read", access: "allow", source: "runtimeControls.toolAccess.allowlist", reason: "Tool is explicitly allowed by runtimeControls.toolAccess.allowlist", reasonKey: "allowlist-allow" },
                { name: "Write", access: "prompt", source: "builtin-permission-rules", reason: "Built-in write-like tools require confirmation by default", reasonKey: "builtin-write-prompt" },
                { name: "Edit", access: "deny", source: "runtimeControls.toolAccess.blocklist", reason: "Tool is blocked by runtimeControls.toolAccess.blocklist", reasonKey: "blocklist-deny" },
                { name: "Bash", access: "prompt", source: "runtimeControls.defaultPermissionMode", reason: "Tool falls back to defaultPermissionMode=ask", reasonKey: "default-prompt" },
              ],
            },
            loading: false,
            error: null,
            refetch: vi.fn(),
          };
        }


      return {
        data: null,
        loading: false,
        error: null,
        refetch: vi.fn(),
      };
    });
  });

  it("keeps section navigation inside the workbench shell", async () => {
    const onNavigateSection = vi.fn();

    render(
      <WorkflowWorkbench
        nav={nav}
        theme="light"
        t={(key: string) => key}
        section="agents"
        onNavigateSection={onNavigateSection}
      />,
    );

    expect(screen.getByText("工作流配置")).toBeTruthy();
    expect(screen.getByText("统一治理总览")).toBeTruthy();
    expect(screen.getByText("当前 workflow 编排")).toBeTruthy();
    expect(screen.getByText("工具执行边界")).toBeTruthy();
    expect(screen.getByText("MCP 注册表实时摘要")).toBeTruthy();
    expect(screen.getByText("当前区块：Agent")).toBeTruthy();
    expect(screen.getByText("区块摘要：16 个写作 Agent 的路由与状态总览")).toBeTruthy();
    expect(screen.getByText("保存策略：面板内保存")).toBeTruthy();
    expect(screen.getByText("toolAccess 模式")).toBeTruthy();
    expect(screen.getByText("逐项询问")).toBeTruthy();
    expect(screen.getByText(/所有工具动作先停下来/)).toBeTruthy();
    expect(screen.getByText("allowlist：2 项（Read / Write）")).toBeTruthy();
    expect(screen.getByText("blocklist：1 项（Edit）")).toBeTruthy();
    expect(screen.getByText("mcpStrategy：inherit")).toBeTruthy();
    expect(screen.getByText(/恢复策略：启动恢复开 .* 恢复 3 次 .* 重试 5 次 .* 1000ms→30000ms .* x2 .* jitter 20%/)).toBeTruthy();
    expect(screen.getByText(/上下文治理：压缩阈值 80% .* 截断目标 70%/)).toBeTruthy();
    expect(screen.getByText(/调试链：dump 开 .* trace 开 .* sample 50%/)).toBeTruthy();
    expect(screen.getAllByText("策略来源：runtimeControls.toolAccess").length).toBeGreaterThanOrEqual(1);
    expect(MockEventSource.instances[0]?.url).toBe("/api/runs/events");
    act(() => {
      MockEventSource.instances[0]?.emit({
        type: "snapshot",
        runId: "__all__",
        runs: [
          {
            id: "run-live-1",
            bookId: "demo-book",
            chapter: 7,
            chapterNumber: 7,
            action: "tool",
            status: "running",
            stage: "Tool Read",
            createdAt: "2026-04-21T10:00:00.000Z",
            updatedAt: "2026-04-21T10:00:01.000Z",
            startedAt: "2026-04-21T10:00:00.000Z",
            finishedAt: null,
            logs: [],
          },
          {
            id: "run-live-2",
            bookId: "demo-book",
            chapter: 8,
            chapterNumber: 8,
            action: "audit",
            status: "failed",
            stage: "Audit Failed",
            createdAt: "2026-04-21T09:59:00.000Z",
            updatedAt: "2026-04-21T10:00:00.000Z",
            startedAt: "2026-04-21T09:59:00.000Z",
            finishedAt: "2026-04-21T10:00:00.000Z",
            logs: [],
            error: "audit failed",
          },
        ],
      });
    });
    expect(screen.getByText(/活跃 run：1 \/ 总 run：2/)).toBeTruthy();
    expect(screen.getByText(/失败 run：1/)).toBeTruthy();
    expect(screen.getByText(/最新阶段：Tool Read/)).toBeTruthy();
    expect(screen.getByText(/tool · running · Tool Read · run-live-1/)).toBeTruthy();
    expect(screen.getByText(/audit · failed · Audit Failed · run-live-2/)).toBeTruthy();
    expect(screen.getByText(/已发现\s*5\s*个工具/)).toBeTruthy();
    expect(screen.getByText(/已启用\s*3\s*个工具/)).toBeTruthy();
    expect(screen.getByText(/allow\s*\/\s*prompt\s*\/\s*deny：2\s*\/\s*1\s*\/\s*2/)).toBeTruthy();
    expect(screen.getByText(/内置 tools：1\s*\/\s*2\s*\/\s*1/)).toBeTruthy();
    expect(screen.getByText((content) => content.includes("内置来源：allowlist 1") && content.includes("blocklist 1") && content.includes("default 1") && content.includes("builtin 1"))).toBeTruthy();
    expect(screen.getByText((content) => content.includes("MCP 来源：mcpStrategy 2") && content.includes("blocklist 1"))).toBeTruthy();
    expect(screen.getByText(/内置原因：blocklist 1 .* default ask 1 .* builtin prompt 1/)).toBeTruthy();
    expect(screen.getByText(/MCP 原因：mcpStrategy ask 2 .* blocklist 1/)).toBeTruthy();
    expect(screen.getByText("AgentPanel")).toBeTruthy();

    expect(screen.getByRole("button", { name: "返回工作流配置" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /MCP 工具/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "返回工作流配置" }));
    expect(onNavigateSection).toHaveBeenNthCalledWith(1, "project");

    await waitFor(() => {
      expect(screen.getByText("已连接 1 / 2 个 Server")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("tab", { name: /MCP 工具/ }));

    expect(onNavigateSection).toHaveBeenNthCalledWith(2, "mcp");
  });

  it("shows actionable governance drill-down with samples, filters, and shortcuts", async () => {
    render(
      <WorkflowWorkbench
        nav={nav}
        theme="light"
        t={(key: string) => key}
        section="project"
      />,
    );

    expect(screen.getByRole("button", { name: "全部样本" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "仅看需确认" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "仅看已拒绝" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "全部范围" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "仅看内置" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "仅看 MCP" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "全部来源" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "仅看 blocklist" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "仅看 mcpStrategy" })).toBeTruthy();
    expect(screen.getByText("内置工具需确认样本")).toBeTruthy();
    expect(screen.getByText("Write · 内置写类工具默认确认")).toBeTruthy();
    expect(screen.getByText("Bash · 默认权限要求确认")).toBeTruthy();
    expect(screen.getByText("内置工具已拒绝样本")).toBeTruthy();
    expect(screen.getByText("Edit · 命中阻止列表")).toBeTruthy();
    expect(screen.getByText("MCP 工具需确认样本")).toBeTruthy();
    expect(screen.getByText("fs / read_file · MCP 策略要求确认")).toBeTruthy();
    expect(screen.getByText("fs / write_file · MCP 策略要求确认")).toBeTruthy();
    expect(screen.getByText("MCP 工具已拒绝样本")).toBeTruthy();
    expect(screen.getByText("fs / delete_file · 命中阻止列表")).toBeTruthy();
    expect(screen.getByText("原因分组与处置入口")).toBeTruthy();
    expect(screen.getByText("内置写类工具默认确认 · 1")).toBeTruthy();
    expect(screen.getByText("默认权限要求确认 · 1")).toBeTruthy();
    expect(screen.getByText("命中阻止列表 · 2")).toBeTruthy();
    expect(screen.getByText("MCP 策略要求确认 · 2")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "仅看已拒绝" }));
    expect(screen.queryByText("Write · 内置写类工具默认确认")).toBeNull();
    expect(screen.getByText("Edit · 命中阻止列表")).toBeTruthy();
    expect(screen.getByText("fs / delete_file · 命中阻止列表")).toBeTruthy();
    expect(screen.queryByText("MCP 策略要求确认 · 2")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "仅看需确认" }));
    expect(screen.getByText("Write · 内置写类工具默认确认")).toBeTruthy();
    expect(screen.getByText("fs / read_file · MCP 策略要求确认")).toBeTruthy();
    expect(screen.queryByText("Edit · 命中阻止列表")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "仅看 MCP" }));
    fireEvent.click(screen.getByRole("button", { name: "仅看 mcpStrategy" }));
    await waitFor(() => {
      expect(screen.queryByText("Write · 内置写类工具默认确认")).toBeNull();
      expect(screen.getByText("fs / read_file · MCP 策略要求确认")).toBeTruthy();
      expect(screen.getByText("fs / write_file · MCP 策略要求确认")).toBeTruthy();
      expect(screen.queryByText("fs / delete_file · 命中阻止列表")).toBeNull();
      expect(screen.getByText("MCP 策略要求确认 · 2")).toBeTruthy();
      expect(screen.queryByText("命中阻止列表 · 2")).toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "全部范围" }));
    fireEvent.click(screen.getByRole("button", { name: "全部来源" }));

    fireEvent.click(screen.getByRole("button", { name: "前往高级设置" }));
    expect(nav.toSettings).toHaveBeenCalledWith("advanced");

    fireEvent.click(screen.getByRole("button", { name: "前往 MCP 管理" }));
    expect(nav.toWorkflow).toHaveBeenCalledWith("mcp");
  });

});
