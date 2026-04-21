import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { userConfigState, mockCallTool } = vi.hoisted(() => ({
  userConfigState: {
    runtimeControls: {
      defaultPermissionMode: "allow" as const,
      toolAccess: {
        allowlist: [] as string[],
        blocklist: [] as string[],
        mcpStrategy: "inherit" as "inherit" | "allow" | "ask" | "deny",
      },
    },
  },
  mockCallTool: vi.fn(async ({ name, arguments: args }: { name: string; arguments: Record<string, unknown> }) => ({
    content: [{ type: "text", text: `called:${name}` }],
    structuredContent: args,
    isError: false,
  })),
}));

vi.mock("../lib/user-config-service.js", () => ({
  loadUserConfig: vi.fn(async () => userConfigState),
}));

vi.mock("@vivy1024/novelfork-core", () => ({
  MCPClientImpl: class MockMCPClientImpl {
    state = "connected";
    tools = new Set([{ name: "read_file", description: "Read a file" }]);
    async connect() {
      this.state = "connected";
    }
    async disconnect() {
      this.state = "disconnected";
    }
    async callTool(payload: { name: string; arguments: Record<string, unknown> }) {
      return mockCallTool(payload);
    }
  },
}));

import { createMCPRouter, resetMCPRuntime } from "./mcp";

describe("createMCPRouter", () => {
  let root: string;

  beforeEach(async () => {
    resetMCPRuntime();
    mockCallTool.mockClear();
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
      allowTools: 0,
      promptTools: 0,
      denyTools: 0,
      policySource: "runtimeControls.toolAccess",
      mcpStrategy: "inherit",
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

  it("blocks MCP tool calls when runtimeControls.toolAccess denies the tool", async () => {
    userConfigState.runtimeControls.toolAccess.blocklist = ["read_file"];
    const app = createMCPRouter(root);

    const startResponse = await app.request("http://localhost/api/mcp/servers/stdio-server/start", {
      method: "POST",
    });
    expect(startResponse.status).toBe(200);

    const response = await app.request("http://localhost/api/mcp/servers/stdio-server/call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tool: "read_file",
        arguments: { path: "story.txt" },
      }),
    });

    expect(response.status).toBe(403);
    expect(mockCallTool).not.toHaveBeenCalled();
    const payload = await response.json();
    expect(payload).toMatchObject({
      success: false,
      allowed: false,
      source: "runtimeControls.toolAccess.blocklist",
      error: "MCP tool is blocked by runtimeControls.toolAccess.blocklist",
    });
  });

  it("returns confirmationRequired when MCP policy resolves to ask", async () => {
    userConfigState.runtimeControls.toolAccess.mcpStrategy = "ask";
    const app = createMCPRouter(root);

    const startResponse = await app.request("http://localhost/api/mcp/servers/stdio-server/start", {
      method: "POST",
    });
    expect(startResponse.status).toBe(200);

    const response = await app.request("http://localhost/api/mcp/servers/stdio-server/call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tool: "read_file",
        arguments: { path: "story.txt" },
      }),
    });

    expect(response.status).toBe(403);
    expect(mockCallTool).not.toHaveBeenCalled();
    const payload = await response.json();
    expect(payload).toMatchObject({
      success: false,
      allowed: false,
      confirmationRequired: true,
      source: "runtimeControls.toolAccess.mcpStrategy",
      error: "MCP tool requires confirmation because runtimeControls.toolAccess.mcpStrategy=ask",
    });
  });

  it("calls the MCP tool when runtimeControls allows execution", async () => {
    userConfigState.runtimeControls.toolAccess.mcpStrategy = "allow";
    const app = createMCPRouter(root);

    const startResponse = await app.request("http://localhost/api/mcp/servers/stdio-server/start", {
      method: "POST",
    });
    expect(startResponse.status).toBe(200);

    const response = await app.request("http://localhost/api/mcp/servers/stdio-server/call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tool: "read_file",
        arguments: { path: "story.txt" },
      }),
    });

    expect(response.status).toBe(200);
    expect(mockCallTool).toHaveBeenCalledWith({
      name: "read_file",
      arguments: { path: "story.txt" },
    });
    const payload = await response.json();
    expect(payload).toMatchObject({
      content: [{ type: "text", text: "called:read_file" }],
      structuredContent: { path: "story.txt" },
      isError: false,
    });
  });

  it("returns governance-aware registry counts and tool access metadata after a server starts", async () => {
    userConfigState.runtimeControls.toolAccess.mcpStrategy = "ask";
    const app = createMCPRouter(root);

    const startResponse = await app.request("http://localhost/api/mcp/servers/stdio-server/start", {
      method: "POST",
    });
    expect(startResponse.status).toBe(200);

    const registryResponse = await app.request("http://localhost/api/mcp/registry");
    expect(registryResponse.status).toBe(200);
    const payload = await registryResponse.json();

    expect(payload.summary).toMatchObject({
      totalServers: 2,
      connectedServers: 1,
      discoveredTools: 1,
      enabledTools: 1,
      allowTools: 0,
      promptTools: 1,
      denyTools: 0,
      policySource: "runtimeControls.toolAccess",
      mcpStrategy: "ask",
    });
    expect(payload.servers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "stdio-server",
          toolCount: 1,
          tools: [
            expect.objectContaining({
              name: "read_file",
              access: "prompt",
              source: "runtimeControls.toolAccess.mcpStrategy",
            }),
          ],
        }),
      ]),
    );
  });
});
