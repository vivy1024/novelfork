/**
 * MCP Server 管理 API 路由
 * Uses core MCPClientImpl for real JSON-RPC handshake and tool discovery.
 */

import { Hono } from "hono";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MCPClientImpl, type MCPServerConfig as CoreMCPConfig } from "@vivy1024/novelfork-core";
import { getMCPToolDecision, type ToolAccessReasonKey } from "../lib/runtime-tool-access.js";
import { loadUserConfig } from "../lib/user-config-service.js";

interface MCPServerEntry {
  readonly id: string;
  readonly name: string;
  readonly transport: "stdio" | "sse";
  readonly command?: string;
  readonly args?: string[];
  readonly url?: string;
  readonly env?: Record<string, string>;
}

interface ManagedServer {
  readonly entry: MCPServerEntry;
  readonly client: MCPClientImpl;
}

interface MCPRegistryTool {
  readonly name: string;
  readonly description?: string;
  readonly access?: "allow" | "prompt" | "deny";
  readonly source?: string;
  readonly reason?: string;
  readonly reasonKey?: ToolAccessReasonKey;
}

interface MCPRegistryServer extends MCPServerEntry {
  readonly status: "disconnected" | "connecting" | "connected" | "reconnecting" | "failed";
  readonly tools: MCPRegistryTool[];
  readonly toolCount: number;
  readonly error?: string;
}

const managedServers = new Map<string, ManagedServer>();

export function resetMCPRuntime() {
  managedServers.clear();
}

