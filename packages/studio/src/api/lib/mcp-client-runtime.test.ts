import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createMcpClient,
  type McpClient,
  type McpServerConfig,
  type McpTool,
} from "./mcp-client-runtime";

describe("MCP client runtime", () => {
  it("creates a client from server config", () => {
    const config: McpServerConfig = { id: "test-server", name: "Test", transport: "stdio", command: "echo", args: [] };
    const client = createMcpClient(config);

    expect(client.serverId).toBe("test-server");
    expect(client.status).toBe("disconnected");
  });

  it("connects to a stdio server and lists tools", async () => {
    const config: McpServerConfig = { id: "echo-server", name: "Echo", transport: "stdio", command: "node", args: ["-e", `
      const readline = require('readline');
      const rl = readline.createInterface({ input: process.stdin });
      rl.on('line', (line) => {
        const msg = JSON.parse(line);
        if (msg.method === 'initialize') {
          process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { capabilities: { tools: {} }, serverInfo: { name: 'echo', version: '1.0' } } }) + '\\n');
        } else if (msg.method === 'tools/list') {
          process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'echo', description: 'Echo input', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }] } }) + '\\n');
        }
      });
    `] };

    const client = createMcpClient(config);
    await client.connect();

    expect(client.status).toBe("connected");

    const tools = await client.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ name: "echo", description: "Echo input" });

    await client.disconnect();
    expect(client.status).toBe("disconnected");
  }, 10000);

  it("reports error status when server process fails to start", async () => {
    const config: McpServerConfig = { id: "bad-server", name: "Bad", transport: "stdio", command: "nonexistent-binary-xyz", args: [] };
    const client = createMcpClient(config);

    await expect(client.connect()).rejects.toThrow();
    expect(client.status).toBe("error");
  });
});
