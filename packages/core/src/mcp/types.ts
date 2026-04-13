/**
 * MCP (Model Context Protocol) Client Types
 *
 * Based on MCP specification and AstrBot MCPClient implementation.
 * Supports stdio and SSE transports with auto-reconnection.
 */

/**
 * MCP transport types
 */
export type MCPTransportType = "stdio" | "sse";

/**
 * MCP server configuration
 */
export interface MCPServerConfig {
  /** Server identifier */
  readonly name: string;
  /** Transport type */
  readonly transport: MCPTransportType;
  /** Command to execute (stdio only) */
  readonly command?: string;
  /** Command arguments (stdio only) */
  readonly args?: ReadonlyArray<string>;
  /** Environment variables */
  readonly env?: Readonly<Record<string, string>>;
  /** SSE endpoint URL (sse only) */
  readonly url?: string;
  /** SSE headers (sse only) */
  readonly headers?: Readonly<Record<string, string>>;
  /** Startup timeout in milliseconds (default: 180000) */
  readonly timeout?: number;
  /** Enable auto-reconnection (default: true) */
  readonly autoReconnect?: boolean;
  /** Whether server is enabled (default: true) */
  readonly enabled?: boolean;
}

/**
 * MCP tool definition (from server)
 */
export interface MCPTool {
  /** Tool name */
  readonly name: string;
  /** Tool description */
  readonly description?: string;
  /** Input schema (JSON Schema) */
  readonly inputSchema: MCPToolInputSchema;
}

/**
 * MCP tool input schema (JSON Schema)
 * Note: MCP allows type to be string or array (AstrBot compatibility)
 */
export interface MCPToolInputSchema {
  readonly type: string | ReadonlyArray<string>;
  readonly properties?: Readonly<Record<string, unknown>>;
  readonly required?: ReadonlyArray<string>;
  readonly additionalProperties?: boolean;
  [key: string]: unknown;
}

/**
 * MCP tool call request
 */
export interface MCPToolCallRequest {
  /** Tool name */
  readonly name: string;
  /** Tool arguments */
  readonly arguments?: Record<string, unknown>;
}

/**
 * MCP tool call response
 */
export interface MCPToolCallResponse {
  /** Whether call succeeded */
  readonly success: boolean;
  /** Result content (if success) */
  readonly content?: ReadonlyArray<MCPContent>;
  /** Error message (if failed) */
  readonly error?: string;
  /** Whether error is retryable */
  readonly isRetryable?: boolean;
}

/**
 * MCP content types
 */
export type MCPContent = MCPTextContent | MCPImageContent | MCPResourceContent;

export interface MCPTextContent {
  readonly type: "text";
  readonly text: string;
}

export interface MCPImageContent {
  readonly type: "image";
  readonly data: string;
  readonly mimeType: string;
}

export interface MCPResourceContent {
  readonly type: "resource";
  readonly uri: string;
  readonly mimeType?: string;
  readonly text?: string;
}

/**
 * MCP client connection state
 */
export type MCPConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "failed";

/**
 * MCP client events
 */
export interface MCPClientEvents {
  /** Connection state changed */
  onStateChange?: (state: MCPConnectionState) => void;
  /** Tools discovered/updated */
  onToolsDiscovered?: (tools: ReadonlyArray<MCPTool>) => void;
  /** Error occurred */
  onError?: (error: Error) => void;
  /** Server stdout/stderr (stdio only) */
  onLog?: (level: "stdout" | "stderr", message: string) => void;
}

/**
 * MCP client interface
 */
export interface MCPClient {
  /** Server configuration */
  readonly config: MCPServerConfig;
  /** Current connection state */
  readonly state: MCPConnectionState;
  /** Discovered tools */
  readonly tools: ReadonlyArray<MCPTool>;

  /** Connect to MCP server */
  connect(): Promise<void>;
  /** Disconnect from MCP server */
  disconnect(): Promise<void>;
  /** Call a tool */
  callTool(request: MCPToolCallRequest): Promise<MCPToolCallResponse>;
  /** List available tools */
  listTools(): Promise<ReadonlyArray<MCPTool>>;
}
