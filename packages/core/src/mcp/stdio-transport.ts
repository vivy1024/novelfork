/**
 * MCP Stdio Transport
 *
 * Spawns a child process and communicates via stdin/stdout using JSON-RPC.
 * Based on AstrBot MCPClient stdio implementation.
 */

import { EventEmitter } from "node:events";
import { spawnProcess, type ProcessHandle } from "../runtime/process-adapter.js";
import type {
  MCPRequest,
  MCPResponse,
  MCPNotification,
} from "./protocol.js";

export interface StdioTransportConfig {
  readonly command: string;
  readonly args?: ReadonlyArray<string>;
  readonly env?: Readonly<Record<string, string>>;
  readonly timeout?: number;
}

export interface StdioTransportEvents {
  message: (message: MCPResponse | MCPNotification) => void;
  error: (error: Error) => void;
  close: (code: number | null) => void;
  stdout: (data: string) => void;
  stderr: (data: string) => void;
}

export class StdioTransport extends EventEmitter {
  private process: ProcessHandle | null = null;
  private buffer = "";
  private requestId = 0;
  private pendingRequests = new Map<
    string | number,
    {
      resolve: (value: MCPResponse) => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
    }
  >();

  constructor(private readonly config: StdioTransportConfig) {
    super();
  }

  async connect(): Promise<void> {
    if (this.process) {
      throw new Error("Transport already connected");
    }

    const env = {
      ...process.env,
      ...this.config.env,
    };

    this.process = await spawnProcess(this.config.command, this.config.args ?? [], {
      env: this.config.env,
    });

    this.process.onStdout((data) => {
      this.emit("stdout", data);
      this.handleData(data);
    });

    this.process.onStderr((data) => {
      this.emit("stderr", data);
    });

    this.process.onError((error) => {
      this.emit("error", error);
    });

    this.process.onClose((code) => {
      this.cleanup();
      this.emit("close", code);
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Process startup timeout"));
      }, this.config.timeout ?? 180000);

      if (this.process?.isAlive()) {
        clearTimeout(timeout);
        resolve();
      }
    });
  }

  async disconnect(): Promise<void> {
    if (!this.process) return;

    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Transport disconnected"));
      this.pendingRequests.delete(id);
    }

    this.process.kill();
    this.process = null;
    this.buffer = "";
  }

  async sendRequest(request: MCPRequest): Promise<MCPResponse> {
    if (!this.process) {
      throw new Error("Transport not connected");
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(request.id);
        reject(new Error(`Request ${request.id} timeout`));
      }, this.config.timeout ?? 180000);

      this.pendingRequests.set(request.id, { resolve, reject, timeout });

      const message = JSON.stringify(request) + "\n";
      this.process!.writeStdin(message, (err) => {
        if (err) {
          clearTimeout(timeout);
          this.pendingRequests.delete(request.id);
          reject(err);
        }
      });

    });
  }

  private handleData(data: string): void {
    this.buffer += data;

    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);

      if (!line) continue;

      try {
        const message = JSON.parse(line);
        this.handleMessage(message);
      } catch (e) {
        this.emit("error", new Error(`Failed to parse message: ${line}`));
      }
    }
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

  private cleanup(): void {
    for (const [id, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Process closed"));
      this.pendingRequests.delete(id);
    }
    this.buffer = "";
  }

  nextRequestId(): string {
    return `req-${++this.requestId}`;
  }

  isConnected(): boolean {
    return this.process !== null && this.process.isAlive();
  }
}
