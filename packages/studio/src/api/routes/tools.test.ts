import { beforeEach, describe, expect, it, vi } from "vitest";

import { RunStore } from "../lib/run-store.js";

const userConfigState = {
  runtimeControls: {
    defaultPermissionMode: "allow",
    defaultReasoningEffort: "medium",
    contextCompressionThresholdPercent: 80,
    contextTruncateTargetPercent: 70,
    recovery: {
      resumeOnStartup: true,
      maxRecoveryAttempts: 3,
      maxRetryAttempts: 5,
      initialRetryDelayMs: 1000,
      maxRetryDelayMs: 30000,
      backoffMultiplier: 2,
      jitterPercent: 20,
    },
    toolAccess: {
      allowlist: [] as string[],
      blocklist: [] as string[],
      mcpStrategy: "inherit" as const,
    },
    runtimeDebug: {
      tokenDebugEnabled: false,
      rateDebugEnabled: false,
      dumpEnabled: false,
      traceEnabled: false,
      traceSampleRatePercent: 0,
    },
  },
};

vi.mock("../lib/user-config-service.js", () => ({
  loadUserConfig: vi.fn(async () => userConfigState),
}));

import { createToolsRouter } from "./tools";

describe("createToolsRouter", () => {
  beforeEach(() => {
    userConfigState.runtimeControls.defaultPermissionMode = "allow";
    userConfigState.runtimeControls.toolAccess.allowlist = [];
    userConfigState.runtimeControls.toolAccess.blocklist = [];
    userConfigState.runtimeControls.toolAccess.mcpStrategy = "inherit";
    userConfigState.runtimeControls.recovery.maxRetryAttempts = 5;
    userConfigState.runtimeControls.recovery.initialRetryDelayMs = 1000;
    userConfigState.runtimeControls.recovery.maxRetryDelayMs = 30000;
    userConfigState.runtimeControls.recovery.backoffMultiplier = 2;
    userConfigState.runtimeControls.recovery.jitterPercent = 20;
    userConfigState.runtimeControls.runtimeDebug.dumpEnabled = false;
    userConfigState.runtimeControls.runtimeDebug.traceEnabled = false;
    userConfigState.runtimeControls.runtimeDebug.traceSampleRatePercent = 0;
  });

  it("exposes runtime tool access decisions in the tool registry", async () => {
    userConfigState.runtimeControls.defaultPermissionMode = "ask";
    userConfigState.runtimeControls.toolAccess.allowlist = ["Read"];
    userConfigState.runtimeControls.toolAccess.blocklist = ["Edit"];

    const app = createToolsRouter();
    const response = await app.request("http://localhost/list");
    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Read",
          access: "allow",
          enabled: true,
          requiresConfirmation: false,
        }),
        expect.objectContaining({
          name: "Edit",
          access: "deny",
          enabled: false,
          requiresConfirmation: false,
          reason: "Tool is blocked by runtimeControls.toolAccess.blocklist",
          source: "runtimeControls.toolAccess.blocklist",
          reasonKey: "blocklist-deny",
        }),
        expect.objectContaining({
          name: "Write",
          access: "deny",
          enabled: false,
          requiresConfirmation: false,
          reason: "Tool is not in runtimeControls.toolAccess.allowlist",
          source: "runtimeControls.toolAccess.allowlist",
          reasonKey: "allowlist-deny",
        }),
      ]),
    );
  });

  it("marks write tools as directly available in the productized all-allow mode", async () => {
    const app = createToolsRouter();
    const response = await app.request("http://localhost/list");
    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Write",
          access: "allow",
          enabled: true,
          requiresConfirmation: false,
          reasonKey: "default-allow",
        }),
        expect.objectContaining({
          name: "Edit",
          access: "allow",
          enabled: true,
          requiresConfirmation: false,
          reasonKey: "default-allow",
        }),
      ]),
    );
  });

  it("executes allowlisted tools", async () => {
    userConfigState.runtimeControls.toolAccess.allowlist = ["Read"];

    const app = createToolsRouter();
    const response = await app.request("http://localhost/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toolName: "Read",
        params: {
          file_path: "package.json",
        },
      }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(payload.result.data).toContain('"name": "@vivy1024/novelfork-studio"');
  });

  it("blocks tools on the runtime blocklist even if they are allowlisted", async () => {
    userConfigState.runtimeControls.toolAccess.allowlist = ["Read"];
    userConfigState.runtimeControls.toolAccess.blocklist = ["Read"];

    const app = createToolsRouter();
    const response = await app.request("http://localhost/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toolName: "Read",
        params: {
          file_path: "package.json",
        },
      }),
    });

    expect(response.status).toBe(403);
    const payload = await response.json();
    expect(payload).toMatchObject({
      success: false,
      error: "Tool is blocked by runtimeControls.toolAccess.blocklist",
    });
  });

  it("returns confirmationRequired when the permission chain resolves to prompt", async () => {
    userConfigState.runtimeControls.defaultPermissionMode = "ask";

    const app = createToolsRouter();
    const response = await app.request("http://localhost/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toolName: "Bash",
        params: {
          command: "printf 'ok'",
        },
      }),
    });

    expect(response.status).toBe(403);
    const payload = await response.json();
    expect(payload).toMatchObject({
      success: false,
      allowed: false,
      confirmationRequired: true,
      source: "runtimeControls.defaultPermissionMode",
      reasonKey: "default-prompt",
      error: "Tool falls back to defaultPermissionMode=ask",
    });
  });

  it("returns a unified permission decision envelope for successful tool registry reads", async () => {
    userConfigState.runtimeControls.toolAccess.allowlist = ["Read"];

    const app = createToolsRouter();
    const response = await app.request("http://localhost/list");
    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Read",
          access: "allow",
          source: "runtimeControls.toolAccess.allowlist",
          reasonKey: "allowlist-allow",
        }),
      ]),
    );
  });

  it("retries tool execution with runtime recovery settings and records execution metadata", async () => {
    userConfigState.runtimeControls.toolAccess.allowlist = ["Read"];
    userConfigState.runtimeControls.recovery.maxRetryAttempts = 2;
    userConfigState.runtimeControls.recovery.initialRetryDelayMs = 0;
    userConfigState.runtimeControls.recovery.maxRetryDelayMs = 0;
    userConfigState.runtimeControls.recovery.jitterPercent = 0;
    userConfigState.runtimeControls.runtimeDebug.dumpEnabled = true;
    userConfigState.runtimeControls.runtimeDebug.traceEnabled = true;
    userConfigState.runtimeControls.runtimeDebug.traceSampleRatePercent = 100;

    const executeMock = vi
      .fn()
      .mockResolvedValueOnce({ success: false, error: "temporary failure" })
      .mockResolvedValueOnce({ success: true, data: "ok" });
    const runStore = new RunStore();
    const app = createToolsRouter({
      runStore,
      sleep: vi.fn(async () => undefined),
      random: () => 0,
      executor: {
        register: vi.fn(),
        listTools: vi.fn(() => []),
        execute: executeMock,
      } as never,
    });

    const response = await app.request("http://localhost/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toolName: "Read",
        params: { file_path: "package.json" },
      }),
    });

    expect(response.status).toBe(200);
    expect(executeMock).toHaveBeenCalledTimes(2);
    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(payload.execution).toMatchObject({
      attempts: 2,
      traceEnabled: true,
      dumpEnabled: true,
    });
    expect(payload.execution.runId).toEqual(expect.any(String));

    const run = runStore.get(payload.execution.runId);
    expect(run?.status).toBe("succeeded");
    expect(run?.logs.some((entry) => entry.message.includes("Attempt 1 failed"))).toBe(true);
  });

  it("builds a source preview for file-oriented tool calls", async () => {
    const app = createToolsRouter();
    const response = await app.request("http://localhost/source-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toolName: "Read",
        params: { file_path: "package.json" },
      }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      target: "package.json",
      locator: "package.json:1-5",
    });
    expect(payload.snippet).toContain('"name": "@vivy1024/novelfork-studio"');
    expect(payload.requestPreview).toContain('"file_path": "package.json"');
  });

  it("builds a precise source preview from line-oriented locator params", async () => {
    const app = createToolsRouter();
    const response = await app.request("http://localhost/source-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toolName: "Read",
        params: { file_path: "package.json", offset: 1, limit: 2 },
      }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      target: "package.json",
      locator: "package.json:2-3",
      line: 2,
    });
    expect(payload.snippet).toContain('"name": "@vivy1024/novelfork-studio"');
    expect(payload.snippet).toContain('"version": "0.0.1"');
    expect(payload.snippet).not.toContain('"description": "NovelFork Studio');
  });

  it("opens the inferred source target in the editor", async () => {
    const openInEditor = vi.fn(async () => ({ command: "code", target: "package.json", line: 4 }));
    const app = createToolsRouter({ openInEditor });
    const response = await app.request("http://localhost/open-in-editor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toolName: "Read",
        params: { file_path: "package.json", lineno: 4 },
      }),
    });

    expect(response.status).toBe(200);
    expect(openInEditor).toHaveBeenCalledWith(expect.objectContaining({
      target: "package.json",
      line: 4,
    }));
    const payload = await response.json();
    expect(payload).toMatchObject({
      success: true,
      target: "package.json",
      line: 4,
      command: "code",
    });
  });
});
