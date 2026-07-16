import { describe, expect, it } from "vitest";
import { RuntimePluginHost } from "../plugins/runtime-plugin-host.js";
import type { RuntimePluginContribution, RuntimeResolveContext } from "../plugins/runtime-contract.js";

const context = (enabledPluginIds: readonly string[], projectType = "novel"): RuntimeResolveContext => ({
  runtimeProjectId: "runtime-1",
  projectRoot: "/project",
  projectType,
  enabledPluginIds,
  resourceBindings: {},
});

function plugin(id: string, toolName = `${id}.read`): RuntimePluginContribution {
  return {
    id,
    projectTypes: ["novel"],
    tools: [{
      definition: { name: toolName, description: toolName, inputSchema: { type: "object" } },
      handler: () => ({ ok: true }),
    }],
  };
}

describe("RuntimePluginHost", () => {
  it("isolates registrations between host instances", () => {
    const first = new RuntimePluginHost();
    const second = new RuntimePluginHost();
    first.register(plugin("alpha"));

    expect(first.resolve(context(["alpha"])).tools).toHaveLength(1);
    expect(second.resolve(context(["alpha"])).tools).toHaveLength(0);
  });

  it("synchronizes visibility with project type and enabled plugin ids", () => {
    const host = new RuntimePluginHost();
    host.register(plugin("alpha"));

    expect(host.resolve(context([])).tools).toHaveLength(0);
    expect(host.resolve(context(["alpha"], "general")).tools).toHaveLength(0);
    expect(host.resolve(context(["alpha"])).tools).toHaveLength(1);
    expect(host.unregister("alpha")).toBe(true);
    expect(host.resolve(context(["alpha"])).tools).toHaveLength(0);
  });

  it("rejects conflicts atomically", () => {
    const host = new RuntimePluginHost();
    host.register({
      ...plugin("alpha", "shared.read"),
      routes: [{ id: "route-a", method: "GET", path: "/shared", handler: () => null }],
      pages: [{ id: "page-a", path: "/page", title: "Page", componentKey: "page" }],
      agentPresets: [{ id: "preset-a", name: "Preset", tools: [] }],
      promptExtensions: [{ id: "prompt-a", content: "a" }],
    });

    const conflicting: RuntimePluginContribution = {
      ...plugin("beta", "shared.read"),
      routes: [{ id: "route-b", method: "GET", path: "/shared", handler: () => null }],
    };
    expect(() => host.register(conflicting)).toThrow(/tool name conflict/);
    expect(host.has("beta")).toBe(false);
    expect(() => host.register(plugin("alpha", "other.read"))).toThrow(/plugin id conflict/);
  });

  it("detects route, page, preset, and prompt conflicts", () => {
    const base: RuntimePluginContribution = {
      id: "alpha",
      projectTypes: ["novel"],
      routes: [{ id: "route-a", method: "GET", path: "/shared", handler: () => null }],
      pages: [{ id: "page-a", path: "/page", title: "Page", componentKey: "page" }],
      agentPresets: [{ id: "preset-a", name: "Preset", tools: [] }],
      promptExtensions: [{ id: "prompt-a", content: "a" }],
    };
    const conflicts: Array<[string, Partial<RuntimePluginContribution>]> = [
      ["route", { routes: [{ id: "route-b", method: "GET", path: "/shared", handler: () => null }] }],
      ["page", { pages: [{ id: "page-b", path: "/page", title: "Other", componentKey: "other" }] }],
      ["preset", { agentPresets: [{ id: "preset-a", name: "Other", tools: [] }] }],
      ["prompt id", { promptExtensions: [{ id: "prompt-a", content: "other" }] }],
    ];

    for (const [message, additions] of conflicts) {
      const host = new RuntimePluginHost();
      host.register(base);
      expect(() => host.register({ id: "beta", projectTypes: ["novel"], ...additions })).toThrow(message);
      expect(host.has("beta")).toBe(false);
    }
  });

  it("aggregates visible learning contributions and rejects duplicate learning ids", () => {
    const text = (value: string) => ({ "zh-CN": value, en: value });
    const learning = {
      categories: [{ id: "writing", label: text("Writing"), description: text("Writing docs") }],
      docs: [{
        id: "books",
        category: "writing",
        title: text("Books"),
        summary: text("Manage books"),
        sections: [],
        workflow: [],
        bestPractices: [],
        pitfalls: [],
        agentHints: [],
        tags: ["books"],
        actions: [],
      }],
    };
    const host = new RuntimePluginHost();
    host.register({ id: "alpha", projectTypes: ["novel"], learning });

    expect(host.resolve(context(["alpha"]))).toMatchObject({
      learning: [{
        categories: [{ id: "writing" }],
        docs: [{ id: "books", category: "writing" }],
      }],
    });
    expect(host.resolve(context([])).learning).toEqual([]);
    expect(() => host.register({ id: "beta", projectTypes: ["novel"], learning })).toThrow(/learning category id conflict/);
  });

  it("sorts prompts by position, order, then id", () => {
    const host = new RuntimePluginHost();
    host.register({
      id: "alpha",
      projectTypes: ["novel"],
      promptExtensions: [
        { id: "after", content: "after", position: "after", order: -10 },
        { id: "before-z", content: "z", position: "before", order: 2 },
        { id: "before-a", content: "a", position: "before", order: 2 },
      ],
    });

    expect(host.resolve(context(["alpha"])).promptExtensions.map((item) => item.id)).toEqual([
      "before-a", "before-z", "after",
    ]);
  });
});
