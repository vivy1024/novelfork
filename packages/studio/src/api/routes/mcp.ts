/**
 * MCP Server 管理 API 路由
 * 支持 MCP Server 的启动、停止、删除和工具列表查询
 */

import { Hono } from "hono";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

interface MCPServerConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

interface MCPServerState {
  config: MCPServerConfig;
  status: "stopped" | "starting" | "running" | "error";
  process?: ChildProcess;
  tools?: Array<{ name: string; description: string }>;
  error?: string;
}

const runningServers = new Map<string, MCPServerState>();

export function createMCPRouter(projectRoot: string): Hono {
  const app = new Hono();

  async function loadConfig(): Promise<MCPServerConfig[]> {
    try {
      const configPath = join(projectRoot, "inkos.json");
      const raw = await readFile(configPath, "utf-8");
      const config = JSON.parse(raw);
      return config.mcpServers ?? [];
    } catch {
      return [];
    }
  }

  async function saveConfig(servers: MCPServerConfig[]): Promise<void> {
    const configPath = join(projectRoot, "inkos.json");
    const raw = await readFile(configPath, "utf-8");
    const config = JSON.parse(raw);
    config.mcpServers = servers;
    await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
  }

  app.get("/api/mcp/servers", async (c) => {
    const configs = await loadConfig();
    const servers = configs.map((cfg) => {
      const state = runningServers.get(cfg.id);
      return {
        id: cfg.id,
        name: cfg.name,
        command: cfg.command,
        args: cfg.args,
        env: cfg.env,
        status: state?.status ?? "stopped",
        tools: state?.tools,
        error: state?.error,
      };
    });
    return c.json({ servers });
  });

  app.post("/api/mcp/servers", async (c) => {
    const body = await c.req.json<{ name: string; command: string; args: string[]; env?: Record<string, string> }>();
    const configs = await loadConfig();
    const id = `mcp-${Date.now()}`;
    configs.push({
      id,
      name: body.name,
      command: body.command,
      args: body.args,
      env: body.env,
    });
    await saveConfig(configs);
    return c.json({ ok: true, id });
  });

  app.post("/api/mcp/servers/:id/start", async (c) => {
    const id = c.req.param("id");
    const configs = await loadConfig();
    const config = configs.find((s) => s.id === id);
    if (!config) {
      return c.json({ error: "Server not found" }, 404);
    }

    if (runningServers.has(id)) {
      return c.json({ error: "Server already running" }, 400);
    }

    const state: MCPServerState = {
      config,
      status: "starting",
    };
    runningServers.set(id, state);

    try {
      const proc = spawn(config.command, config.args, {
        env: { ...process.env, ...config.env },
        stdio: ["pipe", "pipe", "pipe"],
      });

      state.process = proc;
      state.status = "running";

      // 简化版：假设启动后立即可用，实际应等待 MCP 初始化握手
      setTimeout(() => {
        if (state.status === "starting") {
          state.status = "running";
          // TODO: 通过 stdio JSON-RPC 获取 tools/list
          state.tools = [];
        }
      }, 2000);

      proc.on("error", (err) => {
        state.status = "error";
        state.error = err.message;
      });

      proc.on("exit", (code) => {
        if (code !== 0) {
          state.status = "error";
          state.error = `Process exited with code ${code}`;
        } else {
          state.status = "stopped";
        }
        runningServers.delete(id);
      });

      return c.json({ ok: true });
    } catch (e) {
      state.status = "error";
      state.error = String(e);
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/mcp/servers/:id/stop", async (c) => {
    const id = c.req.param("id");
    const state = runningServers.get(id);
    if (!state || !state.process) {
      return c.json({ error: "Server not running" }, 400);
    }

    state.process.kill();
    runningServers.delete(id);
    return c.json({ ok: true });
  });

  app.post("/api/mcp/servers/:id/delete", async (c) => {
    const id = c.req.param("id");
    const state = runningServers.get(id);
    if (state?.process) {
      state.process.kill();
      runningServers.delete(id);
    }

    const configs = await loadConfig();
    const filtered = configs.filter((s) => s.id !== id);
    await saveConfig(filtered);
    return c.json({ ok: true });
  });

  return app;
}
