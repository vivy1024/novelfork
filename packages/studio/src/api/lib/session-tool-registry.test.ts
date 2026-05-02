import { describe, expect, it } from "vitest";
import {
  SESSION_TOOL_NAMES,
  getAllSessionToolDefinitions,
  getEnabledSessionTools,
  getProviderSessionToolDefinitions,
  getSessionToolDefinition,
  isSessionToolEnabledForMode,
} from "./session-tool-registry.js";

const EXPECTED_INITIAL_TOOL_NAMES = [
  "cockpit.get_snapshot",
  "cockpit.list_open_hooks",
  "cockpit.list_recent_candidates",
  "questionnaire.list_templates",
  "questionnaire.start",
  "questionnaire.suggest_answer",
  "questionnaire.submit_response",
  "pgi.generate_questions",
  "pgi.record_answers",
  "pgi.format_answers_for_prompt",
  "guided.enter",
  "guided.exit",
  "candidate.create_chapter",
  "narrative.read_line",
  "narrative.propose_change",
];

const WRITE_RISKS = new Set(["draft-write", "confirmed-write", "destructive"]);

describe("session tool registry", () => {
  it("registers the initial studio-facing tools as serializable definitions", () => {
    expect(SESSION_TOOL_NAMES).toEqual(EXPECTED_INITIAL_TOOL_NAMES);

    const tools = getAllSessionToolDefinitions();
    expect(tools.map((tool) => tool.name)).toEqual(EXPECTED_INITIAL_TOOL_NAMES);

    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.inputSchema).toMatchObject({ type: "object" });
      expect(["read", "draft-write", "confirmed-write", "destructive"]).toContain(tool.risk);
      expect(tool.enabledForModes.length).toBeGreaterThan(0);
      expect(typeof tool.renderer).toBe("string");
      expect("execute" in tool).toBe(false);
      expect(JSON.parse(JSON.stringify(tool))).toEqual(tool);
    }
  });

  it("filters tools by permission mode and hides write-risk tools in read and plan modes", () => {
    for (const mode of ["read", "plan"] as const) {
      const visibleTools = getEnabledSessionTools(mode);
      expect(visibleTools.length).toBeGreaterThan(0);
      expect(visibleTools.every((tool) => !WRITE_RISKS.has(tool.risk))).toBe(true);
      expect(visibleTools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
        "cockpit.get_snapshot",
        "pgi.generate_questions",
        "guided.enter",
        "narrative.read_line",
      ]));
      expect(visibleTools.map((tool) => tool.name)).not.toContain("candidate.create_chapter");
      expect(visibleTools.map((tool) => tool.name)).not.toContain("questionnaire.submit_response");
      expect(visibleTools.map((tool) => tool.name)).not.toContain("pgi.record_answers");
      expect(visibleTools.map((tool) => tool.name)).not.toContain("guided.exit");
    }

    expect(getEnabledSessionTools("edit").map((tool) => tool.name)).toEqual(expect.arrayContaining([
      "candidate.create_chapter",
      "questionnaire.submit_response",
      "pgi.record_answers",
      "guided.exit",
      "narrative.propose_change",
    ]));
  });

  it("looks up definitions and exposes provider-compatible schemas without studio-only fields", () => {
    expect(getSessionToolDefinition("cockpit.get_snapshot")).toMatchObject({
      name: "cockpit.get_snapshot",
      risk: "read",
      renderer: "cockpit.snapshot",
    });
    expect(getSessionToolDefinition("missing.tool")).toBeUndefined();
    expect(isSessionToolEnabledForMode("candidate.create_chapter", "read")).toBe(false);
    expect(isSessionToolEnabledForMode("candidate.create_chapter", "edit")).toBe(true);

    const providerTools = getProviderSessionToolDefinitions("read");
    expect(providerTools).toEqual(expect.arrayContaining([
      {
        type: "function",
        function: expect.objectContaining({
          name: "cockpit.get_snapshot",
          description: expect.any(String),
          parameters: expect.objectContaining({ type: "object" }),
        }),
      },
    ]));
    expect(providerTools.some((tool) => tool.function.name === "candidate.create_chapter")).toBe(false);
    expect(providerTools.every((tool) => !("renderer" in tool.function))).toBe(true);
    expect(providerTools.every((tool) => !("risk" in tool.function))).toBe(true);
  });
});
