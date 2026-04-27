import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Routines as RoutinesConfig } from "../../types/routines";

const { fetchRoutinesMock, saveRoutinesMock, resetRoutinesMock } = vi.hoisted(() => ({
  fetchRoutinesMock: vi.fn<(scope: "global" | "project" | "merged", projectRoot?: string) => Promise<RoutinesConfig>>(),
  saveRoutinesMock: vi.fn<(scope: "global" | "project", routines: RoutinesConfig, projectRoot?: string) => Promise<void>>(),
  resetRoutinesMock: vi.fn<(scope: "global" | "project", projectRoot?: string) => Promise<RoutinesConfig>>(),
}));

vi.mock("../../components/Routines/routines-api", () => ({
  fetchRoutines: fetchRoutinesMock,
  saveRoutines: saveRoutinesMock,
  resetRoutines: resetRoutinesMock,
}));

import { RoutinesNextPage } from "./RoutinesNextPage";

const sampleRoutines: RoutinesConfig = {
  commands: [{ id: "cmd-1", name: "write-next", description: "生成下一章", prompt: "/write-next", enabled: true }],
  tools: [{ name: "Terminal", enabled: true, description: "Interactive shell" }],
  permissions: [{ tool: "Bash", permission: "ask", source: "user" }],
  globalSkills: [{ id: "skill-1", name: "systematic-debugging", description: "debug", instructions: "trace", enabled: true }],
  projectSkills: [{ id: "skill-2", name: "writing-style", description: "style", instructions: "style", enabled: true }],
  subAgents: [{ id: "agent-1", name: "reviewer", description: "review", type: "specialized", systemPrompt: "review", enabled: true }],
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
});
