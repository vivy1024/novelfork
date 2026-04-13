/**
 * MCP Protocol Messages
 *
 * Based on MCP JSON-RPC 2.0 specification
 */

export interface MCPRequest {
  readonly jsonrpc: "2.0";
  readonly id: string | number;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

export interface MCPResponse {
  readonly jsonrpc: "2.0";
  readonly id: string | number;
  readonly result?: unknown;
  readonly error?: MCPError;
}

export interface MCPNotification {
  readonly jsonrpc: "2.0";
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

export interface MCPError {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

/**
 * MCP standard methods
 */
export const MCPMethods = {
  // Initialization
  INITIALIZE: "initialize",
  INITIALIZED: "notifications/initialized",

  // Tools
  LIST_TOOLS: "tools/list",
  CALL_TOOL: "tools/call",

  // Resources
  LIST_RESOURCES: "resources/list",
  READ_RESOURCE: "resources/read",

  // Prompts
  LIST_PROMPTS: "prompts/list",
  GET_PROMPT: "prompts/get",

  // Logging
  LOG_MESSAGE: "notifications/message",
} as const;

/**
 * MCP error codes
 */
export const MCPErrorCodes = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  SERVER_ERROR: -32000,
} as const;

/**
 * Initialize request params
 */
export interface MCPInitializeParams {
  readonly protocolVersion: string;
  readonly capabilities: MCPClientCapabilities;
  readonly clientInfo: {
    readonly name: string;
    readonly version: string;
  };
}

/**
 * Initialize response result
 */
export interface MCPInitializeResult {
  readonly protocolVersion: string;
  readonly capabilities: MCPServerCapabilities;
  readonly serverInfo: {
    readonly name: string;
    readonly version: string;
  };
}

/**
 * Client capabilities
 */
export interface MCPClientCapabilities {
  readonly tools?: {
    readonly listChanged?: boolean;
  };
  readonly resources?: {
    readonly subscribe?: boolean;
    readonly listChanged?: boolean;
  };
  readonly prompts?: {
    readonly listChanged?: boolean;
  };
}

/**
 * Server capabilities
 */
export interface MCPServerCapabilities {
  readonly tools?: {
    readonly listChanged?: boolean;
  };
  readonly resources?: {
    readonly subscribe?: boolean;
    readonly listChanged?: boolean;
  };
  readonly prompts?: {
    readonly listChanged?: boolean;
  };
  readonly logging?: Record<string, unknown>;
}

/**
 * Tools list response
 */
export interface MCPToolsListResult {
  readonly tools: ReadonlyArray<{
    readonly name: string;
    readonly description?: string;
    readonly inputSchema: Record<string, unknown>;
  }>;
}

/**
 * Tool call params
 */
export interface MCPToolCallParams {
  readonly name: string;
  readonly arguments?: Record<string, unknown>;
}

/**
 * Tool call result
 */
export interface MCPToolCallResult {
  readonly content: ReadonlyArray<{
    readonly type: string;
    readonly text?: string;
    readonly data?: string;
    readonly mimeType?: string;
    readonly uri?: string;
    [key: string]: unknown;
  }>;
  readonly isError?: boolean;
}
