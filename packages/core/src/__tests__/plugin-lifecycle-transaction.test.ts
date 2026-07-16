import { appendFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HookManager } from "../hooks/hook-manager.js";
import { PluginManager, ToolRegistry } from "../index.js";
import type { PluginManagerLifecycleListener } from "../plugins/plugin-lifecycle.js";

const tempDirs: string[] = [];

type PluginFixture = { root: string; eventFile: string };

async function readEvents(eventFile: string): Promise<string[]> {
  const content = await readFile(eventFile, "utf8").catch(() => "");
  return content.split("\n").filter(Boolean);
}

function record(eventFile: string, event: string): void {
  appendFileSync(eventFile, `${event}\n`, "utf8");
}

function listenerFor(eventFile: string, options: { failProjection?: boolean; failHide?: boolean } = {}): PluginManagerLifecycleListener {
  return {
    async onActivationPrepared() {
      record(eventFile, "host.register");
      if (options.failProjection) throw new Error("host conflict");
    },
    async onDeactivating() {
      record(eventFile, "host.unregister");
      if (options.failHide) throw new Error("host hide failed");
    },
    async onDeactivated() {
      record(eventFile, "host.terminated");
    },
  };
}

async function createPluginDir(options: { toolName?: string; failDeactivateOnce?: boolean } = {}): Promise<PluginFixture> {
  const root = await mkdtemp(join(tmpdir(), "novelfork-plugin-transaction-"));
  tempDirs.push(root);
  const pluginDir = join(root, "sample-plugin");
  const eventFile = join(root, "events.log");
  await mkdir(pluginDir, { recursive: true });
  await writeFile(join(pluginDir, "manifest.json"), JSON.stringify({
    id: "sample-plugin",
    name: "sample-plugin",
    displayName: "Sample Plugin",
    version: "1.0.0",
    description: "test",
    projectType: "general",
  }), "utf8");
  await writeFile(join(pluginDir, "index.js"), `
    import { appendFileSync } from "node:fs";
    import { NovelForkPlugin } from ${JSON.stringify(new URL("../plugins/plugin-base.ts", import.meta.url).href)};
    const eventFile = ${JSON.stringify(eventFile)};
    let failDeactivate = ${Boolean(options.failDeactivateOnce)};
    const record = (event) => appendFileSync(eventFile, event + "\\n", "utf8");
    export default class SamplePlugin extends NovelForkPlugin {
      getManifest() { return { name: "sample-plugin", displayName: "Sample Plugin", version: "1.0.0", description: "test" }; }
      async activate() { record("plugin.activate"); }
      async deactivate() {
        record("plugin.deactivate");
        if (failDeactivate) {
          failDeactivate = false;
          throw new Error("deactivate failed");
        }
      }
      getTools() {
        record("plugin.getTools");
        return [{ definition: { name: ${JSON.stringify(options.toolName ?? "sample_tool")}, description: "test" }, handler: async () => ({ ok: true }) }];
      }
      getHooks() {
        record("plugin.getHooks");
        return [{ stage: "before-write", handler: async () => undefined }];
      }
    }
  `, "utf8");
  return { root, eventFile };
}

