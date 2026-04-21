import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_USERPROFILE = process.env.USERPROFILE;

describe("user-config-service", () => {
  let homeDir: string;

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "novelfork-user-config-"));
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
    vi.resetModules();
  });

  afterEach(async () => {
    process.env.HOME = ORIGINAL_HOME;
    process.env.USERPROFILE = ORIGINAL_USERPROFILE;
    await rm(homeDir, { recursive: true, force: true });
  });

  it("hydrates runtime control defaults for legacy config files and deep-merges runtime updates", async () => {
    const [{ DEFAULT_USER_CONFIG }, service] = await Promise.all([
      import("../../types/settings"),
      import("./user-config-service"),
    ]);

    const configPath = service.getUserConfigPath();
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      JSON.stringify({
        profile: { name: "旧配置用户" },
        preferences: { theme: "dark", fontSize: 16 },
        shortcuts: {},
        recentWorkspaces: [],
      }, null, 2),
      "utf-8",
    );

    const loaded = await service.loadUserConfig();
    expect(loaded.runtimeControls).toEqual(DEFAULT_USER_CONFIG.runtimeControls);

    const updated = await service.updateUserConfig({
      runtimeControls: {
        defaultPermissionMode: "ask",
        contextCompressionThresholdPercent: 84,
      },
    });

    expect(updated.runtimeControls).toEqual({
      ...DEFAULT_USER_CONFIG.runtimeControls,
      defaultPermissionMode: "ask",
      contextCompressionThresholdPercent: 84,
    });

    const persisted = JSON.parse(await readFile(configPath, "utf-8")) as {
      runtimeControls?: Record<string, unknown>;
    };

    expect(persisted.runtimeControls).toMatchObject({
      defaultPermissionMode: "ask",
      defaultReasoningEffort: DEFAULT_USER_CONFIG.runtimeControls.defaultReasoningEffort,
      contextCompressionThresholdPercent: 84,
      contextTruncateTargetPercent: DEFAULT_USER_CONFIG.runtimeControls.contextTruncateTargetPercent,
    });

    const sanitized = await service.updateUserConfig({
      runtimeControls: {
        contextCompressionThresholdPercent: null as unknown as number,
        contextTruncateTargetPercent: 999,
      },
    });

    expect(sanitized.runtimeControls.contextCompressionThresholdPercent).toBe(
      DEFAULT_USER_CONFIG.runtimeControls.contextCompressionThresholdPercent,
    );
    expect(sanitized.runtimeControls.contextTruncateTargetPercent).toBe(90);
  });
});
