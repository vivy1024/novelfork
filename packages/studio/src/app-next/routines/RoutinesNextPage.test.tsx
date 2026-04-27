import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Routines as RoutinesConfig } from "../../types/routines";

const { fetchRoutinesMock, saveRoutinesMock, resetRoutinesMock, useApiMock, postApiMock, putApiMock } = vi.hoisted(() => ({
  fetchRoutinesMock: vi.fn<(scope: "global" | "project" | "merged", projectRoot?: string) => Promise<RoutinesConfig>>(),
  saveRoutinesMock: vi.fn<(scope: "global" | "project", routines: RoutinesConfig, projectRoot?: string) => Promise<void>>(),
  resetRoutinesMock: vi.fn<(scope: "global" | "project", projectRoot?: string) => Promise<RoutinesConfig>>(),
  useApiMock: vi.fn(),
  postApiMock: vi.fn(),
  putApiMock: vi.fn(),
}));

vi.mock("../../components/Routines/routines-api", () => ({
  fetchRoutines: fetchRoutinesMock,
  saveRoutines: saveRoutinesMock,
  resetRoutines: resetRoutinesMock,
}));

vi.mock("../../hooks/use-api", () => ({
  useApi: useApiMock,
  postApi: postApiMock,
  putApi: putApiMock,
}));

import { RoutinesNextPage } from "./RoutinesNextPage";

const sampleRoutines: RoutinesConfig = {
  commands: [{ id: "cmd-1", name: "write-next", description: "生成下一章", prompt: "/write-next", enabled: true }],
  tools: [{ name: "Terminal", enabled: true, description: "Interactive shell" }],
  permissions: [
    { tool: "Bash", permission: "ask", pattern: "git *", source: "user" },
    { tool: "mcp__memory__recall", permission: "allow", source: "managed" },
  ],
  globalSkills: [{ id: "skill-1", name: "systematic-debugging", description: "debug", instructions: "trace", enabled: true }],
  projectSkills: [{ id: "skill-2", name: "writing-style", description: "style", instructions: "style", enabled: true }],
  subAgents: [{
    id: "agent-1",
    name: "reviewer",
    description: "review",
    type: "specialized",
    systemPrompt: "review",
    enabled: true,
    toolPermissions: [{ tool: "Bash", permission: "allow", pattern: "pnpm *", source: "project" }],
  } as any],
  globalPrompts: [{ id: "prompt-1", name: "global", content: "global", enabled: true }],
  systemPrompts: [{ id: "prompt-2", name: "system", content: "system", enabled: true }],
  mcpTools: [{ id: "mcp-1", serverName: "memory", toolName: "recall", enabled: true, approved: true }],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  fetchRoutinesMock.mockResolvedValue(sampleRoutines);
  saveRoutinesMock.mockResolvedValue();
  resetRoutinesMock.mockResolvedValue(sampleRoutines);
  useApiMock.mockReturnValue({
    data: {
      summary: {
        totalServers: 1,
        connectedServers: 1,
        enabledTools: 2,
        discoveredTools: 2,
        allowTools: 1,
        promptTools: 1,
        denyTools: 0,
        policySource: "runtimeControls.toolAccess",
        mcpStrategy: "inherit",
      },
      servers: [
        {
          id: "memory-server",
          name: "Memory",
          transport: "stdio",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-memory"],
          status: "connected",
          tools: [
            { name: "recall", description: "Recall memory", access: "allow", source: "runtimeControls.toolAccess.mcpStrategy" },
            { name: "remember", description: "Remember facts", access: "prompt", source: "runtimeControls.toolAccess.mcpStrategy" },
          ],
          toolCount: 2,
        },
      ],
    },
    refetch: vi.fn(),
  });
  postApiMock.mockResolvedValue({ ok: true });
  putApiMock.mockResolvedValue({ ok: true });
});

