/**
 * MCP Registry — bridges MCP servers into the session tool system.
 *
 * Responsibilities:
 * - Manage MCP server connections (start/stop/reconnect)
 * - Discover tools from connected servers
 * - Register MCP tools as session tools (dynamic plugin registration)
 * - Route MCP tool calls through the appropriate server client
 *
 * MCP tools are registered with names prefixed as `mcp__<serverName>__<toolName>`
 * to avoid collisions with built-in session tools.
 */

import { createMcpClient, type McpClient, type McpServerConfig, type McpTool } from "./mcp-client-runtime.js";
import { registerPluginTools } from "./session-tool-registry.js";
import type { SessionToolDefinition, SessionToolRisk } from "../../shared/agent-native-workspace.js";
import type { McpPolicyMode } from "../../types/settings.js";

export interface McpRegistryOptions {
  /** MCP tool risk level (default: "confirmed-write") */
  readonly defaultRisk?: SessionToolRisk;
  /** MCP strategy from user config */
  readonly mcpStrategy?: McpPolicyMode;
}

export interface McpRegistryServerStatus {
  readonly id: string;
  readonly name: string;
  readonly status: "disconnected" | "connecting" | "connected" | "error" | "needs-auth";
  readonly toolCount: number;
  readonly error?: string;
}

interface ManagedMcpServer {
  readonly config: McpServerConfig;
  readonly client: McpClient;
  tools: McpTool[];
}

const MCP_TOOL_PREFIX = "mcp__";

/**
 * Format an MCP tool name for session tool registration.
 * Pattern: mcp__<serverName>__<toolName>
 */
export function formatMcpToolName(serverName: string, toolName: string): string {
  // Sanitize server name: replace non-alphanumeric with underscore
  const safeName = serverName.replace(/[^a-zA-Z0-9_]/g, "_");
  return `${MCP_TOOL_PREFIX}${safeName}__${toolName}`;
}

/**
 * Parse an MCP tool name back into server name and tool name.
 * Returns null if the name is not an MCP tool.
 */
export function parseMcpToolName(fullName: string): { serverName: string; toolName: string } | null {
  if (!fullName.startsWith(MCP_TOOL_PREFIX)) return null;
  const rest = fullName.slice(MCP_TOOL_PREFIX.length);
  const separatorIndex = rest.indexOf("__");
  if (separatorIndex < 0) return null;
  return {
    serverName: rest.slice(0, separatorIndex),
    toolName: rest.slice(separatorIndex + 2),
  };
}

/**
 * Check if a tool name is an MCP tool.
 */
export function isMcpTool(toolName: string): boolean {
  return toolName.startsWith(MCP_TOOL_PREFIX);
}

export class McpRegistry {
  private servers = new Map<string, ManagedMcpServer>();
  private options: McpRegistryOptions;

  constructor(options: McpRegistryOptions = {}) {
    this.options = options;
  }

  /**
   * Connect to an MCP server and discover its tools.
   */
  async connectServer(config: McpServerConfig): Promise<McpTool[]> {
    // Disconnect existing connection if any
    if (this.servers.has(config.id)) {
      await this.disconnectServer(config.id);
    }

    const client = createMcpClient(config);
    const managed: ManagedMcpServer = { config, client, tools: [] };
    this.servers.set(config.id, managed);

    try {
      await client.connect();
      const tools = await client.listTools();
      managed.tools = tools;
      this.registerToolsAsSessionTools(config, tools);
      return tools;
    } catch (error) {
      // Keep the entry so status can be queried
      managed.tools = [];
      throw error;
    }
  }

  /**
   * Disconnect a specific MCP server.
   */
  async disconnectServer(serverId: string): Promise<void> {
    const managed = this.servers.get(serverId);
    if (!managed) return;
    try {
      await managed.client.disconnect();
    } catch {
      // Ignore disconnect errors
    }
    this.servers.delete(serverId);
  }

  /**
   * Disconnect all MCP servers.
   */
  async disconnectAll(): Promise<void> {
    const ids = [...this.servers.keys()];
    await Promise.allSettled(ids.map((id) => this.disconnectServer(id)));
  }

  /**
   * Load and connect servers from a config array.
   */
  async loadFromConfigs(configs: McpServerConfig[]): Promise<void> {
    await Promise.allSettled(
      configs.map((config) => this.connectServer(config)),
    );
  }

  /**
   * Get status of all connected servers.
   */
  getServerStatuses(): McpRegistryServerStatus[] {
    return [...this.servers.values()].map((managed) => ({
      id: managed.config.id,
      name: managed.config.name,
      status: managed.client.status,
      toolCount: managed.tools.length,
    }));
  }

