/**
 * MCP Client Implementation
 *
 * Manages connection to MCP servers, tool discovery, and tool execution.
 * Supports stdio and SSE transports with auto-reconnection.
 * Based on AstrBot MCPClient and MCP specification.
 */

import type {
  MCPClient,
  MCPServerConfig,
  MCPConnectionState,
  MCPClientEvents,
  MCPTool,
  MCPToolCallRequest,
  MCPToolCallResponse,
  MCPContent,
} from "./types.js";
import type {
  MCPRequest,
  MCPResponse,
  MCPInitializeParams,
  MCPInitializeResult,
  MCPToolsListResult,
  MCPToolCallParams,
  MCPToolCallResult,
} from "./protocol.js";
import { MCPMethods, MCPErrorCodes } from "./protocol.js";
import { StdioTransport } from "./stdio-transport.js";
import { SSETransport } from "./sse-transport.js";

type Transport = StdioTransport | SSETransport;

export class MCPClientImpl implements MCPClient {
  private transport: Transport | null = null;
  private _state: MCPConnectionState = "disconnected";
  private _tools: MCPTool[] = [];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(
    public readonly config: MCPServerConfig,
    private readonly events?: MCPClientEvents,
  ) {}

  get state(): MCPConnectionState {
    return this._state;
  }

  get tools(): ReadonlyArray<MCPTool> {
    return this._tools;
  }

  async connect(): Promise<void> {
    if (this._state === "connected" || this._state === "connecting") {
      return;
    }

    this.setState("connecting");

    try {
      // Create transport
      this.transport = this.createTransport();

      // Setup transport event handlers
      (this.transport as any).on("error", (error: Error) => {
        this.events?.onError?.(error);
      });

      (this.transport as any).on("close", () => {
        this.handleDisconnect();
      });

      if (this.transport instanceof StdioTransport) {
        this.transport.on("stdout", (data: string) => {
          this.events?.onLog?.("stdout", data);
        });
        this.transport.on("stderr", (data: string) => {
          this.events?.onLog?.("stderr", data);
        });
      }

      // Connect transport
      await this.transport.connect();

      // Initialize MCP session
      await this.initialize();

      // Discover tools
      await this.discoverTools();

      this.setState("connected");
      this.reconnectAttempts = 0;
    } catch (error) {
      this.setState("failed");
      await this.cleanup();
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    await this.cleanup();
    this.setState("disconnected");
  }

  async callTool(request: MCPToolCallRequest): Promise<MCPToolCallResponse> {
    if (!this.transport || this._state !== "connected") {
      return {
        success: false,
        error: "Client not connected",
        isRetryable: true,
      };
    }

    try {
      const params: MCPToolCallParams = {
        name: request.name,
        arguments: request.arguments,
      };

      const response = await this.sendRequest<MCPToolCallResult>({
        jsonrpc: "2.0",
        id: this.transport.nextRequestId(),
        method: MCPMethods.CALL_TOOL,
        params: params as any,
      });

      if (response.error) {
        return {
          success: false,
          error: response.error.message,
          isRetryable: response.error.code !== MCPErrorCodes.INVALID_PARAMS,
        };
      }

      const result = response.result as MCPToolCallResult;
      return {
        success: !result.isError,
        content: result.content as ReadonlyArray<MCPContent>,
        error: result.isError ? "Tool execution failed" : undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        isRetryable: true,
      };
    }
  }

  async listTools(): Promise<ReadonlyArray<MCPTool>> {
    return this._tools;
  }

  private createTransport(): Transport {
    if (this.config.transport === "stdio") {
      if (!this.config.command) {
        throw new Error("stdio transport requires command");
      }
      return new StdioTransport({
        command: this.config.command,
        args: this.config.args,
        env: this.config.env,
        timeout: this.config.timeout,
      });
    } else {
      if (!this.config.url) {
        throw new Error("sse transport requires url");
      }
      return new SSETransport({
        url: this.config.url,
        headers: this.config.headers,
        timeout: this.config.timeout,
      });
    }
  }

  private async initialize(): Promise<void> {
    if (!this.transport) throw new Error("Transport not available");

    const params: MCPInitializeParams = {
      protocolVersion: "2024-11-05",
      capabilities: {
        tools: { listChanged: true },
      },
      clientInfo: {
        name: "novelfork-mcp-client",
        version: "1.0.0",
      },
    };

    const response = await this.sendRequest<MCPInitializeResult>({
      jsonrpc: "2.0",
      id: this.transport.nextRequestId(),
      method: MCPMethods.INITIALIZE,
      params: params as any,
    });

    if (response.error) {
      throw new Error(`Initialize failed: ${response.error.message}`);
    }

    // Send initialized notification
    await this.sendNotification({
      jsonrpc: "2.0",
      method: MCPMethods.INITIALIZED,
    });
  }

  private async discoverTools(): Promise<void> {
    if (!this.transport) throw new Error("Transport not available");

    const response = await this.sendRequest<MCPToolsListResult>({
      jsonrpc: "2.0",
      id: this.transport.nextRequestId(),
      method: MCPMethods.LIST_TOOLS,
    });

    if (response.error) {
      throw new Error(`List tools failed: ${response.error.message}`);
    }

    const result = response.result as MCPToolsListResult;
    this._tools = result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: this.normalizeSchema(tool.inputSchema),
    }));

    this.events?.onToolsDiscovered?.(this._tools);
  }

  private normalizeSchema(schema: Record<string, unknown>): any {
    // Handle MCP schema where type can be string or array (AstrBot compatibility)
    const normalized = { ...schema };
    if (Array.isArray(normalized.type)) {
      normalized.type = normalized.type[0];
    }
    return normalized;
  }

  private async sendRequest<T>(request: MCPRequest): Promise<MCPResponse> {
    if (!this.transport) throw new Error("Transport not available");
    return await this.transport.sendRequest(request);
  }

  private async sendNotification(notification: { jsonrpc: "2.0"; method: string; params?: Record<string, unknown> }): Promise<void> {
    // Notifications don't expect responses
    // For stdio, just write to stdin; for SSE, POST without waiting
    if (!this.transport) throw new Error("Transport not available");

    const request: MCPRequest = {
      ...notification,
      id: this.transport.nextRequestId(),
    };

    // Fire and forget
    this.transport.sendRequest(request).catch(() => {});
  }

  private async cleanup(): Promise<void> {
    if (this.transport) {
      await this.transport.disconnect();
      this.transport = null;
    }
    this._tools = [];
  }

  private setState(state: MCPConnectionState): void {
    if (this._state === state) return;
    this._state = state;
    this.events?.onStateChange?.(state);
  }

  private handleDisconnect(): void {
    if (this._state === "disconnected") return;

    this.cleanup();

    // Auto-reconnect if enabled
    if (this.config.autoReconnect !== false && this.reconnectAttempts < this.maxReconnectAttempts) {
      this.setState("reconnecting");
      this.reconnectAttempts++;
      const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

      this.reconnectTimer = setTimeout(() => {
        this.connect().catch((error) => {
          this.events?.onError?.(error);
        });
      }, delay);
    } else {
      this.setState("failed");
    }
  }
}
