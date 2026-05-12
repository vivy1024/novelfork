import { afterEach, describe, expect, it } from "vitest";
import {
  SESSION_TOOL_NAMES,
  clearPluginRegistrations,
  getAllSessionToolDefinitions,
  getEnabledSessionTools,
  getProviderSessionToolDefinitions,
  getSessionToolDefinition,
  getSessionToolNames,
  isSessionToolEnabledForMode,
  registerPluginAgentPresets,
  registerPluginTools,
} from "./session-tool-registry.js";
import { NOVEL_SESSION_TOOL_DEFINITIONS, NOVEL_AGENT_PRESETS } from "./session-tool-registry-novel.js";

const EXPECTED_BUILTIN_TOOL_NAMES = [
  "Bash",
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "EnterWorktree",
  "ExitWorktree",
  "AskUserQuestion",
  "EnterPlanMode",
  "ExitPlanMode",
  "TaskCreate",
  "WebSearch",
  "WebFetch",
  "Browser",
  "Agent",
  "Await",
  "Send",
  "ForkNarrator",
  "Terminal",
  "ShareFile",
  "Recall",
  "StartPipeline",
  "EndPipeline",
  "LearningGuide",
  "Skill",
  "GetGoals",
  "AddGoal",
  "UpdateGoal",
];

const WRITE_RISKS = new Set(["draft-write", "confirmed-write", "destructive"]);

