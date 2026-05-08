/**
 * MCP Client Runtime — real MCP server connection via stdio transport.
 *
 * 对标：
 * - Claude Code CLI: src/services/mcp/client.ts (MCP client creation, connection, tool listing)
 * - Codex CLI: codex mcp list/add/remove (MCP server management)
 *
 * Implements the MCP JSON-RPC protocol over stdio for tool discovery and execution.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";

export type McpTransport = "stdio" | "sse";
export type McpClientStatus = "disconnected" | "connecting" | "connected" | "error";

export interface McpServerConfig {
  readonly id: string;
  readonly name: string;
  readonly transport: McpTransport;
  readonly command: string;
  readonly args: readonly string[];
  readonly env?: Record<string, string>;
  readonly cwd?: string;
}

export interface McpTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: unknown;
}

export interface McpToolCallResult {
  readonly content: unknown;
  readonly isError?: boolean;
}

export interface McpClient {
  readonly serverId: string;
  status: McpClientStatus;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  listTools(): Promise<McpTool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolCallResult>;
}

let nextRequestId = 1;

function createJsonRpcRequest(method: string, params?: unknown): { id: number; jsonrpc: string; method: string; params?: unknown } {
  return { jsonrpc: "2.0", id: nextRequestId++, method, ...(params !== undefined ? { params } : {}) };
}

export function createMcpClient(config: McpServerConfig): McpClient {
  let process: ChildProcess | null = null;
  let readline: ReadlineInterface | null = null;
  let status: McpClientStatus = "disconnected";
  const pendingRequests = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

  function handleLine(line: string) {
    try {
      const message = JSON.parse(line);
      if (message.id && pendingRequests.has(message.id)) {
        const pending = pendingRequests.get(message.id)!;
        pendingRequests.delete(message.id);
        if (message.error) {
          pending.reject(new Error(message.error.message ?? "MCP error"));
        } else {
          pending.resolve(message.result);
        }
      }
    } catch {
      // Ignore non-JSON lines
    }
  }

  async function sendRequest(method: string, params?: unknown): Promise<unknown> {
    if (!process?.stdin?.writable) {
      throw new Error("MCP client not connected");
    }

    const request = createJsonRpcRequest(method, params);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingRequests.delete(request.id);
        reject(new Error(`MCP request timeout: ${method}`));
      }, 10000);

      pendingRequests.set(request.id, {
        resolve: (value) => { clearTimeout(timeout); resolve(value); },
        reject: (error) => { clearTimeout(timeout); reject(error); },
      });

      process!.stdin!.write(JSON.stringify(request) + "\n");
    });
  }

  const client: McpClient = {
    get serverId() { return config.id; },
    get status() { return status; },
    set status(value: McpClientStatus) { status = value; },

    async connect() {
      status = "connecting";
      try {
        const child = spawn(config.command, [...config.args], {
          stdio: ["pipe", "pipe", "pipe"],
          cwd: config.cwd,
          env: { ...globalThis.process.env, ...config.env },
        });

        await new Promise<void>((resolve, reject) => {
          child.on("error", (error) => {
            status = "error";
            reject(error);
          });

          child.on("spawn", () => resolve());

          // Fallback timeout
          setTimeout(() => {
            if (status === "connecting") {
              status = "error";
              reject(new Error("MCP server spawn timeout"));
            }
          }, 5000);
        });

        process = child;
        readline = createInterface({ input: child.stdout! });
        readline.on("line", handleLine);

        child.on("exit", () => {
          status = "disconnected";
          process = null;
          readline = null;
        });

        // Initialize MCP protocol
        await sendRequest("initialize", {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "novelfork", version: "0.1.0" },
        });

        status = "connected";
      } catch (error) {
        status = "error";
        throw error;
      }
    },

    async disconnect() {
      if (process) {
        process.kill();
        process = null;
        readline = null;
      }
      status = "disconnected";
    },

    async listTools(): Promise<McpTool[]> {
      const result = await sendRequest("tools/list") as { tools?: McpTool[] };
      return result?.tools ?? [];
    },

    async callTool(name: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
      const result = await sendRequest("tools/call", { name, arguments: args }) as McpToolCallResult;
      return result;
    },
  };

  return client;
}
