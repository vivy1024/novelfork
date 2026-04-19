/**
 * MCP Server 管理 API 路由
 * Uses core MCPClientImpl for real JSON-RPC handshake and tool discovery.
 */

import { Hono } from "hono";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MCPClientImpl, type MCPServerConfig as CoreMCPConfig } from "@actalk/novelfork-core";

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

const managedServers = new Map<string, ManagedServer>();

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
    } catch { /* new file */ }
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

  // GET /api/mcp/servers
  app.get("/api/mcp/servers", async (c) => {
    const entries = await loadConfig();
    const servers = entries.map((entry) => {
      const managed = managedServers.get(entry.id);
      const client = managed?.client;
      return {
        id: entry.id,
        name: entry.name,
        transport: entry.transport ?? "stdio",
        command: entry.command,
        args: entry.args,
        url: entry.url,
        env: entry.env,
        status: client?.state ?? "disconnected",
        tools: client ? [...client.tools].map((t) => ({ name: t.name, description: t.description })) : [],
        error: undefined as string | undefined,
      };
    });
    return c.json({ servers });
  });

  // POST /api/mcp/servers — add new server config
  app.post("/api/mcp/servers", async (c) => {
    const body = await c.req.json<{
      name: string; transport?: "stdio" | "sse";
      command?: string; args?: string[]; url?: string;
      env?: Record<string, string>;
    }>();
    const entries = await loadConfig();
    const id = `mcp-${Date.now()}`;
    entries.push({
      id, name: body.name,
      transport: body.transport ?? "stdio",
      command: body.command, args: body.args,
      url: body.url, env: body.env,
    });
    await saveConfig(entries);
    return c.json({ ok: true, id });
  });

  // POST /api/mcp/servers/:id/start — connect via real MCP handshake
  app.post("/api/mcp/servers/:id/start", async (c) => {
    const id = c.req.param("id");
    const entries = await loadConfig();
    const entry = entries.find((e) => e.id === id);
    if (!entry) return c.json({ error: "Server not found" }, 404);

    if (managedServers.has(id)) {
      return c.json({ error: "Server already running" }, 400);
    }

    const client = new MCPClientImpl(toCoreConfig(entry));
    managedServers.set(id, { entry, client });

    try {
      await client.connect();
      const tools = [...client.tools].map((t) => ({ name: t.name, description: t.description }));
      return c.json({ ok: true, status: client.state, tools });
    } catch (e) {
      managedServers.delete(id);
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });

  // POST /api/mcp/servers/:id/stop
  app.post("/api/mcp/servers/:id/stop", async (c) => {
    const id = c.req.param("id");
    const managed = managedServers.get(id);
    if (!managed) return c.json({ error: "Server not running" }, 400);

    await managed.client.disconnect();
    managedServers.delete(id);
    return c.json({ ok: true });
  });

  // POST /api/mcp/servers/:id/delete
  app.post("/api/mcp/servers/:id/delete", async (c) => {
    const id = c.req.param("id");
    const managed = managedServers.get(id);
    if (managed) {
      await managed.client.disconnect();
      managedServers.delete(id);
    }
    const entries = await loadConfig();
    await saveConfig(entries.filter((e) => e.id !== id));
    return c.json({ ok: true });
  });

  // POST /api/mcp/servers/:id/call — invoke a tool
  app.post("/api/mcp/servers/:id/call", async (c) => {
    const id = c.req.param("id");
    const managed = managedServers.get(id);
    if (!managed) return c.json({ error: "Server not connected" }, 400);

    const body = await c.req.json<{ tool: string; arguments?: Record<string, unknown> }>();
    const result = await managed.client.callTool({
      name: body.tool,
      arguments: body.arguments ?? {},
    });
    return c.json(result);
  });

  return app;
}
