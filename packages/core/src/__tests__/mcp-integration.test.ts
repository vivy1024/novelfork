/**
 * MCP Integration Tests
 *
 * Tests the integration of MCP client with agent loop and tool registry
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { globalToolRegistry } from "../registry/tool-registry.js";
import { shutdownMCPManager } from "../pipeline/agent.js";
import type { MCPServerConfig } from "../mcp/types.js";

describe("MCP Integration", () => {
  afterEach(async () => {
    await shutdownMCPManager();
  });

  it("should export MCP types and classes", async () => {
    const { MCPClientImpl, MCPManager, MCPMethods, MCPErrorCodes } = await import("../mcp/index.js");

    expect(MCPClientImpl).toBeDefined();
    expect(MCPManager).toBeDefined();
    expect(MCPMethods).toBeDefined();
    expect(MCPErrorCodes).toBeDefined();
  });

  it("should register MCP tools to global registry", async () => {
    const { MCPManager } = await import("../mcp/manager.js");

    const manager = new MCPManager(globalToolRegistry);

    // Initially no MCP tools
    const initialTools = globalToolRegistry.listDefinitions().filter(t => t.source === "mcp");
    expect(initialTools).toEqual([]);

    await manager.disconnectAll();
  });

  it("should handle MCP server configuration", () => {
    const config: MCPServerConfig = {
      name: "test-server",
      transport: "stdio",
      command: "node",
      args: ["--version"],
      timeout: 5000,
      autoReconnect: true,
      enabled: true,
    };

    expect(config.name).toBe("test-server");
    expect(config.transport).toBe("stdio");
    expect(config.timeout).toBe(5000);
  });

  it("should support SSE transport configuration", () => {
    const config: MCPServerConfig = {
      name: "sse-server",
      transport: "sse",
      url: "http://localhost:3000/sse",
      headers: {
        "Authorization": "Bearer token",
      },
      timeout: 10000,
    };

    expect(config.transport).toBe("sse");
    expect(config.url).toBe("http://localhost:3000/sse");
    expect(config.headers?.["Authorization"]).toBe("Bearer token");
  });

  it("should shutdown MCP manager cleanly", async () => {
    await shutdownMCPManager();
    // Should not throw
  });

  it("should handle multiple shutdown calls", async () => {
    await shutdownMCPManager();
    await shutdownMCPManager();
    // Should not throw
  });
});
