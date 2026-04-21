import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { useRoutinesEditorMock, fetchJsonMock } = vi.hoisted(() => ({
  useRoutinesEditorMock: vi.fn(),
  fetchJsonMock: vi.fn(),
}));

vi.mock("./ConfigView", () => ({ ConfigView: () => <div>ConfigView</div> }));
vi.mock("./AgentPanel", () => ({ AgentPanel: () => <div>AgentPanel</div> }));
vi.mock("./MCPServerManager", () => ({ MCPServerManager: () => <div>MCPServerManager</div> }));
vi.mock("./PluginManager", () => ({ PluginManager: () => <div>PluginManager</div> }));
vi.mock("./LLMAdvancedConfig", () => ({ LLMAdvancedConfig: () => <div>LLMAdvancedConfig</div> }));
vi.mock("./SchedulerConfig", () => ({ SchedulerConfig: () => <div>SchedulerConfig</div> }));
vi.mock("./DetectionConfigView", () => ({ DetectionConfigView: () => <div>DetectionConfigView</div> }));
vi.mock("./HookDashboard", () => ({ HookDashboard: () => <div>HookDashboard</div> }));
vi.mock("./NotifyConfig", () => ({ NotifyConfig: () => <div>NotifyConfig</div> }));
vi.mock("../providers/novelfork-context", () => ({ useNovelFork: () => ({ workspace: "D:/workspace/novel" }) }));
vi.mock("@/components/Routines/PermissionsTab", () => ({ PermissionsTab: () => <div>PermissionsTab</div> }));
vi.mock("@/components/Routines/MCPToolsTab", () => ({ MCPToolsTab: () => <div>MCPToolsTab</div> }));
vi.mock("@/components/Routines/PromptsTab", () => ({ PromptsTab: () => <div>PromptsTab</div> }));
vi.mock("@/components/Routines/SubAgentsTab", () => ({ SubAgentsTab: () => <div>SubAgentsTab</div> }));
vi.mock("@/components/Routines/use-routines-editor", () => ({
  ROUTINES_SCOPE_META: {
    merged: { label: "生效视图", description: "默认读取 merged 视图；项目配置覆盖全局配置，只读展示当前实际生效结果。" },
    global: { label: "全局", description: "编辑 ~/.inkos/routines.json，作为所有项目的默认基线。" },
    project: { label: "项目", description: "编辑 <workspace>/.inkos/routines.json，只影响当前工作区。" },
  },
  useRoutinesEditor: useRoutinesEditorMock,
}));
vi.mock("@/hooks/use-api", () => ({
  fetchJson: fetchJsonMock,
}));

import { WorkflowWorkbench } from "./WorkflowWorkbench";

const nav = {
  toDashboard: vi.fn(),
  toBook: vi.fn(),
};

beforeEach(() => {
  fetchJsonMock.mockResolvedValue({
    summary: {
      totalServers: 1,
      connectedServers: 1,
      enabledTools: 1,
      discoveredTools: 2,
    },
    servers: [],
  });

  useRoutinesEditorMock.mockImplementation(() => ({
    error: null,
    handleReset: vi.fn(),
    handleSave: vi.fn(),
    hasProjectScope: true,
    isReadOnly: true,
    loading: false,
    routines: {
      commands: [],
      tools: [],
      permissions: [{ tool: "Bash", permission: "ask", source: "user" }],
      globalSkills: [],
      projectSkills: [],
      subAgents: [
        {
          id: "agent-1",
          name: "审校代理",
          description: "检查连续性",
          type: "specialized",
          systemPrompt: "请专注审校",
          enabled: true,
        },
      ],
      globalPrompts: [{ id: "prompt-1", name: "全局提示", content: "global", enabled: true }],
      systemPrompts: [{ id: "prompt-2", name: "系统提示", content: "system", enabled: true }],
      mcpTools: [{ id: "mcp-1", serverName: "local", toolName: "search", enabled: true, approved: true }],
    },
    saved: false,
    saving: false,
    scopeMeta: { label: "生效视图", description: "默认读取 merged 视图；项目配置覆盖全局配置，只读展示当前实际生效结果。" },
    setRoutines: vi.fn(),
    setViewScope: vi.fn(),
    viewScope: "merged",
  }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("WorkflowWorkbench", () => {
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

    expect(screen.getByText("工作流配置台")).toBeTruthy();
    expect(screen.getByText("当前区块的配置边界")).toBeTruthy();
    expect(screen.getByText("Routines 主事实源")).toBeTruthy();
    expect(screen.getAllByText(/默认读取 merged 视图/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("混合").length).toBeGreaterThan(0);
    expect(screen.getByText("Agent 路由在主面板保存，执行权限、MCP 工具与子代理在下方 routines 区块按 global / project 保存。")).toBeTruthy();
    expect(screen.getByText("执行编排资源")).toBeTruthy();
    expect(screen.getByTestId("workflow-routines-agents-permissions")).toBeTruthy();
    expect(screen.getByTestId("workflow-routines-agents-mcp-tools")).toBeTruthy();
    expect(screen.getByTestId("workflow-routines-agents-subagents")).toBeTruthy();
    expect(screen.getByText("PermissionsTab")).toBeTruthy();
    expect(screen.getByText("MCPToolsTab")).toBeTruthy();
    expect(screen.getByText("SubAgentsTab")).toBeTruthy();
    expect(screen.getByRole("tab", { name: /MCP 工具/ })).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByTestId("workflow-routines-agents-mcp-registry")).toBeTruthy();
      expect(screen.getByText("实时 MCP 注册表")).toBeTruthy();
      expect(screen.getByText("已发现 2")).toBeTruthy();
      expect(screen.getByText("已启用 1")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("tab", { name: /MCP 工具/ }));

    expect(onNavigateSection).toHaveBeenCalledWith("mcp");
  });

  it("shows prompt and hook resources as formal workflow blocks", () => {
    const { rerender } = render(
      <WorkflowWorkbench
        nav={nav}
        theme="light"
        t={(key: string) => key}
        section="project"
      />,
    );

    expect(screen.getByText("Prompt 资源")).toBeTruthy();
    expect(screen.getByTestId("workflow-routines-prompts-prompts")).toBeTruthy();
    expect(screen.getByText("PromptsTab")).toBeTruthy();

    rerender(
      <WorkflowWorkbench
        nav={nav}
        theme="light"
        t={(key: string) => key}
        section="hooks"
      />,
    );

    expect(screen.getByTestId("workflow-hooks-resource")).toBeTruthy();
    expect(screen.getByText("Hooks 资源区块")).toBeTruthy();
    expect(screen.getByText("HookDashboard")).toBeTruthy();
  });
});
