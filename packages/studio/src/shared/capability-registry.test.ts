import { describe, expect, it } from "vitest";

import {
  type CapabilityRegistryEntry,
  type CapabilityRegistryEntryStatus,
  type CapabilityRegistryEntryKind,
  getCapabilityRegistry,
  CAPABILITY_REGISTRY_ENTRY_KINDS,
} from "./capability-registry";

describe("capability registry", () => {
  it("defines all required entry kinds", () => {
    expect(CAPABILITY_REGISTRY_ENTRY_KINDS).toEqual([
      "command",
      "tool",
      "skill",
      "hook",
      "subagent",
      "mcp-tool",
      "prompt-fragment",
      "workflow-recipe",
      "genre-preset",
      "writing-mode",
    ]);
  });

  it("returns a registry with entries from commands, tools, and planned capabilities", () => {
    const registry = getCapabilityRegistry();

    expect(registry.length).toBeGreaterThan(0);
    const commandEntries = registry.filter((entry) => entry.kind === "command");
    expect(commandEntries.length).toBeGreaterThan(5);
    expect(commandEntries[0]).toMatchObject({
      kind: "command",
      source: expect.stringMatching(/^(builtin|core|plugin)$/),
      status: expect.stringMatching(/^(current|partial|planned)$/),
    });

    const toolEntries = registry.filter((entry) => entry.kind === "tool");
    expect(toolEntries.length).toBeGreaterThan(3);

    for (const entry of registry) {
      expect(entry.id).toBeTruthy();
      expect(entry.name).toBeTruthy();
      expect(entry.kind).toBeTruthy();
      expect(entry.source).toBeTruthy();
      expect(entry.status).toBeTruthy();
      expect(entry.scope).toBeTruthy();
      expect(typeof entry.enabled).toBe("boolean");
    }
  });

  it("includes planned hooks, MCP tools, and workflow recipes with appropriate status", () => {
    const registry = getCapabilityRegistry();

    const hooks = registry.filter((entry) => entry.kind === "hook");
    expect(hooks.length).toBeGreaterThan(0);
    expect(hooks.every((entry) => entry.status === "planned")).toBe(true);

    const mcpTools = registry.filter((entry) => entry.kind === "mcp-tool");
    expect(mcpTools.length).toBeGreaterThan(0);

    const recipes = registry.filter((entry) => entry.kind === "workflow-recipe");
    expect(recipes.length).toBeGreaterThan(0);
  });
});