describe("RoutinesNextPage", () => {
  it("renders NarraFork-aligned ten sections while loading merged routines by default", async () => {
    render(<RoutinesNextPage projectRoot="D:/workspace/novel" />);

    await waitFor(() => {
      expect(fetchRoutinesMock).toHaveBeenCalledWith("merged", "D:/workspace/novel");
    });

    const routineNav = screen.getByRole("navigation", { name: "套路分区" });
    for (const label of ["命令", "可选工具", "工具权限", "全局技能", "项目技能", "自定义子代理", "全局提示词", "系统提示词", "MCP 工具", "钩子"]) {
      expect(within(routineNav).getByRole("button", { name: new RegExp(label) })).toBeTruthy();
    }
    expect(screen.getByText(/global \/ project \/ merged 三种 scope 复用旧 Routines API/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "保存套路" }).hasAttribute("disabled")).toBe(true);
  });

  it("switches to editable scopes and saves through the old routines API", async () => {
    render(<RoutinesNextPage projectRoot="D:/workspace/novel" />);

    await waitFor(() => expect(fetchRoutinesMock).toHaveBeenCalledWith("merged", "D:/workspace/novel"));
    fireEvent.click(screen.getByRole("button", { name: "全局" }));

    await waitFor(() => expect(fetchRoutinesMock).toHaveBeenLastCalledWith("global", "D:/workspace/novel"));
    fireEvent.click(screen.getByRole("button", { name: "保存套路" }));

    await waitFor(() => expect(saveRoutinesMock).toHaveBeenCalledWith("global", sampleRoutines, "D:/workspace/novel"));
  });

  it("mounts legacy routines editors inside the new fixed sections", async () => {
    render(<RoutinesNextPage projectRoot="D:/workspace/novel" />);

    await waitFor(() => expect(fetchRoutinesMock).toHaveBeenCalledWith("merged", "D:/workspace/novel"));
    fireEvent.click(screen.getByRole("button", { name: "全局" }));
    await waitFor(() => expect(fetchRoutinesMock).toHaveBeenLastCalledWith("global", "D:/workspace/novel"));

    expect(screen.getByRole("button", { name: "Add Command" })).toBeTruthy();
    expect(screen.getByText("/write-next")).toBeTruthy();

    const routineNav = screen.getByRole("navigation", { name: "套路分区" });
    fireEvent.click(within(routineNav).getByRole("button", { name: /可选工具/ }));
    expect(screen.getByPlaceholderText("Search tools...")).toBeTruthy();
    expect(screen.getByText("/LOAD Terminal")).toBeTruthy();
    expect(screen.getByText("/LOAD ShareFile")).toBeTruthy();

    fireEvent.click(within(routineNav).getByRole("button", { name: /工具权限/ }));
    expect(screen.getByText("Bash allowlist / blocklist")).toBeTruthy();
    expect(screen.getByText("MCP 工具权限")).toBeTruthy();
    expect(screen.getByText("来源：managed")).toBeTruthy();

    fireEvent.click(within(routineNav).getByRole("button", { name: /项目技能/ }));
    expect(screen.getByText("当前分区：项目技能")).toBeTruthy();
    expect(screen.queryByText("systematic-debugging")).toBeNull();
    expect(screen.getByText("writing-style")).toBeTruthy();

    fireEvent.click(within(routineNav).getByRole("button", { name: /系统提示词/ }));
    expect(screen.getByText("当前分区：系统提示词")).toBeTruthy();
    expect(screen.queryByText("global")).toBeNull();
    expect(screen.getAllByText("system").length).toBeGreaterThan(0);

    fireEvent.click(within(routineNav).getByRole("button", { name: /自定义子代理/ }));
    expect(screen.getByRole("button", { name: "Add Sub-agent" })).toBeTruthy();
    expect(screen.getByText("工具权限字段")).toBeTruthy();
    expect(screen.getByText("Bash: allow pnpm *")).toBeTruthy();

    fireEvent.click(within(routineNav).getByRole("button", { name: /MCP 工具/ }));
    expect(screen.getByText("memory")).toBeTruthy();
    expect(screen.getByText("导入 JSON / 添加 MCP 服务器在后续任务升级")).toBeTruthy();
  });

  it("reuses MCP server registry management and exposes hook creation in Task 12 sections", async () => {
    render(<RoutinesNextPage projectRoot="D:/workspace/novel" />);

    await waitFor(() => expect(fetchRoutinesMock).toHaveBeenCalledWith("merged", "D:/workspace/novel"));
    fireEvent.click(screen.getByRole("button", { name: "全局" }));
    await waitFor(() => expect(fetchRoutinesMock).toHaveBeenLastCalledWith("global", "D:/workspace/novel"));

    const routineNav = screen.getByRole("navigation", { name: "套路分区" });
    fireEvent.click(within(routineNav).getByRole("button", { name: /MCP 工具/ }));
    expect(screen.getByText("MCP Server 管理")).toBeTruthy();
    expect(screen.getByRole("button", { name: /导入 JSON/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /添加 Server/ })).toBeTruthy();
    expect(screen.getByText("Memory")).toBeTruthy();
    expect(screen.getAllByText(/2 个工具/).length).toBeGreaterThan(0);

    fireEvent.click(within(routineNav).getByRole("button", { name: /钩子/ }));
    expect(screen.getByText("生命周期节点")).toBeTruthy();
    expect(screen.getByText("Shell")).toBeTruthy();
    expect(screen.getByText("Webhook")).toBeTruthy();
    expect(screen.getByText("LLM 提示词")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "创建钩子" }));
    expect(screen.getByText("新建钩子草稿")).toBeTruthy();
  });
});
