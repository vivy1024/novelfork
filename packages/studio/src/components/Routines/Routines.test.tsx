import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Routines as RoutinesConfig } from "../../types/routines";

const { fetchRoutinesMock, saveRoutinesMock, resetRoutinesMock } = vi.hoisted(() => ({
  fetchRoutinesMock: vi.fn<(
    scope: "global" | "project" | "merged",
    projectRoot?: string,
  ) => Promise<RoutinesConfig>>(),
  saveRoutinesMock: vi.fn<(
    scope: "global" | "project",
    routines: RoutinesConfig,
    projectRoot?: string,
  ) => Promise<void>>(),
  resetRoutinesMock: vi.fn<(
    scope: "global" | "project",
    projectRoot?: string,
  ) => Promise<RoutinesConfig>>(),
}));

vi.mock("../../providers/novelfork-context", () => ({
  useNovelFork: () => ({ workspace: "D:/workspace/novel" }),
}));

vi.mock("./routines-api", () => ({
  fetchRoutines: fetchRoutinesMock,
  saveRoutines: saveRoutinesMock,
  resetRoutines: resetRoutinesMock,
}));

vi.mock("./CommandsTab", () => ({ CommandsTab: () => <div>CommandsTab</div> }));
vi.mock("./PermissionsTab", () => ({ PermissionsTab: () => <div>PermissionsTab</div> }));
vi.mock("./SkillsTab", () => ({ SkillsTab: () => <div>SkillsTab</div> }));
vi.mock("./ToolsTab", () => ({ ToolsTab: () => <div>ToolsTab</div> }));
vi.mock("./SubAgentsTab", () => ({ SubAgentsTab: () => <div>SubAgentsTab</div> }));
vi.mock("./PromptsTab", () => ({ PromptsTab: () => <div>PromptsTab</div> }));
vi.mock("./MCPToolsTab", () => ({ MCPToolsTab: () => <div>MCPToolsTab</div> }));

import { Routines } from "./Routines";

const sampleRoutines: RoutinesConfig = {
  commands: [{ id: "cmd-1", name: "Command", description: "", prompt: "/do", enabled: true }],
  tools: [],
  permissions: [],
  globalSkills: [],
  projectSkills: [],
  subAgents: [],
  globalPrompts: [],
  systemPrompts: [],
  mcpTools: [],
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

describe("Routines", () => {
  it("defaults to merged view and treats it as read-only effective config", async () => {
    render(<Routines />);

    await waitFor(() => {
      expect(fetchRoutinesMock).toHaveBeenCalledWith("merged", "D:/workspace/novel");
    });

    expect(screen.getByTestId("routine-scope-summary").textContent).toContain("默认读取 merged 视图");
    expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("CommandsTab")).toBeTruthy();
  });

  it("loads global scope and saves through routines-service api", async () => {
    render(<Routines />);

    await waitFor(() => {
      expect(fetchRoutinesMock).toHaveBeenCalledWith("merged", "D:/workspace/novel");
    });

    fireEvent.click(screen.getByRole("button", { name: "全局" }));

    await waitFor(() => {
      expect(fetchRoutinesMock).toHaveBeenLastCalledWith("global", "D:/workspace/novel");
    });

    const saveButton = screen.getByRole("button", { name: "Save" });
    expect(saveButton.hasAttribute("disabled")).toBe(false);

    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(saveRoutinesMock).toHaveBeenCalledWith("global", sampleRoutines, "D:/workspace/novel");
    });
  });
});
