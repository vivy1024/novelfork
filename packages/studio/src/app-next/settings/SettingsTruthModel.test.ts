import { describe, expect, it } from "vitest";

import { PROXY_API_PATH, USER_SETTINGS_API_PATH } from "../backend-contract";
import * as SettingsTruthModelModule from "./SettingsTruthModel";
import { deriveAgentRuntimeSettingsFacts, deriveClaudeParitySettingsFacts, deriveModelSettingsFacts, settingsFactDisplayValue } from "./SettingsTruthModel";

const sampleConfig = {
  modelDefaults: {
    defaultSessionModel: "gpt-4o",
    summaryModel: "gpt-4o-mini",
    exploreSubagentModel: "gpt-4o-explore",
    planSubagentModel: "gpt-4o-plan",
    generalSubagentModel: "gpt-4o-general",
    codexReasoningEffort: "high",
    subagentModelPool: ["gpt-4o", "gpt-4o-mini"],
    validation: { defaultSessionModel: "valid", summaryModel: "valid", subagentModelPool: {}, invalidModelIds: [] },
  },
  runtimeControls: {
    defaultPermissionMode: "edit",
    defaultReasoningEffort: "medium",
    maxTurnSteps: 200,
    contextCompressionThresholdPercent: 80,
    contextTruncateTargetPercent: 70,
    largeWindowCompressionThresholdPercent: 60,
    largeWindowTruncateTargetPercent: 50,
    recovery: { maxRetryAttempts: 5, initialRetryDelayMs: 1000, maxRetryDelayMs: 30000, backoffMultiplier: 2 },
    toolAccess: { allowlist: ["Read"], blocklist: ["Bash"], mcpStrategy: "ask" },
    runtimeDebug: { tokenDebugEnabled: true, rateDebugEnabled: false, dumpEnabled: false },
    sendMode: "enter",
  },
  proxy: {
    webFetch: "http://127.0.0.1:7890",
  },
} as const;

