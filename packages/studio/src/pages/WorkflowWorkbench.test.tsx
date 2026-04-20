import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./ConfigView", () => ({ ConfigView: () => <div>ConfigView</div> }));
vi.mock("./AgentPanel", () => ({ AgentPanel: () => <div>AgentPanel</div> }));
vi.mock("./MCPServerManager", () => ({ MCPServerManager: () => <div>MCPServerManager</div> }));
vi.mock("./PluginManager", () => ({ PluginManager: () => <div>PluginManager</div> }));
vi.mock("./LLMAdvancedConfig", () => ({ LLMAdvancedConfig: () => <div>LLMAdvancedConfig</div> }));
vi.mock("./SchedulerConfig", () => ({ SchedulerConfig: () => <div>SchedulerConfig</div> }));
vi.mock("./DetectionConfigView", () => ({ DetectionConfigView: () => <div>DetectionConfigView</div> }));
vi.mock("./HookDashboard", () => ({ HookDashboard: () => <div>HookDashboard</div> }));
vi.mock("./NotifyConfig", () => ({ NotifyConfig: () => <div>NotifyConfig</div> }));

import { WorkflowWorkbench } from "./WorkflowWorkbench";

afterEach(() => {
  cleanup();
});

describe("WorkflowWorkbench", () => {
  it("keeps section navigation inside the workbench shell", () => {
    const onNavigateSection = vi.fn();
    const nav = {
      toDashboard: vi.fn(),
      toBook: vi.fn(),
    };

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
    expect(screen.getAllByText("全局级").length).toBeGreaterThan(0);
    expect(screen.getByText("按 Agent 分组在各自面板保存，避免误改整套编排。")).toBeTruthy();
    expect(screen.getByRole("tab", { name: /MCP 工具/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /MCP 工具/ }));

    expect(onNavigateSection).toHaveBeenCalledWith("mcp");
  });
});
