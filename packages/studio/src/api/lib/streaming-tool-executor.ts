/**
 * Streaming Tool Executor — executes tools as they arrive during streaming.
 *
 * When the model streams a response containing multiple tool_use blocks,
 * this executor starts running tools as soon as each block is complete,
 * rather than waiting for the entire response to finish streaming.
 *
 * Concurrency rules:
 * - Read-only tools (Read, Glob, Grep, WebSearch, etc.) can run in parallel
 * - Write tools must run exclusively (no other tools running simultaneously)
 * - Results are buffered and emitted in the order tools were received
 *
 * Integration: When generate() becomes an AsyncGenerator, this replaces
 * the current sequential/batch execution model.
 */

import type { SessionToolExecutionResult } from "../../shared/agent-native-workspace.js";

// ── Types ────────────────────────────────────────────────────────────────

export interface StreamingToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type ToolExecutorFn = (tool: StreamingToolCall) => Promise<SessionToolExecutionResult>;

type ToolStatus = "queued" | "executing" | "completed";

interface TrackedTool {
  call: StreamingToolCall;
  status: ToolStatus;
  isConcurrencySafe: boolean;
  promise?: Promise<void>;
  result?: SessionToolExecutionResult;
}

export interface StreamingToolResult {
  id: string;
  name: string;
  result: SessionToolExecutionResult;
}

// ── Concurrency Safety ───────────────────────────────────────────────────

const CONCURRENT_SAFE_TOOLS = new Set([
  "Read", "Glob", "Grep", "WebSearch", "WebFetch",
  "GetGoals", "LearningGuide", "Recall",
  "jingwei.read", "chapter.read", "cockpit.snapshot",
  "chapter.list", "presets.read",
]);

function isConcurrencySafe(toolName: string): boolean {
  return CONCURRENT_SAFE_TOOLS.has(toolName);
}

// ── StreamingToolExecutor ────────────────────────────────────────────────

export class StreamingToolExecutor {
  private tools: TrackedTool[] = [];
  private executeTool: ToolExecutorFn;
  private aborted = false;

  constructor(executeTool: ToolExecutorFn) {
    this.executeTool = executeTool;
  }

  /**
   * Add a tool to the execution queue.
   * Will start executing immediately if concurrency conditions allow.
   */
  addTool(call: StreamingToolCall): void {
    if (this.aborted) return;

    const tracked: TrackedTool = {
      call,
      status: "queued",
      isConcurrencySafe: isConcurrencySafe(call.name),
    };
    this.tools.push(tracked);
    void this.processQueue();
  }

  /**
   * Abort all pending tools. Queued tools won't start.
   */
  abort(): void {
    this.aborted = true;
  }

  /**
   * Wait for all tools to complete and return results in order.
   */
  async getAllResults(): Promise<StreamingToolResult[]> {
    await this.waitForAll();

    return this.tools
      .filter(t => t.status === "completed" && t.result)
      .map(t => ({
        id: t.call.id,
        name: t.call.name,
        result: t.result!,
      }));
  }

  /**
   * Get any completed results that haven't been consumed yet (non-blocking).
   * Returns results in order, stopping at the first non-completed tool.
   */
  *getCompletedResults(): Generator<StreamingToolResult> {
    for (const tool of this.tools) {
      if (tool.status === "completed" && tool.result) {
        yield { id: tool.call.id, name: tool.call.name, result: tool.result };
      } else if (tool.status !== "completed") {
        // Maintain order: don't yield later tools before earlier ones complete
        if (!tool.isConcurrencySafe) break;
      }
    }
  }

  /**
   * Check if there are any unfinished tools.
   */
  hasUnfinishedTools(): boolean {
    return this.tools.some(t => t.status !== "completed");
  }

  /**
   * Get count of tools by status.
   */
  getStatus(): { queued: number; executing: number; completed: number } {
    let queued = 0, executing = 0, completed = 0;
    for (const t of this.tools) {
      if (t.status === "queued") queued++;
      else if (t.status === "executing") executing++;
      else completed++;
    }
    return { queued, executing, completed };
  }

  // ── Private ──────────────────────────────────────────────────────────

  private canExecute(tool: TrackedTool): boolean {
    const executing = this.tools.filter(t => t.status === "executing");
    if (executing.length === 0) return true;
    // Both must be safe for parallel execution
    return tool.isConcurrencySafe && executing.every(t => t.isConcurrencySafe);
  }

  private async processQueue(): Promise<void> {
    for (const tool of this.tools) {
      if (tool.status !== "queued") continue;
      if (this.aborted) {
        tool.status = "completed";
        tool.result = { ok: false, error: "aborted", summary: "工具执行已中断" };
        continue;
      }

      if (this.canExecute(tool)) {
        tool.status = "executing";
        tool.promise = this.runTool(tool);
        // For non-concurrent tools, stop processing queue
        if (!tool.isConcurrencySafe) break;
      } else {
        // Can't execute yet
        if (!tool.isConcurrencySafe) break;
      }
    }
  }

  private async runTool(tool: TrackedTool): Promise<void> {
    try {
      tool.result = await this.executeTool(tool.call);
    } catch (err) {
      tool.result = {
        ok: false,
        error: "execution-error",
        summary: `工具 ${tool.call.name} 执行异常: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    tool.status = "completed";
    // Process next in queue
    void this.processQueue();
  }

  private async waitForAll(): Promise<void> {
    const promises = this.tools
      .filter(t => t.promise && t.status === "executing")
      .map(t => t.promise!);
    if (promises.length > 0) {
      await Promise.all(promises);
    }
    // Process any remaining queued tools
    if (this.tools.some(t => t.status === "queued")) {
      await this.processQueue();
      // Wait again for newly started tools
      await this.waitForAll();
    }
  }
}
