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
        modelDefaults: {
          defaultSessionModel: "anthropic:not-a-model",
          summaryModel: "openai:also-missing",
          subagentModelPool: ["openai:gpt-4-turbo", "ghost:model", "bad-format"],
        },
        shortcuts: {},
        recentWorkspaces: [],
      }, null, 2),
      "utf-8",
    );

    const loaded = await service.loadUserConfig();
    expect(loaded.runtimeControls).toEqual(DEFAULT_USER_CONFIG.runtimeControls);
    expect(loaded.modelDefaults).toEqual({
      defaultSessionModel: DEFAULT_USER_CONFIG.modelDefaults.defaultSessionModel,
      summaryModel: DEFAULT_USER_CONFIG.modelDefaults.summaryModel,
      subagentModelPool: ["openai:gpt-4-turbo"],
    });

    const updated = await service.updateUserConfig({
      runtimeControls: {
        defaultPermissionMode: "ask",
        contextCompressionThresholdPercent: 84,
        recovery: {
          ...DEFAULT_USER_CONFIG.runtimeControls.recovery,
          maxRecoveryAttempts: 6,
          backoffMultiplier: 1.5,
        },
        toolAccess: {
          ...DEFAULT_USER_CONFIG.runtimeControls.toolAccess,
          allowlist: ["Read", "Write"],
          blocklist: ["Delete"],
          mcpStrategy: "ask",
        },
        runtimeDebug: {
          ...DEFAULT_USER_CONFIG.runtimeControls.runtimeDebug,
          tokenDebugEnabled: true,
          traceEnabled: true,
          traceSampleRatePercent: 40,
        },
      },
    });

    expect(updated.runtimeControls).toEqual({
      ...DEFAULT_USER_CONFIG.runtimeControls,
      defaultPermissionMode: "ask",
      contextCompressionThresholdPercent: 84,
      recovery: {
        ...DEFAULT_USER_CONFIG.runtimeControls.recovery,
        maxRecoveryAttempts: 6,
        backoffMultiplier: 1.5,
      },
      toolAccess: {
        allowlist: ["Read", "Write"],
        blocklist: ["Delete"],
        mcpStrategy: "ask",
      },
      runtimeDebug: {
        ...DEFAULT_USER_CONFIG.runtimeControls.runtimeDebug,
        tokenDebugEnabled: true,
        traceEnabled: true,
        traceSampleRatePercent: 40,
      },
    });

    const persisted = JSON.parse(await readFile(configPath, "utf-8")) as {
      runtimeControls?: Record<string, unknown>;
    };

    expect(persisted.runtimeControls).toMatchObject({
      defaultPermissionMode: "ask",
      defaultReasoningEffort: DEFAULT_USER_CONFIG.runtimeControls.defaultReasoningEffort,
      contextCompressionThresholdPercent: 84,
      contextTruncateTargetPercent: DEFAULT_USER_CONFIG.runtimeControls.contextTruncateTargetPercent,
      recovery: {
        resumeOnStartup: DEFAULT_USER_CONFIG.runtimeControls.recovery.resumeOnStartup,
        maxRecoveryAttempts: 6,
        maxRetryAttempts: DEFAULT_USER_CONFIG.runtimeControls.recovery.maxRetryAttempts,
        initialRetryDelayMs: DEFAULT_USER_CONFIG.runtimeControls.recovery.initialRetryDelayMs,
        maxRetryDelayMs: DEFAULT_USER_CONFIG.runtimeControls.recovery.maxRetryDelayMs,
        backoffMultiplier: 1.5,
        jitterPercent: DEFAULT_USER_CONFIG.runtimeControls.recovery.jitterPercent,
      },
      toolAccess: {
        allowlist: ["Read", "Write"],
        blocklist: ["Delete"],
        mcpStrategy: "ask",
      },
      runtimeDebug: {
        tokenDebugEnabled: true,
        rateDebugEnabled: DEFAULT_USER_CONFIG.runtimeControls.runtimeDebug.rateDebugEnabled,
        dumpEnabled: DEFAULT_USER_CONFIG.runtimeControls.runtimeDebug.dumpEnabled,
        traceEnabled: true,
        traceSampleRatePercent: 40,
      },
    });

    const sanitized = await service.updateUserConfig({
      runtimeControls: {
        recovery: {
          ...DEFAULT_USER_CONFIG.runtimeControls.recovery,
          maxRetryAttempts: 999,
          initialRetryDelayMs: -1,
        },
        toolAccess: {
          ...DEFAULT_USER_CONFIG.runtimeControls.toolAccess,
          allowlist: ["  Read ", "", "Write"],
          blocklist: ["  Delete  "],
          mcpStrategy: "unknown" as never,
        },
        runtimeDebug: {
          ...DEFAULT_USER_CONFIG.runtimeControls.runtimeDebug,
          traceSampleRatePercent: 999,
        },
      },
    });

    expect(sanitized.runtimeControls.recovery.maxRetryAttempts).toBe(20);
    expect(sanitized.runtimeControls.recovery.initialRetryDelayMs).toBe(0);
    expect(sanitized.runtimeControls.toolAccess.allowlist).toEqual(["Read", "Write"]);
    expect(sanitized.runtimeControls.toolAccess.blocklist).toEqual(["Delete"]);
    expect(sanitized.runtimeControls.toolAccess.mcpStrategy).toBe("inherit");
    expect(sanitized.runtimeControls.runtimeDebug.traceSampleRatePercent).toBe(100);
  });
});