describe("SettingsTruthModel", () => {
  it("derives visible model facts with source, status, writability and API provenance", () => {
    const facts = deriveModelSettingsFacts(sampleConfig);

    expect(facts.map((fact) => fact.id)).toEqual([
      "model.defaultSessionModel",
      "model.summaryModel",
      "model.exploreSubagentModel",
      "model.planSubagentModel",
      "model.generalSubagentModel",
      "model.codexReasoningEffort",
      "model.subagentModelPool",
      "runtime.defaultReasoningEffort",
    ]);
    for (const fact of facts) {
      expect(fact).toMatchObject({
        group: "models",
        source: "user-settings",
        status: "current",
        writable: true,
        readApi: USER_SETTINGS_API_PATH,
        writeApi: USER_SETTINGS_API_PATH,
        verifiedBy: "unit",
      });
      expect(settingsFactDisplayValue(fact)).not.toBe("—");
    }
  });

  it("marks missing user settings as unconfigured with a reason instead of a dash", () => {
    const facts = deriveModelSettingsFacts({ modelDefaults: { defaultSessionModel: "", summaryModel: "", exploreSubagentModel: "", planSubagentModel: "", subagentModelPool: [] }, runtimeControls: {} });

    expect(facts.every((fact) => fact.status === "unconfigured")).toBe(true);
    expect(facts.every((fact) => fact.reason)).toBe(true);
    expect(facts.every((fact) => settingsFactDisplayValue(fact) === "未配置")).toBe(true);
  });

  it("derives agent runtime facts from user settings, proxy config, and planned gaps", () => {
    const facts = deriveAgentRuntimeSettingsFacts(sampleConfig);

    expect(facts.map((fact) => fact.id)).toEqual([
      "runtime.defaultPermissionMode",
      "runtime.defaultReasoningEffort",
      "runtime.maxTurnSteps",
      "runtime.contextCompressionThresholdPercent",
      "runtime.contextTruncateTargetPercent",
      "runtime.largeWindowCompressionThresholdPercent",
      "runtime.largeWindowTruncateTargetPercent",
      "runtime.recovery.maxRetryAttempts",
      "runtime.recovery.initialRetryDelayMs",
      "runtime.recovery.maxRetryDelayMs",
      "runtime.recovery.backoffMultiplier",
      "runtime.firstTokenTimeoutMs",
      "runtime.codexApprovalPolicy",
      "runtime.codexSandboxMode",
      "runtime.codexReview",
      "runtime.codexImageInput",
      "runtime.proxy.webFetch",
      "runtime.toolAccess.mcpStrategy",
      "runtime.toolAccess.allowlist",
      "runtime.toolAccess.blocklist",
      "runtime.debug.tokenUsage",
      "runtime.debug.outputRate",
      "runtime.debug.dumpApiRequests",
      "runtime.sendMode",
    ]);
    expect(facts.find((fact) => fact.id === "runtime.firstTokenTimeoutMs")).toMatchObject({
      status: "planned",
      writable: false,
      source: "capability-matrix",
      reason: "NovelFork settings schema 尚无 first-token timeout 字段",
    });
    expect(facts.find((fact) => fact.id === "runtime.codexSandboxMode")).toMatchObject({
      status: "planned",
      value: "planned",
      writable: false,
      source: "capability-matrix",
      reason: expect.stringContaining("OS sandbox"),
    });
    expect(facts.find((fact) => fact.id === "runtime.codexApprovalPolicy")).toMatchObject({
      status: "partial",
      value: "permissionMode/toolPolicy",
      source: "capability-matrix",
      reason: expect.stringContaining("pending confirmation"),
    });
    expect(facts.find((fact) => fact.id === "runtime.codexReview")).toMatchObject({ status: "reference-only", writable: false });
    expect(facts.find((fact) => fact.id === "runtime.codexImageInput")).toMatchObject({ status: "reference-only", writable: false });
    expect(facts.find((fact) => fact.id === "runtime.proxy.webFetch")).toMatchObject({
      source: "user-settings",
      readApi: PROXY_API_PATH,
      writeApi: PROXY_API_PATH,
      status: "current",
      writable: true,
    });
    for (const fact of facts.filter((fact) => fact.status === "current")) {
      expect(fact.group).toBe("agent-runtime");
      expect(fact.readApi).toBeTruthy();
      expect(fact.writeApi).toBeTruthy();
      expect(settingsFactDisplayValue(fact)).not.toBe("—");
    }
  });

  it("derives Claude parity facts without advertising non-goals as current", () => {
    const facts = deriveClaudeParitySettingsFacts();

    expect(facts.map((fact) => fact.id)).toEqual([
      "parity.claude.slashRegistry",
      "parity.claude.permissions",
      "parity.claude.sessionResumeFork",
      "parity.claude.headlessUsage",
      "parity.claude.terminalTui",
      "parity.claude.chromeBridge",
    ]);
    expect(facts.find((fact) => fact.id === "parity.claude.terminalTui")).toMatchObject({
      group: "parity",
      source: "claude-source-reference",
      status: "unsupported",
      writable: false,
      value: "non-goal",
    });
    expect(facts.find((fact) => fact.id === "parity.claude.chromeBridge")).toMatchObject({
      status: "unsupported",
      reason: expect.stringContaining("non-goal"),
    });
    expect(facts.find((fact) => fact.id === "parity.claude.slashRegistry")).toMatchObject({
      status: "partial",
      reason: expect.stringContaining("静态 7 个"),
    });
    expect(facts.find((fact) => fact.id === "parity.claude.permissions")).toMatchObject({
      status: "partial",
      reason: expect.stringContaining("classifier/auto mode"),
    });
    expect(facts.find((fact) => fact.id === "parity.claude.sessionResumeFork")).toMatchObject({
      status: "partial",
      reason: expect.stringContaining("parentUuid"),
    });
    expect(facts.find((fact) => fact.id === "parity.claude.headlessUsage")).toMatchObject({
      status: "partial",
      reason: expect.stringContaining("usage envelope"),
    });
  });

  it("derives Codex parity facts from matrix-backed sources without claiming sandbox as current", () => {
    const deriveCodexParitySettingsFacts = (SettingsTruthModelModule as {
      deriveCodexParitySettingsFacts?: () => ReturnType<typeof deriveClaudeParitySettingsFacts>;
    }).deriveCodexParitySettingsFacts;
    const facts = deriveCodexParitySettingsFacts?.() ?? [];

    expect(facts.map((fact) => fact.id)).toEqual([
      "parity.codex.tui",
      "parity.codex.exec",
      "parity.codex.execEventTaxonomy",
      "parity.codex.sandbox",
      "parity.codex.approval",
      "parity.codex.mcp",
      "parity.codex.subagents",
      "parity.codex.webSearch",
      "parity.codex.imageInput",
      "parity.codex.review",
      "parity.codex.windowsNative",
    ]);
    expect(facts.find((fact) => fact.id === "parity.codex.execEventTaxonomy")).toMatchObject({
      status: "reference-only",
      value: "reference-only",
      reason: expect.stringContaining("不是 Codex exec 完整 JSONL event schema"),
    });
    expect(facts.find((fact) => fact.id === "parity.codex.sandbox")).toMatchObject({
      group: "parity",
      source: "capability-matrix",
      status: "planned",
      writable: false,
      value: "planned",
      reason: expect.stringContaining("OS sandbox"),
    });
    expect(facts.find((fact) => fact.id === "parity.codex.approval")).toMatchObject({
      source: "capability-matrix",
      status: "partial",
      writable: false,
      reason: expect.stringContaining("permissionMode/toolPolicy"),
    });
    expect(facts.find((fact) => fact.id === "parity.codex.windowsNative")).toMatchObject({
      status: "partial",
      reason: expect.stringContaining("Windows 原生"),
    });
    expect(facts.every((fact) => fact.source === "capability-matrix" || fact.source === "official-docs" || fact.source === "user-settings")).toBe(true);
    expect(facts.every((fact) => !(fact.id.includes("sandbox") && fact.status === "current"))).toBe(true);
  });

  it("RED: derives provider fixture cleanup facts instead of treating E2E providers as normal current data", () => {
    const deriveProviderFixtureFacts = (SettingsTruthModelModule as {
      deriveProviderFixtureFacts?: (input: {
        readonly cleanRoot: boolean;
        readonly providers: readonly { readonly id: string; readonly name: string; readonly models?: readonly { readonly id: string; readonly name: string }[] }[];
      }) => Array<{ id: string; group: string; source: string; status: string; writable: boolean; reason?: string }>;
    }).deriveProviderFixtureFacts;

    expect(deriveProviderFixtureFacts).toBeTypeOf("function");
    const facts = deriveProviderFixtureFacts?.({
      cleanRoot: false,
      providers: [{ id: "e2e-provider-task11", name: "E2E Provider Task11", models: [{ id: "e2e-model-a", name: "E2E Model A" }] }],
    }) ?? [];

    expect(facts).toContainEqual(expect.objectContaining({
      id: "provider-fixture.e2e-provider-task11",
      group: "providers",
      source: "provider-summary",
      status: "partial",
      writable: false,
      reason: expect.stringContaining("测试夹具"),
    }));
  });
});
