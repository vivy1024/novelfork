import { beforeEach, describe, expect, it, vi } from "vitest";

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
        }),
        expect.objectContaining({
          name: "Write",
          access: "deny",
          enabled: false,
          requiresConfirmation: false,
          reason: "Tool is not in runtimeControls.toolAccess.allowlist",
        }),
      ]),
    );
  });

  it("keeps builtin prompt tools visible when the runtime fallback allows tools", async () => {
    const app = createToolsRouter();
    const response = await app.request("http://localhost/list");
    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Write",
          access: "prompt",
          enabled: true,
          requiresConfirmation: true,
        }),
        expect.objectContaining({
          name: "Edit",
          access: "prompt",
          enabled: true,
          requiresConfirmation: true,
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
      confirmationRequired: true,
      error: "Tool falls back to defaultPermissionMode=ask",
    });
  });
});
