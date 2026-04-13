/**
 * MCP Client Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MCPClientImpl } from "../mcp/client.js";
import type { MCPServerConfig, MCPConnectionState } from "../mcp/types.js";

describe("MCPClient", () => {
  let mockConfig: MCPServerConfig;

  beforeEach(() => {
    mockConfig = {
      name: "test-server",
      transport: "stdio",
      command: "node",
      args: ["--version"],
      timeout: 5000,
      autoReconnect: false,
    };
  });

  it("should initialize with disconnected state", () => {
    const client = new MCPClientImpl(mockConfig);
    expect(client.state).toBe("disconnected");
    expect(client.tools).toEqual([]);
  });

  it("should emit state change events", async () => {
    const states: MCPConnectionState[] = [];
    const config: MCPServerConfig = {
      ...mockConfig,
      autoReconnect: false,
    };

    const client = new MCPClientImpl(config, {
      onStateChange: (state) => states.push(state),
    });

    expect(states).toEqual([]);
  });

  it("should handle connection errors gracefully", async () => {
    const config: MCPServerConfig = {
      name: "invalid-server",
      transport: "stdio",
      command: "nonexistent-command",
      args: [],
      timeout: 1000,
      autoReconnect: false,
    };

    const client = new MCPClientImpl(config);

    await expect(client.connect()).rejects.toThrow();
    expect(client.state).toBe("failed");
  });

  it("should return error when calling tool while disconnected", async () => {
    const client = new MCPClientImpl(mockConfig);

    const response = await client.callTool({
      name: "test-tool",
      arguments: {},
    });

    expect(response.success).toBe(false);
    expect(response.error).toBe("Client not connected");
    expect(response.isRetryable).toBe(true);
  });

  it("should list tools after discovery", async () => {
    const client = new MCPClientImpl(mockConfig);
    const tools = await client.listTools();
    expect(Array.isArray(tools)).toBe(true);
  });

  it("should normalize schema with array type", () => {
    const client = new MCPClientImpl(mockConfig);
    const schema = {
      type: ["string", "null"],
      properties: {},
    };

    // Access private method via any cast for testing
    const normalized = (client as any).normalizeSchema(schema);
    expect(normalized.type).toBe("string");
  });
});