  /**
   * Get all available MCP tools across all connected servers.
   */
  getAvailableTools(): Array<McpTool & { serverId: string; serverName: string; fullName: string }> {
    const result: Array<McpTool & { serverId: string; serverName: string; fullName: string }> = [];
    for (const managed of this.servers.values()) {
      if (managed.client.status !== "connected") continue;
      for (const tool of managed.tools) {
        result.push({
          ...tool,
          serverId: managed.config.id,
          serverName: managed.config.name,
          fullName: formatMcpToolName(managed.config.name, tool.name),
        });
      }
    }
    return result;
  }

  /**
   * Call an MCP tool by its full session tool name (mcp__server__tool).
   */
  async callTool(fullName: string, args: Record<string, unknown>): Promise<{ content: string; isError?: boolean }> {
    const parsed = parseMcpToolName(fullName);
    if (!parsed) {
      throw new Error(`Not an MCP tool name: ${fullName}`);
    }

    // Find the server by sanitized name
    const managed = this.findServerByName(parsed.serverName);
    if (!managed) {
      throw new Error(`MCP server not found: ${parsed.serverName}`);
    }

    if (managed.client.status !== "connected") {
      throw new Error(`MCP server "${managed.config.name}" is not connected (status: ${managed.client.status})`);
    }

    const result = await managed.client.callTool(parsed.toolName, args);
    // Normalize result to string content
    const content = typeof result.content === "string"
      ? result.content
      : JSON.stringify(result.content);
    return { content, isError: result.isError };
  }

  /**
   * Call an MCP tool by server ID and tool name directly.
   */
  async callToolDirect(serverId: string, toolName: string, args: Record<string, unknown>): Promise<{ content: string; isError?: boolean }> {
    const managed = this.servers.get(serverId);
    if (!managed) {
      throw new Error(`MCP server not found: ${serverId}`);
    }

    if (managed.client.status !== "connected") {
      throw new Error(`MCP server "${managed.config.name}" is not connected (status: ${managed.client.status})`);
    }

    const result = await managed.client.callTool(toolName, args);
    const content = typeof result.content === "string"
      ? result.content
      : JSON.stringify(result.content);
    return { content, isError: result.isError };
  }

  // --- Private helpers ---

  private findServerByName(sanitizedName: string): ManagedMcpServer | undefined {
    for (const managed of this.servers.values()) {
      const safeName = managed.config.name.replace(/[^a-zA-Z0-9_]/g, "_");
      if (safeName === sanitizedName) return managed;
    }
    return undefined;
  }

  private registerToolsAsSessionTools(config: McpServerConfig, tools: McpTool[]): void {
    const risk = this.options.defaultRisk ?? "confirmed-write";
    const enabledForModes = risk === "read"
      ? (["ask", "edit", "allow", "read", "plan"] as const)
      : (["ask", "edit", "allow"] as const);

    const sessionTools: SessionToolDefinition[] = tools.map((tool) => ({
      name: formatMcpToolName(config.name, tool.name),
      description: `[MCP: ${config.name}] ${tool.description ?? tool.name}`,
      inputSchema: normalizeInputSchema(tool.inputSchema),
      risk,
      renderer: "tool.mcp",
      enabledForModes: [...enabledForModes],
      visibility: "author" as const,
    }));

    if (sessionTools.length > 0) {
      registerPluginTools(sessionTools);
    }
  }
}

/**
 * Normalize an MCP tool's input schema to our JsonObjectSchema format.
 */
function normalizeInputSchema(schema: unknown): {
  type: "object";
  properties: Record<string, unknown>;
  required: readonly string[];
  additionalProperties: boolean;
} {
  if (
    schema &&
    typeof schema === "object" &&
    "type" in schema &&
    (schema as Record<string, unknown>).type === "object"
  ) {
    const s = schema as Record<string, unknown>;
    return {
      type: "object",
      properties: (s.properties as Record<string, unknown>) ?? {},
      required: (Array.isArray(s.required) ? s.required : []) as readonly string[],
      additionalProperties: false,
    };
  }

  // Fallback: accept any object
  return {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  };
}

// --- Singleton registry instance ---

let globalRegistry: McpRegistry | null = null;

/**
 * Get or create the global MCP registry singleton.
 */
export function getMcpRegistry(options?: McpRegistryOptions): McpRegistry {
  if (!globalRegistry) {
    globalRegistry = new McpRegistry(options);
  }
  return globalRegistry;
}

/**
 * Reset the global registry (for testing).
 */
export function resetMcpRegistry(): void {
  if (globalRegistry) {
    globalRegistry.disconnectAll().catch(() => {});
    globalRegistry = null;
  }
}
