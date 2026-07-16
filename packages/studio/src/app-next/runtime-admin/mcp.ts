import {
  createRuntimeAdminRequest,
  encodePathSegment,
  jsonRequest,
  type OkResponse,
  type RuntimeAdminClientOptions,
} from "./client";

export type McpTransport = "stdio" | "streamable-http" | "sse";
export type McpBehavior = "readOnly" | "readWrite" | "ask" | "deny";
export type McpServerConnectionStatus = "connected" | "disconnected" | "connecting" | "error";

export interface McpToolPermission {
  readonly toolName: string;
  readonly behavior: McpBehavior;
  readonly enabled?: boolean;
}

export interface McpToolPermissionPatch {
  readonly toolName: string;
  readonly behavior?: McpBehavior | "allow" | null;
  readonly enabled?: boolean;
}

export interface McpTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: unknown;
}

export interface McpServerInput {
  readonly name?: string;
  readonly transport?: McpTransport;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly url?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly enabled?: boolean;
  readonly defaultBehavior?: McpBehavior | "allow";
  readonly toolPermissions?: readonly McpToolPermission[];
}

export interface McpServerPatch extends Omit<Partial<McpServerInput>, "defaultBehavior"> {
  readonly defaultBehavior?: McpBehavior | "allow" | null;
  readonly toolPermissionPatch?: McpToolPermissionPatch;
}

export interface McpServerConfig extends Required<Pick<McpServerInput, "name" | "transport" | "enabled">> {
  readonly id: string;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly url?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly defaultBehavior?: McpBehavior;
  readonly toolPermissions?: readonly McpToolPermission[];
}

export interface McpServerStatus extends McpServerConfig {
  readonly status: McpServerConnectionStatus;
  readonly error?: string;
  readonly tools: readonly McpTool[];
}

export interface McpExternalTool extends McpTool {
  readonly serverName: string;
  readonly serverId: string;
  readonly source: "external";
}

export interface McpTestResult {
  readonly ok: boolean;
  readonly tools?: readonly McpTool[];
  readonly error?: string;
}

export type McpConnectResult =
  | McpServerStatus
  | { readonly id: string; readonly status: "error"; readonly error?: string };

export function createMcpClient(options: RuntimeAdminClientOptions = {}) {
  const request = createRuntimeAdminRequest(options);
  return {
    list: () => request<{ readonly servers: readonly McpServerStatus[] }>("/api/mcp/servers"),
    create: (input: McpServerInput) =>
      request<McpServerConfig>("/api/mcp/servers", jsonRequest("POST", input)),
    patch: (id: string, patch: McpServerPatch) =>
      request<McpServerConfig>(
        `/api/mcp/servers/${encodePathSegment(id)}`,
        jsonRequest("PATCH", patch),
      ),
    delete: (id: string) =>
      request<OkResponse>(`/api/mcp/servers/${encodePathSegment(id)}`, { method: "DELETE" }),
    connect: (id: string) =>
      request<McpConnectResult>(`/api/mcp/servers/${encodePathSegment(id)}/connect`, {
        method: "POST",
      }),
    disconnect: (id: string) =>
      request<OkResponse>(`/api/mcp/servers/${encodePathSegment(id)}/disconnect`, {
        method: "POST",
      }),
    test: (input: McpServerInput) =>
      request<McpTestResult>("/api/mcp/servers/test", jsonRequest("POST", input)),
    import: (json: unknown) =>
      request<{ readonly added: number; readonly skipped: number }>(
        "/api/mcp/servers/import",
        jsonRequest("POST", { json }),
      ),
    tools: () => request<{ readonly tools: readonly McpExternalTool[] }>("/api/mcp/tools"),
  } as const;
}
