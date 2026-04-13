/**
 * MCP Manager - Manages multiple MCP clients and integrates with ToolRegistry
 *
 * Automatically discovers tools from connected MCP servers and registers them
 * to the global ToolRegistry with source="mcp".
 */

import { MCPClientImpl } from "./client.js";
import type {
  MCPClient,
  MCPServerConfig,
  MCPTool,
  MCPToolCallRequest,
  MCPToolCallResponse,
} from "./types.js";
import type { ToolRegistry } from "../registry/tool-registry.js";
import type { Logger } from "../utils/logger.js";

export class MCPManager {
  private clients = new Map<string, MCPClient>();
  private logger?: Logger;

  constructor(
    private readonly toolRegistry: ToolRegistry,
    logger?: Logger,
  ) {
    this.logger = logger;
  }

  /**
   * Add and connect to an MCP server
   */
  async addServer(config: MCPServerConfig): Promise<void> {
    if (config.enabled === false) {
      this.logger?.info(`MCP server ${config.name} is disabled, skipping`);
      return;
    }

    if (this.clients.has(config.name)) {
      this.logger?.warn(`MCP server ${config.name} already exists`);
      return;
    }

    const client = new MCPClientImpl(config, {
      onStateChange: (state) => {
        this.logger?.info(`MCP server ${config.name} state: ${state}`);
      },
      onToolsDiscovered: (tools) => {
        this.logger?.info(`MCP server ${config.name} discovered ${tools.length} tools`);
        this.registerTools(config.name, tools);
      },
      onError: (error) => {
        this.logger?.error(`MCP server ${config.name} error: ${error.message}`);
      },
      onLog: (level, message) => {
        if (level === "stderr") {
          this.logger?.debug(`[${config.name}] ${message}`);
        }
      },
    });

    this.clients.set(config.name, client);

    try {
      await client.connect();
      this.logger?.info(`MCP server ${config.name} connected successfully`);
    } catch (error) {
      this.logger?.error(`Failed to connect to MCP server ${config.name}: ${error}`);
      this.clients.delete(config.name);
      throw error;
    }
  }

  /**
   * Remove and disconnect from an MCP server
   */
  async removeServer(name: string): Promise<void> {
    const client = this.clients.get(name);
    if (!client) {
      this.logger?.warn(`MCP server ${name} not found`);
      return;
    }

    // Unregister all tools from this server
    this.unregisterTools(name);

    await client.disconnect();
    this.clients.delete(name);
    this.logger?.info(`MCP server ${name} removed`);
  }

  /**
   * Get all connected servers
   */
  getServers(): Array<{ name: string; state: string; toolCount: number }> {
    return Array.from(this.clients.entries()).map(([name, client]) => ({
      name,
      state: client.state,
      toolCount: client.tools.length,
    }));
  }

  /**
   * Get a specific client
   */
  getClient(name: string): MCPClient | undefined {
    return this.clients.get(name);
  }

  /**
   * Disconnect all servers
   */
  async disconnectAll(): Promise<void> {
    const promises = Array.from(this.clients.keys()).map((name) =>
      this.removeServer(name)
    );
    await Promise.all(promises);
  }

  /**
   * Register tools from an MCP server to ToolRegistry
   */
  private registerTools(serverName: string, tools: ReadonlyArray<MCPTool>): void {
    for (const tool of tools) {
      const toolName = `${serverName}.${tool.name}`;

      this.toolRegistry.register({
        name: toolName,
        description: tool.description || `MCP tool from ${serverName}`,
        inputSchema: tool.inputSchema,
        source: "mcp",
        handler: async (args: Record<string, unknown>) => {
          return await this.executeMCPTool(serverName, tool.name, args);
        },
      });

      this.logger?.debug(`Registered MCP tool: ${toolName}`);
    }
  }

  /**
   * Unregister all tools from an MCP server
   */
  private unregisterTools(serverName: string): void {
    const client = this.clients.get(serverName);
    if (!client) return;

    for (const tool of client.tools) {
      const toolName = `${serverName}.${tool.name}`;
      this.toolRegistry.unregister(toolName);
      this.logger?.debug(`Unregistered MCP tool: ${toolName}`);
    }
  }

  /**
   * Execute an MCP tool
   */
  private async executeMCPTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const client = this.clients.get(serverName);
    if (!client) {
      throw new Error(`MCP server ${serverName} not found`);
    }

    if (client.state !== "connected") {
      throw new Error(`MCP server ${serverName} not connected (state: ${client.state})`);
    }

    const request: MCPToolCallRequest = {
      name: toolName,
      arguments: args,
    };

    const response: MCPToolCallResponse = await client.callTool(request);

    if (!response.success) {
      throw new Error(response.error || "MCP tool execution failed");
    }

    // Extract text content from response
    if (response.content && response.content.length > 0) {
      const textContent = response.content
        .filter((c) => c.type === "text")
        .map((c) => (c as any).text)
        .join("\n");

      return textContent || response.content;
    }

    return null;
  }
}
