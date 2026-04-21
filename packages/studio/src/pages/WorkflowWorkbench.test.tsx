import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
};

afterEach(() => {
  cleanup();
});

describe("WorkflowWorkbench", () => {
  beforeEach(() => {
    useApiMock.mockReset();
    useApiMock.mockImplementation((path: string) => {
      if (path === "/settings/user") {
        return {
          data: {
            runtimeControls: {
              defaultPermissionMode: "ask",
              toolAccess: {
                allowlist: ["Read", "Write"],
                blocklist: ["Edit"],
                mcpStrategy: "inherit",
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
                id: "server-1",
                name: "Filesystem",
                transport: "stdio",
                status: "connected",
                tools: [{ name: "read_file", description: "Read a file" }],
                toolCount: 1,
              },
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
    expect(screen.getByText("ask")).toBeTruthy();
    expect(screen.getByText("allowlist：2 项（Read / Write）")).toBeTruthy();
    expect(screen.getByText("blocklist：1 项（Edit）")).toBeTruthy();
    expect(screen.getByText("mcpStrategy：inherit")).toBeTruthy();
    expect(screen.getAllByText("策略来源：runtimeControls.toolAccess").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("已发现 5 个工具")).toBeTruthy();
    expect(screen.getByText("已启用 3 个工具")).toBeTruthy();
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

});
