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

const sampleRoutines = {
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
  hooks: [{ id: "hook-1", name: "审稿后通知", event: "after-audit", kind: "webhook", target: "https://hooks.example/audit", enabled: true }],
} as unknown as RoutinesConfig;

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

    const routineNav = screen.getByRole("tablist", { name: "套路分区" });
    for (const label of ["命令", "可选工具", "工具权限", "全局技能", "项目技能", "自定义子代理", "全局提示词", "系统提示词", "MCP 工具", "钩子"]) {
      expect(within(routineNav).getByRole("tab", { name: new RegExp(label) })).toBeTruthy();
    }
    expect(screen.getByText(/只读视图，切换到全局或项目 scope 后可编辑/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "保存" }).hasAttribute("disabled")).toBe(true);
  });

  it("switches to editable scopes and saves through the old routines API", async () => {
    render(<RoutinesNextPage projectRoot="D:/workspace/novel" />);

    await waitFor(() => expect(fetchRoutinesMock).toHaveBeenCalledWith("merged", "D:/workspace/novel"));
    fireEvent.click(screen.getByRole("button", { name: "全局" }));

    await waitFor(() => expect(fetchRoutinesMock).toHaveBeenLastCalledWith("global", "D:/workspace/novel"));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(saveRoutinesMock).toHaveBeenCalledWith("global", sampleRoutines, "D:/workspace/novel"));
  });

  it("mounts legacy routines editors inside the new fixed sections", async () => {
    render(<RoutinesNextPage projectRoot="D:/workspace/novel" />);

    await waitFor(() => expect(fetchRoutinesMock).toHaveBeenCalledWith("merged", "D:/workspace/novel"));
    fireEvent.click(screen.getByRole("button", { name: "全局" }));
    await waitFor(() => expect(fetchRoutinesMock).toHaveBeenLastCalledWith("global", "D:/workspace/novel"));

    expect(screen.getByRole("button", { name: "Add Command" })).toBeTruthy();
    expect(screen.getByText("/write-next")).toBeTruthy();

    const routineNav = screen.getByRole("tablist", { name: "套路分区" });
    fireEvent.click(within(routineNav).getByRole("tab", { name: /可选工具/ }));
    expect(screen.getByPlaceholderText("Search tools...")).toBeTruthy();
    expect(screen.getByText("/load terminal")).toBeTruthy();
    expect(screen.getByText("/load share_file")).toBeTruthy();

    fireEvent.click(within(routineNav).getByRole("tab", { name: /工具权限/ }));
    expect(screen.getByText("Bash 命令规则")).toBeTruthy();
    expect(screen.getByText("MCP 工具权限")).toBeTruthy();
    expect(screen.getByText("来源：托管规则")).toBeTruthy();
    expect(screen.getAllByText("需确认").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Bash allowlist|\ballow\b|\bask\b|\bdeny\b|来源：managed|来源：user/)).toBeNull();

    fireEvent.click(within(routineNav).getByRole("tab", { name: /项目技能/ }));
    expect(screen.getByText("当前分区：项目技能")).toBeTruthy();
    expect(screen.queryByText("systematic-debugging")).toBeNull();
    expect(screen.getByText("writing-style")).toBeTruthy();

    fireEvent.click(within(routineNav).getByRole("tab", { name: /系统提示词/ }));
    expect(screen.getByText("当前分区：系统提示词")).toBeTruthy();
    expect(screen.queryByText("global")).toBeNull();
    expect(screen.getAllByText("system").length).toBeGreaterThan(0);

    fireEvent.click(within(routineNav).getByRole("tab", { name: /自定义子代理/ }));
    expect(screen.getByRole("button", { name: "Add Sub-agent" })).toBeTruthy();
    expect(screen.getByText("工具权限规则")).toBeTruthy();
    expect(screen.getByText("Bash：直接允许 · 规则 pnpm *")).toBeTruthy();
    expect(screen.queryByText("Bash: allow pnpm *")).toBeNull();

    fireEvent.click(within(routineNav).getByRole("tab", { name: /MCP 工具/ }));
    expect(screen.getByText("memory")).toBeTruthy();
  });

  it("reuses MCP server registry management and edits lifecycle hooks through routines", async () => {
    render(<RoutinesNextPage projectRoot="D:/workspace/novel" />);

    await waitFor(() => expect(fetchRoutinesMock).toHaveBeenCalledWith("merged", "D:/workspace/novel"));
    fireEvent.click(screen.getByRole("button", { name: "全局" }));
    await waitFor(() => expect(fetchRoutinesMock).toHaveBeenLastCalledWith("global", "D:/workspace/novel"));

    const routineNav = screen.getByRole("tablist", { name: "套路分区" });
    fireEvent.click(within(routineNav).getByRole("tab", { name: /MCP 工具/ }));
    expect(screen.getByText("MCP Server 管理")).toBeTruthy();
    expect(screen.getByRole("button", { name: /导入 JSON/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /添加 Server/ })).toBeTruthy();
    expect(screen.getByText("Memory")).toBeTruthy();
    expect(screen.getAllByText(/2 个工具/).length).toBeGreaterThan(0);
    expect(screen.getByText("策略来源：工具访问策略")).toBeTruthy();
    expect(screen.getAllByText("来源：MCP 默认策略").length).toBeGreaterThan(0);
    expect(screen.getByText("直接允许")).toBeTruthy();
    expect(screen.getByText("需确认")).toBeTruthy();
    expect(screen.queryByText(/runtimeControls\.toolAccess|\ballow\b|\bprompt\b/)).toBeNull();

    fireEvent.click(within(routineNav).getByRole("tab", { name: /钩子/ }));
    expect(screen.getByRole("heading", { name: "生命周期钩子" })).toBeTruthy();
    expect(screen.getByDisplayValue("审稿后通知")).toBeTruthy();
    expect(screen.getByDisplayValue("https://hooks.example/audit")).toBeTruthy();
    expect(screen.queryByText(/未接入|UnsupportedCapability/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "创建钩子" }));
    const hookNameInputs = screen.getAllByLabelText("钩子名称");
    const hookEventInputs = screen.getAllByLabelText("触发节点");
    const hookTargetInputs = screen.getAllByLabelText("执行目标");
    fireEvent.change(hookNameInputs.at(-1) as HTMLElement, { target: { value: "章节后整理" } });
    fireEvent.change(hookEventInputs.at(-1) as HTMLElement, { target: { value: "after-chapter-save" } });
    fireEvent.change(hookTargetInputs.at(-1) as HTMLElement, { target: { value: "bun scripts/after-chapter.ts" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(saveRoutinesMock).toHaveBeenCalled());
    const [, saved] = saveRoutinesMock.mock.calls.at(-1) ?? [];
    expect((saved as unknown as { hooks: Array<{ name: string; event: string; kind: string; target: string }> }).hooks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "审稿后通知", kind: "webhook" }),
      expect.objectContaining({ name: "章节后整理", event: "after-chapter-save", kind: "shell", target: "bun scripts/after-chapter.ts" }),
    ]));
  });
});
