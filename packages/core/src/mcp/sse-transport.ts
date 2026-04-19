/**
 * MCP SSE Transport
 *
 * Connects to an MCP server via Server-Sent Events (SSE).
 * Sends requests via POST and receives responses via SSE stream.
 */

import { EventEmitter } from "node:events";
import type {
  MCPRequest,
  MCPResponse,
  MCPNotification,
} from "./protocol.js";

export interface SSETransportConfig {
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly timeout?: number;
}

export class SSETransport extends EventEmitter {
  private eventSource: any | null = null;
  private requestId = 0;
  private pendingRequests = new Map<
    string | number,
    {
      resolve: (value: MCPResponse) => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
    }
  >();

  constructor(private readonly config: SSETransportConfig) {
    super();
  }

  async connect(): Promise<void> {
    if (this.eventSource) {
      throw new Error("Transport already connected");
    }

    // Note: For Node.js, use eventsource package which supports headers
    // For browser, standard EventSource doesn't support custom headers
    let EventSourceImpl: any;

    if (typeof (globalThis as any).EventSource !== "undefined") {
      EventSourceImpl = (globalThis as any).EventSource;
      this.eventSource = new EventSourceImpl(this.config.url);
    } else {
      // Node.js: use eventsource package
      const { default: NodeEventSource } = await import("eventsource");
      this.eventSource = new NodeEventSource(this.config.url, {
        headers: this.config.headers,
      });
    }

    this.eventSource.onmessage = (event: any) => {
      try {
        const message = JSON.parse(event.data);
        this.handleMessage(message);
      } catch (e) {
        this.emit("error", new Error(`Failed to parse SSE message: ${event.data}`));
      }
    };

    this.eventSource.onerror = (error: any) => {
      this.emit("error", new Error("SSE connection error"));
      this.emit("close", null);
    };

    // Wait for connection to open
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("SSE connection timeout"));
      }, this.config.timeout ?? 180000);

      this.eventSource!.onopen = () => {
        clearTimeout(timeout);
        resolve();
      };
    });
  }

  async disconnect(): Promise<void> {
    if (!this.eventSource) return;

    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Transport disconnected"));
      this.pendingRequests.delete(id);
    }

    this.eventSource.close();
    this.eventSource = null;
  }

  async sendRequest(request: MCPRequest): Promise<MCPResponse> {
    if (!this.eventSource) {
      throw new Error("Transport not connected");
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(request.id);
        reject(new Error(`Request ${request.id} timeout`));
      }, this.config.timeout ?? 180000);

      this.pendingRequests.set(request.id, { resolve, reject, timeout });

      // Send request via POST
      fetch(this.config.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.config.headers,
        },
        body: JSON.stringify(request),
      }).catch((err) => {
        clearTimeout(timeout);
        this.pendingRequests.delete(request.id);
        reject(err);
      });
    });
  }

  private handleMessage(message: MCPResponse | MCPNotification): void {
    if ("id" in message) {
      // Response
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(message.id);
        pending.resolve(message);
      }
    } else {
      // Notification
      this.emit("message", message);
    }
  }

  nextRequestId(): string {
    return `req-${++this.requestId}`;
  }

  isConnected(): boolean {
    return this.eventSource !== null && this.eventSource.readyState === EventSource.OPEN;
  }
}
