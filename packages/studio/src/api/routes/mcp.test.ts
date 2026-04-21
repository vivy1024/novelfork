import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createMCPRouter, resetMCPRuntime } from "./mcp";

describe("createMCPRouter", () => {
  let root: string;

  beforeEach(async () => {
    resetMCPRuntime();
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
});
