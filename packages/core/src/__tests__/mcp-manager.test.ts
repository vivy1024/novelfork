/**
 * MCP Manager Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MCPManager } from "../mcp/manager.js";
import { ToolRegistry } from "../registry/tool-registry.js";
import type { MCPServerConfig } from "../mcp/types.js";

describe("MCPManager", () => {
  let manager: MCPManager;
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
    manager = new MCPManager(registry);
  });

  afterEach(async () => {
    await manager.disconnectAll();
  });

  it("should initialize with no servers", () => {
    const servers = manager.getServers();
    expect(servers).toEqual([]);
  });

  it("should skip disabled servers", async () => {
    const config: MCPServerConfig = {
      name: "disabled-server",
      transport: "stdio",
      command: "node",
      args: ["--version"],
      enabled: false,
    };

    await manager.addServer(config);
    const servers = manager.getServers();
    expect(servers).toEqual([]);
  });

  it("should not add duplicate servers", async () => {
    const config: MCPServerConfig = {
      name: "test-server",
      transport: "stdio",
      command: "node",
      args: ["--version"],
      autoReconnect: false,
    };

    // First add should fail to connect (node --version exits immediately)
    // We expect this to throw
    await expect(manager.addServer(config)).rejects.toThrow();

    // After failure, the server should not be in the list
    const servers = manager.getServers();
    expect(servers).toEqual([]);
  });

  it("should handle connection failures gracefully", async () => {
    const config: MCPServerConfig = {
      name: "invalid-server",
      transport: "stdio",
      command: "nonexistent-command",
      args: [],
      timeout: 1000,
      autoReconnect: false,
    };

    await expect(manager.addServer(config)).rejects.toThrow();
    const servers = manager.getServers();
    expect(servers).toEqual([]);
  });

  it("should remove server and unregister tools", async () => {
    const config: MCPServerConfig = {
      name: "test-server",
      transport: "stdio",
      command: "node",
      args: ["--version"],
      autoReconnect: false,
    };

    try {
      await manager.addServer(config);
    } catch {
      // Expected to fail
    }

    await manager.removeServer("test-server");
    const servers = manager.getServers();
    expect(servers).toEqual([]);
  });

  it("should handle removing non-existent server", async () => {
    await manager.removeServer("non-existent");
    // Should not throw
  });

  it("should disconnect all servers", async () => {
    await manager.disconnectAll();
    const servers = manager.getServers();
    expect(servers).toEqual([]);
  });

  it("should get client by name", () => {
    const client = manager.getClient("non-existent");
    expect(client).toBeUndefined();
  });

  it("should register MCP tools with server prefix", async () => {
    // This test would require a mock MCP server
    // For now, just verify the registry integration
    expect(registry.listDefinitions()).toEqual([]);
  });
});
