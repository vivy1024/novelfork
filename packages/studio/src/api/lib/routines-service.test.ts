import { describe, expect, it } from "vitest";
import { mergeRoutines, normalizeRoutines } from "./routines-service";

describe("routines-service", () => {
  it("normalizes partial routines payloads", () => {
    const routines = normalizeRoutines({
      commands: [{ id: "cmd-1", name: "Global", description: "", prompt: "", enabled: true }],
    });

    expect(routines.commands).toHaveLength(1);
    expect(routines.tools).toEqual([]);
    expect(routines.permissions).toEqual([]);
    expect(routines.globalSkills).toEqual([]);
    expect(routines.projectSkills).toEqual([]);
    expect(routines.subAgents).toEqual([]);
    expect(routines.globalPrompts).toEqual([]);
    expect(routines.systemPrompts).toEqual([]);
    expect(routines.mcpTools).toEqual([]);
    expect(routines.hooks).toEqual([]);
  });

  it("builds merged view with project overrides as effective result", () => {
    const merged = mergeRoutines(
      {
        commands: [
          { id: "shared-command", name: "Global Command", description: "", prompt: "global", enabled: true },
          { id: "global-only-command", name: "Global Only", description: "", prompt: "global-only", enabled: true },
        ],
        tools: [
          { name: "bash", enabled: true, description: "global bash" },
          { name: "read", enabled: true, description: "global read" },
        ],
        permissions: [
          { tool: "bash", permission: "ask", source: "user" },
        ],
        globalSkills: [
          { id: "global-skill", name: "Global Skill", description: "", instructions: "", enabled: true },
        ],
        projectSkills: [],
        subAgents: [
          {
            id: "shared-agent",
            name: "Global Agent",
            description: "",
            type: "general-purpose",
            systemPrompt: "global",
            enabled: true,
          },
        ],
        globalPrompts: [
          { id: "global-prompt", name: "Global Prompt", content: "global", enabled: true },
        ],
        systemPrompts: [
          { id: "shared-system-prompt", name: "Global System Prompt", content: "global", enabled: true },
        ],
        mcpTools: [
          { id: "shared-mcp", serverName: "global-server", toolName: "global-tool", enabled: true, approved: false },
        ],
        hooks: [
          { id: "shared-hook", name: "Global Hook", event: "after-agent-run", kind: "shell", target: "global.sh", enabled: true },
        ],
      },
      {
        commands: [
          { id: "shared-command", name: "Project Command", description: "", prompt: "project", enabled: false },
          { id: "project-only-command", name: "Project Only", description: "", prompt: "project-only", enabled: true },
        ],
        tools: [
          { name: "bash", enabled: false, description: "project bash" },
        ],
        permissions: [
          { tool: "bash", permission: "deny", source: "project" },
        ],
        globalSkills: [],
        projectSkills: [
          { id: "project-skill", name: "Project Skill", description: "", instructions: "", enabled: true },
        ],
        subAgents: [
          {
            id: "shared-agent",
            name: "Project Agent",
            description: "",
            type: "specialized",
            systemPrompt: "project",
            enabled: false,
          },
        ],
        globalPrompts: [],
        systemPrompts: [
          { id: "shared-system-prompt", name: "Project System Prompt", content: "project", enabled: false },
        ],
        mcpTools: [
          { id: "shared-mcp", serverName: "project-server", toolName: "project-tool", enabled: false, approved: true },
        ],
        hooks: [
          { id: "shared-hook", name: "Project Hook", event: "after-chapter-save", kind: "webhook", target: "https://hook.example", enabled: false },
        ],
      },
    );

    expect(merged.commands).toEqual([
      { id: "shared-command", name: "Project Command", description: "", prompt: "project", enabled: false },
      { id: "global-only-command", name: "Global Only", description: "", prompt: "global-only", enabled: true },
      { id: "project-only-command", name: "Project Only", description: "", prompt: "project-only", enabled: true },
    ]);
    expect(merged.tools).toEqual([
      { name: "bash", enabled: false, description: "project bash" },
      { name: "read", enabled: true, description: "global read" },
    ]);
    expect(merged.permissions).toEqual([
      { tool: "bash", permission: "deny", source: "project" },
    ]);
    expect(merged.globalSkills).toEqual([
      { id: "global-skill", name: "Global Skill", description: "", instructions: "", enabled: true },
    ]);
    expect(merged.projectSkills).toEqual([
      { id: "project-skill", name: "Project Skill", description: "", instructions: "", enabled: true },
    ]);
    expect(merged.subAgents).toEqual([
      {
        id: "shared-agent",
        name: "Project Agent",
        description: "",
        type: "specialized",
        systemPrompt: "project",
        enabled: false,
      },
    ]);
    expect(merged.globalPrompts).toEqual([
      { id: "global-prompt", name: "Global Prompt", content: "global", enabled: true },
    ]);
    expect(merged.systemPrompts).toEqual([
      { id: "shared-system-prompt", name: "Project System Prompt", content: "project", enabled: false },
    ]);
    expect(merged.mcpTools).toEqual([
      { id: "shared-mcp", serverName: "project-server", toolName: "project-tool", enabled: false, approved: true },
    ]);
    expect(merged.hooks).toEqual([
      { id: "shared-hook", name: "Project Hook", event: "after-chapter-save", kind: "webhook", target: "https://hook.example", enabled: false },
    ]);
  });
});
