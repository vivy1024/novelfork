import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_USERPROFILE = process.env.USERPROFILE;

async function seedRuntimeModel(modelId = "gpt-4-turbo") {
  const { ProviderRuntimeStore } = await import("./provider-runtime-store");
  const store = new ProviderRuntimeStore();
  await store.createProvider({
    id: "openai",
    name: "OpenAI",
    type: "openai",
    enabled: true,
    priority: 1,
    apiKeyRequired: true,
    compatibility: "openai-compatible",
    apiMode: "responses",
    config: { apiKey: "sk-test" },
    models: [{ id: modelId, name: modelId, contextWindow: 128000, maxOutputTokens: 8192, enabled: true, source: "detected" }],
  });
}

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

  it("uses empty model defaults when the runtime model pool is empty", async () => {
    const [{ DEFAULT_USER_CONFIG }, service] = await Promise.all([
      import("../../types/settings"),
      import("./user-config-service"),
    ]);

    const loaded = await service.loadUserConfig();

    expect(DEFAULT_USER_CONFIG.modelDefaults).toMatchObject({
      defaultSessionModel: "",
      summaryModel: "",
      subagentModelPool: [],
    });
    expect(loaded.modelDefaults.validation).toMatchObject({
      defaultSessionModel: "empty",
      summaryModel: "empty",
      invalidModelIds: [],
    });
  });

  it("keeps invalid saved models marked invalid instead of silently falling back", async () => {
    await seedRuntimeModel("gpt-4-turbo");
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
    expect(loaded.preferences.workbenchMode).toBe(false);
    expect(loaded.modelDefaults).toMatchObject({
      defaultSessionModel: "anthropic:not-a-model",
      summaryModel: "openai:also-missing",
      subagentModelPool: ["openai:gpt-4-turbo", "ghost:model", "bad-format"],
      validation: {
        defaultSessionModel: "invalid",
        summaryModel: "invalid",
        subagentModelPool: {
          "openai:gpt-4-turbo": "valid",
          "ghost:model": "invalid",
          "bad-format": "invalid",
        },
        invalidModelIds: ["anthropic:not-a-model", "openai:also-missing", "ghost:model", "bad-format"],
      },
    });
  });

  it("marks saved runtime models valid and persists sanitized runtime controls", async () => {
    await seedRuntimeModel("gpt-4-turbo");
    const [{ DEFAULT_USER_CONFIG }, service] = await Promise.all([
      import("../../types/settings"),
      import("./user-config-service"),
    ]);

    const configPath = service.getUserConfigPath();
    const updated = await service.updateUserConfig({
      runtimeControls: {
        defaultPermissionMode: "ask",
        contextCompressionThresholdPercent: 84,
      },
      modelDefaults: {
        defaultSessionModel: "openai:gpt-4-turbo",
        summaryModel: "openai:gpt-4-turbo",
        subagentModelPool: ["openai:gpt-4-turbo"],
      },
    });

    expect(updated.runtimeControls).toEqual({
      ...DEFAULT_USER_CONFIG.runtimeControls,
      defaultPermissionMode: "ask",
      contextCompressionThresholdPercent: 84,
    });
    expect(updated.modelDefaults.validation).toMatchObject({
      defaultSessionModel: "valid",
      summaryModel: "valid",
      subagentModelPool: { "openai:gpt-4-turbo": "valid" },
      invalidModelIds: [],
    });

    const persisted = JSON.parse(await readFile(configPath, "utf-8")) as { runtimeControls?: Record<string, unknown> };
    expect(persisted.runtimeControls).toMatchObject({
      defaultPermissionMode: "ask",
      defaultReasoningEffort: DEFAULT_USER_CONFIG.runtimeControls.defaultReasoningEffort,
      contextCompressionThresholdPercent: 84,
      contextTruncateTargetPercent: DEFAULT_USER_CONFIG.runtimeControls.contextTruncateTargetPercent,
    });
  });
});