export function createMCPRouter(projectRoot: string): Hono {
  const app = new Hono();

  async function loadConfig(): Promise<MCPServerEntry[]> {
    try {
      const configPath = join(projectRoot, "novelfork.json");
      const raw = await readFile(configPath, "utf-8");
      const config = JSON.parse(raw);
      return config.mcpServers ?? [];
    } catch {
      return [];
    }
  }

  async function saveConfig(servers: MCPServerEntry[]): Promise<void> {
    const configPath = join(projectRoot, "novelfork.json");
    let config: Record<string, unknown> = {};
    try {
      const raw = await readFile(configPath, "utf-8");
      config = JSON.parse(raw);
    } catch {
      // new file
    }
    config.mcpServers = servers;
    await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
  }

  function toCoreConfig(entry: MCPServerEntry): CoreMCPConfig {
    return {
      name: entry.name,
      transport: entry.transport ?? "stdio",
      command: entry.command,
      args: entry.args,
      url: entry.url,
      env: entry.env,
      autoReconnect: false,
      timeout: 15000,
    };
  }

  function serializeServer(
    entry: MCPServerEntry,
    runtimeControls: Awaited<ReturnType<typeof loadUserConfig>>["runtimeControls"],
  ): MCPRegistryServer {
    const managed = managedServers.get(entry.id);
    const client = managed?.client;
    const tools = client
      ? [...client.tools].map((tool) => {
          const decision = getMCPToolDecision(tool.name, runtimeControls);
          return {
            name: tool.name,
            description: tool.description,
            access: decision.action,
            source: decision.source,
            reason: decision.reason,
            reasonKey: decision.reasonKey,
          };
        })
      : [];

    return {
      ...entry,
      status: client?.state ?? "disconnected",
      tools,
      toolCount: tools.length,
      error: undefined,
    };
  }

  async function buildRegistry() {
    const entries = await loadConfig();
    const userConfig = await loadUserConfig();
    const servers = entries.map((entry) => serializeServer(entry, userConfig.runtimeControls));
    const connectedServers = servers.filter((server) => server.status === "connected").length;
    const discoveredTools = servers.reduce((sum, server) => sum + server.toolCount, 0);
    const allowTools = servers.reduce((sum, server) => sum + server.tools.filter((tool) => tool.access === "allow").length, 0);
    const promptTools = servers.reduce((sum, server) => sum + server.tools.filter((tool) => tool.access === "prompt").length, 0);
    const denyTools = servers.reduce((sum, server) => sum + server.tools.filter((tool) => tool.access === "deny").length, 0);
    const enabledTools = allowTools + promptTools;

    return {
      servers,
      summary: {
        totalServers: servers.length,
        connectedServers,
        enabledTools,
        discoveredTools,
        allowTools,
        promptTools,
        denyTools,
        policySource: "runtimeControls.toolAccess",
        mcpStrategy: userConfig.runtimeControls.toolAccess.mcpStrategy,
      },
    };
  }

  app.get("/api/mcp/registry", async (c) => {
    return c.json(await buildRegistry());
  });

  app.get("/api/mcp/servers", async (c) => {
    const registry = await buildRegistry();
    return c.json({ servers: registry.servers, summary: registry.summary });
  });

  app.post("/api/mcp/servers", async (c) => {
    const body = await c.req.json<{
      name: string;
      transport?: "stdio" | "sse";
      command?: string;
      args?: string[];
      url?: string;
      env?: Record<string, string>;
    }>();
    const entries = await loadConfig();
    const id = `mcp-${Date.now()}`;
    entries.push({
      id,
      name: body.name,
      transport: body.transport ?? "stdio",
      command: body.transport === "sse" ? undefined : body.command,
      args: body.transport === "sse" ? undefined : body.args,
      url: body.transport === "sse" ? body.url : undefined,
      env: body.env,
    });
    await saveConfig(entries);
    return c.json({ ok: true, id });
  });

  app.put("/api/mcp/servers/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<Partial<Omit<MCPServerEntry, "id">>>();
    const entries = await loadConfig();
    const index = entries.findIndex((entry) => entry.id === id);
    if (index < 0) {
      return c.json({ error: "Server not found" }, 404);
    }

    const current = entries[index]!;
    const transport = body.transport ?? current.transport;
    const updated: MCPServerEntry = {
      ...current,
      ...body,
      id,
      transport,
      command: transport === "stdio" ? body.command ?? current.command : undefined,
      args: transport === "stdio" ? body.args ?? current.args : undefined,
      url: transport === "sse" ? body.url ?? current.url : undefined,
      env: body.env ?? current.env,
    };

    const managed = managedServers.get(id);
    if (managed) {
      await managed.client.disconnect();
      managedServers.delete(id);
    }

    entries[index] = updated;
    await saveConfig(entries);
    const userConfig = await loadUserConfig();
    return c.json({ ok: true, server: serializeServer(updated, userConfig.runtimeControls) });
  });

  app.post("/api/mcp/servers/:id/start", async (c) => {
    const id = c.req.param("id");
    const entries = await loadConfig();
    const entry = entries.find((server) => server.id === id);
    if (!entry) return c.json({ error: "Server not found" }, 404);

    if (managedServers.has(id)) {
      return c.json({ error: "Server already running" }, 400);
    }

    const client = new MCPClientImpl(toCoreConfig(entry));
    managedServers.set(id, { entry, client });

    try {
      await client.connect();
      const tools = [...client.tools].map((tool) => ({ name: tool.name, description: tool.description }));
      return c.json({ ok: true, status: client.state, tools });
    } catch (error) {
      managedServers.delete(id);
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  app.post("/api/mcp/servers/:id/stop", async (c) => {
    const id = c.req.param("id");
    const managed = managedServers.get(id);
    if (!managed) return c.json({ error: "Server not running" }, 400);

    await managed.client.disconnect();
    managedServers.delete(id);
    return c.json({ ok: true });
  });

  app.post("/api/mcp/servers/:id/delete", async (c) => {
    const id = c.req.param("id");
    const managed = managedServers.get(id);
    if (managed) {
      await managed.client.disconnect();
      managedServers.delete(id);
    }
    const entries = await loadConfig();
    await saveConfig(entries.filter((entry) => entry.id !== id));
    return c.json({ ok: true });
  });

  app.post("/api/mcp/servers/:id/call", async (c) => {
    const id = c.req.param("id");
    const managed = managedServers.get(id);
    if (!managed) return c.json({ error: "Server not connected" }, 400);

    const body = await c.req.json<{ tool: string; arguments?: Record<string, unknown> }>();
    const userConfig = await loadUserConfig();
    const decision = getMCPToolDecision(body.tool, userConfig.runtimeControls);

    if (decision.action === "deny") {
      return c.json(
        {
          success: false,
          allowed: false,
          reason: decision.reason,
          source: decision.source,
          reasonKey: decision.reasonKey,
          error: decision.reason || "MCP tool execution denied",
        },
        403,
      );
    }

    if (decision.action === "prompt") {
      return c.json(
        {
          success: false,
          allowed: false,
          confirmationRequired: true,
          reason: decision.reason,
          source: decision.source,
          reasonKey: decision.reasonKey,
          error: decision.reason || "MCP tool execution requires confirmation",
        },
        403,
      );
    }

    const result = await managed.client.callTool({
      name: body.tool,
      arguments: body.arguments ?? {},
    });
    return c.json(result);
  });

  return app;
}