function createManager(
  pluginsDir: string,
  listener?: PluginManagerLifecycleListener,
  toolRegistry = new ToolRegistry(),
  hookManager = new HookManager(),
) {
  return {
    manager: new PluginManager({
      pluginsDir,
      dataDir: join(pluginsDir, "data"),
      toolRegistry,
      hookManager,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
      lifecycleListener: listener,
    }),
    toolRegistry,
    hookManager,
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("PluginManager lifecycle transaction", () => {
  it("commits activation only after plugin, core registration, and projection succeed", async () => {
    const fixture = await createPluginDir();
    const { manager, toolRegistry, hookManager } = createManager(fixture.root, listenerFor(fixture.eventFile));
    await manager.discover();
    await manager.loadAll();

    expect(await readEvents(fixture.eventFile)).toEqual([
      "plugin.activate", "plugin.getTools", "plugin.getHooks", "host.register",
    ]);
    expect(manager.getPlugin("sample-plugin")?.state).toBe("active");
    expect(toolRegistry.has("sample_tool")).toBe(true);
    expect(hookManager.getHookCount("before-write")).toBe(1);
  });

  it("compensates host, core registrations, and plugin when projection fails", async () => {
    const fixture = await createPluginDir();
    const { manager, toolRegistry, hookManager } = createManager(fixture.root, listenerFor(fixture.eventFile, { failProjection: true }));
    await manager.discover();
    await expect(manager.loadAll()).resolves.toBeUndefined();

    expect(await readEvents(fixture.eventFile)).toEqual([
      "plugin.activate", "plugin.getTools", "plugin.getHooks", "host.register", "host.unregister", "plugin.deactivate",
    ]);
    expect(manager.getPlugin("sample-plugin")).toMatchObject({ state: "initialized", toolsCount: 0, hooksCount: 0 });
    expect(toolRegistry.has("sample_tool")).toBe(false);
    expect(hookManager.getHookCount("before-write")).toBe(0);
  });

  it("compensates partial core registration when a tool conflicts", async () => {
    const fixture = await createPluginDir({ toolName: "conflicting_tool" });
    const toolRegistry = new ToolRegistry();
    toolRegistry.register({ name: "conflicting_tool", description: "existing", handler: async () => "existing" });
    const { manager, hookManager } = createManager(fixture.root, listenerFor(fixture.eventFile), toolRegistry);
    await manager.discover();
    await expect(manager.loadAll()).resolves.toBeUndefined();

    expect(await readEvents(fixture.eventFile)).toEqual(["plugin.activate", "plugin.getTools", "plugin.deactivate"]);
    expect(manager.getPlugin("sample-plugin")?.state).toBe("initialized");
    expect(toolRegistry.has("conflicting_tool")).toBe(true);
    expect(hookManager.getHookCount("before-write")).toBe(0);
  });

  it("hides host before core cleanup and plugin deactivation", async () => {
    const fixture = await createPluginDir();
    const { manager, toolRegistry, hookManager } = createManager(fixture.root, listenerFor(fixture.eventFile));
    await manager.discover();
    await manager.loadAll();
    await readEvents(fixture.eventFile);
    await writeFile(fixture.eventFile, "", "utf8");

    await manager.disablePlugin("sample-plugin");

    expect(await readEvents(fixture.eventFile)).toEqual(["host.unregister", "plugin.deactivate", "host.terminated"]);
    expect(manager.getPlugin("sample-plugin")?.state).toBe("terminated");
    expect(manager.getPlugin("sample-plugin")?.enabled).toBe(false);
    expect(toolRegistry.has("sample_tool")).toBe(false);
    expect(hookManager.getHookCount("before-write")).toBe(0);
  });

  it("keeps host hidden and retries cleanup after deactivation failure", async () => {
    const fixture = await createPluginDir({ failDeactivateOnce: true });
    const { manager, toolRegistry, hookManager } = createManager(fixture.root, listenerFor(fixture.eventFile));
    await manager.discover();
    await manager.loadAll();
    await writeFile(fixture.eventFile, "", "utf8");

    await expect(manager.disablePlugin("sample-plugin")).rejects.toThrow("deactivate failed");
    expect(manager.getPlugin("sample-plugin")).toMatchObject({ state: "deactivation-error", enabled: false });
    expect(toolRegistry.has("sample_tool")).toBe(false);
    expect(hookManager.getHookCount("before-write")).toBe(0);
    expect(await readEvents(fixture.eventFile)).toEqual(["host.unregister", "plugin.deactivate"]);

    await writeFile(fixture.eventFile, "", "utf8");
    await manager.disablePlugin("sample-plugin");
    expect(manager.getPlugin("sample-plugin")?.state).toBe("terminated");
    expect(await readEvents(fixture.eventFile)).toEqual(["host.unregister", "plugin.deactivate", "host.terminated"]);
  });

  it("does not clean core or plugin when hiding the host fails", async () => {
    const fixture = await createPluginDir();
    const { manager, toolRegistry, hookManager } = createManager(fixture.root, listenerFor(fixture.eventFile, { failHide: true }));
    await manager.discover();
    await manager.loadAll();
    await writeFile(fixture.eventFile, "", "utf8");

    await expect(manager.disablePlugin("sample-plugin")).rejects.toThrow("host hide failed");
    expect(manager.getPlugin("sample-plugin")).toMatchObject({ state: "active", enabled: true });
    expect(toolRegistry.has("sample_tool")).toBe(true);
    expect(hookManager.getHookCount("before-write")).toBe(1);
    expect(await readEvents(fixture.eventFile)).toEqual(["host.unregister"]);
  });
});