describe("session tool registry", () => {
  afterEach(() => {
    clearPluginRegistrations();
  });

  it("SESSION_TOOL_NAMES contains only builtin tools (no plugin tools)", () => {
    expect(SESSION_TOOL_NAMES).toEqual(EXPECTED_BUILTIN_TOOL_NAMES);
  });

  it("registers builtin tools as serializable definitions without plugins", () => {
    const tools = getAllSessionToolDefinitions();
    expect(tools.map((tool) => tool.name)).toEqual(EXPECTED_BUILTIN_TOOL_NAMES);

    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.inputSchema).toMatchObject({ type: "object" });
      expect(["read", "draft-write", "confirmed-write", "destructive"]).toContain(tool.risk);
      expect(tool.enabledForModes.length).toBeGreaterThan(0);
      expect(tool.visibility).toBe("author");
      expect(typeof tool.renderer).toBe("string");
      expect("execute" in tool).toBe(false);
      expect(JSON.parse(JSON.stringify(tool))).toEqual(tool);
    }
  });

  it("dynamically registers plugin tools and merges them into the full list", () => {
    registerPluginTools(NOVEL_SESSION_TOOL_DEFINITIONS);

    const allNames = getSessionToolNames();
    // Novel tools come first, then builtin
    expect(allNames).toEqual([
      ...NOVEL_SESSION_TOOL_DEFINITIONS.map((t) => t.name),
      ...EXPECTED_BUILTIN_TOOL_NAMES,
    ]);

    // getAllSessionToolDefinitions also reflects the merge
    const tools = getAllSessionToolDefinitions();
    expect(tools.length).toBe(NOVEL_SESSION_TOOL_DEFINITIONS.length + EXPECTED_BUILTIN_TOOL_NAMES.length);
    expect(tools[0].name).toBe("cockpit.get_snapshot");
  });

  it("clearPluginRegistrations removes all plugin tools", () => {
    registerPluginTools(NOVEL_SESSION_TOOL_DEFINITIONS);
    expect(getSessionToolNames().length).toBeGreaterThan(EXPECTED_BUILTIN_TOOL_NAMES.length);

    clearPluginRegistrations();
    expect(getSessionToolNames()).toEqual(EXPECTED_BUILTIN_TOOL_NAMES);
  });

  it("filters tools by permission mode and hides write-risk tools in read and plan modes", () => {
    registerPluginTools(NOVEL_SESSION_TOOL_DEFINITIONS);

    for (const mode of ["read", "plan"] as const) {
      const visibleTools = getEnabledSessionTools(mode);
      expect(visibleTools.length).toBeGreaterThan(0);
      expect(visibleTools.every((tool) => !WRITE_RISKS.has(tool.risk))).toBe(true);
      // These read-risk novel tools should be visible (not in UNAVAILABLE_SERVICE_TOOLS)
      expect(visibleTools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
        "pgi.generate_questions",
        "guided.enter",
        "Read",
        "chapter.read",
        "jingwei.read_context",
      ]));
      expect(visibleTools.map((tool) => tool.name)).not.toContain("candidate.create_chapter");
      expect(visibleTools.map((tool) => tool.name)).not.toContain("questionnaire.submit_response");
      expect(visibleTools.map((tool) => tool.name)).not.toContain("pgi.record_answers");
      expect(visibleTools.map((tool) => tool.name)).not.toContain("guided.exit");
      expect(visibleTools.map((tool) => tool.name)).not.toContain("Bash");
      expect(visibleTools.map((tool) => tool.name)).not.toContain("Write");
      expect(visibleTools.map((tool) => tool.name)).not.toContain("Edit");
    }

    expect(getEnabledSessionTools("edit").map((tool) => tool.name)).toEqual(expect.arrayContaining([
      "candidate.create_chapter",
      "questionnaire.submit_response",
      "pgi.record_answers",
      "guided.exit",
      "Bash",
      "Write",
      "Edit",
    ]));
  });

  it("looks up definitions and exposes provider-compatible schemas without studio-only fields", () => {
    registerPluginTools(NOVEL_SESSION_TOOL_DEFINITIONS);

    expect(getSessionToolDefinition("cockpit.get_snapshot")).toMatchObject({
      name: "cockpit.get_snapshot",
      risk: "read",
      renderer: "cockpit.snapshot",
    });
    expect(getSessionToolDefinition("missing.tool")).toBeUndefined();
    expect(isSessionToolEnabledForMode("candidate.create_chapter", "read")).toBe(false);
    expect(isSessionToolEnabledForMode("candidate.create_chapter", "edit")).toBe(true);

    const providerTools = getProviderSessionToolDefinitions("read");
    // cockpit.get_snapshot is in UNAVAILABLE_SERVICE_TOOLS, so use a different novel tool
    expect(providerTools).toEqual(expect.arrayContaining([
      {
        type: "function",
        function: expect.objectContaining({
          name: "pgi.generate_questions",
          description: expect.any(String),
          parameters: expect.objectContaining({ type: "object" }),
        }),
      },
    ]));
    expect(providerTools.some((tool) => tool.function.name === "candidate.create_chapter")).toBe(false);
    expect(providerTools.every((tool) => !("renderer" in tool.function))).toBe(true);
    expect(providerTools.every((tool) => !("risk" in tool.function))).toBe(true);
    expect(providerTools.every((tool) => !("visibility" in tool.function))).toBe(true);
  });

  it("dynamically registers plugin agent presets and uses them in getEnabledSessionTools", () => {
    registerPluginTools(NOVEL_SESSION_TOOL_DEFINITIONS);
    registerPluginAgentPresets(NOVEL_AGENT_PRESETS);

    // "writer" preset disables Terminal, Browser, ForkNarrator, Recall, ShareFile
    const writerTools = getEnabledSessionTools("edit", "writer");
    expect(writerTools.map((t) => t.name)).not.toContain("Terminal");
    expect(writerTools.map((t) => t.name)).not.toContain("Browser");
    expect(writerTools.map((t) => t.name)).not.toContain("ForkNarrator");
  });

  it("without plugin registration, novel tools are not visible", () => {
    const tools = getEnabledSessionTools("edit");
    const novelToolNames = NOVEL_SESSION_TOOL_DEFINITIONS.map((t) => t.name);
    for (const name of novelToolNames) {
      expect(tools.map((t) => t.name)).not.toContain(name);
    }
  });
});
