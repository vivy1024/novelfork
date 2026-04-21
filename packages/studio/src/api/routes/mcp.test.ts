import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const mockDiscoveredTools: Array<{ name: string; description?: string }> = [];

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
      mcpStrategy: "inherit" as "inherit" | "allow" | "ask" | "deny",
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

vi.mock("@vivy1024/novelfork-core", () => ({
  MCPClientImpl: class MockMCPClientImpl {
    state: "disconnected" | "connected" = "disconnected";
    tools: Array<{ name: string; description?: string }> = [];

    constructor(public readonly config: Record<string, unknown>) {
      void config;
    }

    async connect() {
      this.state = "connected";
      this.tools = mockDiscoveredTools.map((tool) => ({ ...tool }));
    }

    async disconnect() {
      this.state = "disconnected";
      this.tools = [];
    }

    async callTool({ name, arguments: args }: { name: string; arguments?: Record<string, unknown> }) {
      return {
        content: [
          {
            type: "text",
            text: `called:${name}`,
          },
        ],
        structuredContent: args ?? {},
      };
    }
  },
}));

import { createMCPRouter, resetMCPRuntime } from "./mcp";

describe("createMCPRouter", () => {
  let root: string;

  beforeEach(async () => {
    resetMCPRuntime();
    mockDiscoveredTools.splice(0, mockDiscoveredTools.length);
    userConfigState.runtimeControls.defaultPermissionMode = "allow";
    userConfigState.runtimeControls.toolAccess.allowlist = [];
    userConfigState.runtimeControls.toolAccess.blocklist = [];
    userConfigState.runtimeControls.toolAccess.mcpStrategy = "inherit";

    root = await mkdtemp(join(tmpdir(), "novelfork-mcp-route-"));
    await writeFile(
      join(root, "novelfork.json"),
      JSON.stringify(
        {
          mcpServers: [
            {
              id: "stdio-server",
              name: "Filesystem",
              transport: "stdio",
              command: "npx",
              args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
            },
            {
              id: "sse-server",
              name: "Remote Search",
              transport: "sse",
              url: "http://localhost:3030/sse",
            },
          ],
        },
        null,
        2,
      ),
      "utf-8",
    );
  });

  afterEach(async () => {
    resetMCPRuntime();
    await rm(root, { recursive: true, force: true });
  });

  it("returns registry summary with transport, connection status, and tool counts", async () => {
    const app = createMCPRouter(root);

    const response = await app.request("http://localhost/api/mcp/registry");
    expect(response.status).toBe(200);
    const payload = await response.json();

    expect(payload.summary).toEqual({
      totalServers: 2,
      connectedServers: 0,
      enabledTools: 0,
      discoveredTools: 0,
    });
    expect(payload.servers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "stdio-server",
          name: "Filesystem",
          transport: "stdio",
          status: "disconnected",
          toolCount: 0,
        }),
        expect.objectContaining({
          id: "sse-server",
          name: "Remote Search",
          transport: "sse",
          status: "disconnected",
          toolCount: 0,
        }),
      ]),
    );
  });

  it("updates an existing MCP server config", async () => {
    const app = createMCPRouter(root);

    const updateResponse = await app.request("http://localhost/api/mcp/servers/sse-server", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Remote Search 2",
        url: "http://localhost:4040/sse",
        env: { TOKEN: "demo-token" },
      }),
    });

    expect(updateResponse.status).toBe(200);

    const registryResponse = await app.request("http://localhost/api/mcp/registry");
    const payload = await registryResponse.json();
    expect(payload.servers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "sse-server",
          name: "Remote Search 2",
          url: "http://localhost:4040/sse",
          env: { TOKEN: "demo-token" },
        }),
      ]),
    );
  });

  it("removes denied MCP tools from enabled registry counts", async () => {
    userConfigState.runtimeControls.toolAccess.mcpStrategy = "deny";
    mockDiscoveredTools.push(
      { name: "searchDocs", description: "Search project docs" },
      { name: "deleteDocs", description: "Delete docs" },
    );

    const app = createMCPRouter(root);
    const startResponse = await app.request("http://localhost/api/mcp/servers/stdio-server/start", {
      method: "POST",
    });
    expect(startResponse.status).toBe(200);

    const registryResponse = await app.request("http://localhost/api/mcp/registry");
    expect(registryResponse.status).toBe(200);
    const payload = await registryResponse.json();

    expect(payload.summary).toMatchObject({
      connectedServers: 1,
      discoveredTools: 2,
      enabledTools: 0,
    });
    expect(payload.servers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "stdio-server",
          enabledToolCount: 0,
          tools: expect.arrayContaining([
            expect.objectContaining({
              name: "searchDocs",
              access: "deny",
              enabled: false,
              reason: "MCP tool is blocked by runtimeControls.toolAccess.mcpStrategy=deny",
            }),
          ]),
        }),
      ]),
    );
  });

  it("enforces allowlist, blocklist, and ask strategy when calling MCP tools", async () => {
    mockDiscoveredTools.push(
      { name: "searchDocs", description: "Search project docs" },
      { name: "deleteDocs", description: "Delete docs" },
    );

    const app = createMCPRouter(root);
    const startResponse = await app.request("http://localhost/api/mcp/servers/stdio-server/start", {
      method: "POST",
    });
    expect(startResponse.status).toBe(200);

    userConfigState.runtimeControls.toolAccess.mcpStrategy = "allow";
    userConfigState.runtimeControls.toolAccess.allowlist = ["searchDocs"];
    userConfigState.runtimeControls.toolAccess.blocklist = ["deleteDocs"];

    const allowedResponse = await app.request("http://localhost/api/mcp/servers/stdio-server/call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tool: "searchDocs",
        arguments: { query: "修仙" },
      }),
    });
    expect(allowedResponse.status).toBe(200);
    expect(await allowedResponse.json()).toMatchObject({
      content: [expect.objectContaining({ text: "called:searchDocs" })],
      structuredContent: { query: "修仙" },
    });

    const blockedResponse = await app.request("http://localhost/api/mcp/servers/stdio-server/call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tool: "deleteDocs",
      }),
    });
    expect(blockedResponse.status).toBe(403);
    expect(await blockedResponse.json()).toMatchObject({
      error: "MCP tool is blocked by runtimeControls.toolAccess.blocklist",
    });

    userConfigState.runtimeControls.toolAccess.blocklist = [];
    userConfigState.runtimeControls.toolAccess.mcpStrategy = "ask";

    const confirmResponse = await app.request("http://localhost/api/mcp/servers/stdio-server/call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tool: "searchDocs",
      }),
    });
    expect(confirmResponse.status).toBe(403);
    expect(await confirmResponse.json()).toMatchObject({
      confirmationRequired: true,
      error: "MCP tool requires confirmation because runtimeControls.toolAccess.mcpStrategy=ask",
    });
  });
});
