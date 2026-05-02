import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HookManager } from "../hooks/hook-manager.js";
import { NovelForkPlugin, PluginManager, ToolRegistry } from "../index.js";
import type { PluginManifest } from "../plugins/index.js";

const tempDirs: string[] = [];

async function createPluginDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "novelfork-plugin-"));
  tempDirs.push(root);
  const pluginDir = join(root, "sample-plugin");
  await mkdir(pluginDir, { recursive: true });
  await writeFile(join(pluginDir, "manifest.json"), JSON.stringify({
    name: "sample-plugin",
    displayName: "Sample Plugin",
    version: "1.0.0",
    description: "test",
    tools: ["sample_tool"],
    hooks: ["before-write"],
  }), "utf-8");
  await writeFile(join(pluginDir, "index.js"), `
    import { NovelForkPlugin } from ${JSON.stringify(new URL("../plugins/plugin-base.ts", import.meta.url).href)};
    export default class SamplePlugin extends NovelForkPlugin {
      getManifest() { return { name: "sample-plugin", displayName: "Sample Plugin", version: "1.0.0", description: "test" }; }
      getTools() {
        return [{ definition: { name: "sample_tool", description: "test" }, handler: async () => ({ ok: true }) }];
      }
      getHooks() {
        return [{ stage: "before-write", handler: async (ctx) => { ctx.metadata.sample = true; } }];
      }
    }
  `, "utf-8");
  return root;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("plugin lifecycle", () => {
  it("exports plugin APIs from the package root", () => {
    class EmptyPlugin extends NovelForkPlugin {
      getManifest(): PluginManifest {
        return { name: "empty", displayName: "Empty", version: "1.0.0", description: "test" };
      }
    }

    expect(new EmptyPlugin()).toBeInstanceOf(NovelForkPlugin);
    expect(typeof PluginManager).toBe("function");
  });

  it("removes plugin tools and hooks when a plugin is deactivated", async () => {
    const pluginsDir = await createPluginDir();
    const toolRegistry = new ToolRegistry();
    const hookManager = new HookManager();
    const manager = new PluginManager({
      pluginsDir,
      dataDir: join(pluginsDir, "data"),
      toolRegistry,
      hookManager,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    });

    await manager.discover();
    await manager.loadAll();
    expect(toolRegistry.has("sample_tool")).toBe(true);
    expect(hookManager.getHookCount("before-write")).toBe(1);

    await manager.disablePlugin("sample-plugin");

    expect(toolRegistry.has("sample_tool")).toBe(false);
    expect(hookManager.getHookCount("before-write")).toBe(0);
  });
});
