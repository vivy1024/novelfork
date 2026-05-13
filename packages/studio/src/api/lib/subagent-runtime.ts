/**
 * Subagent Runtime — independent agent execution with its own system prompt, model, and tool permissions.
 *
 * 对标：
 * - Claude Code CLI: src/tools/AgentTool/runAgent.ts
 *   - AsyncGenerator<Message, void> 模式
 *   - for await (const message of query({...})) 循环
 *   - abort signal 传播
 *   - sidechain transcript 记录
 *   - fork context 过滤 (filterIncompleteToolCalls)
 * - Codex CLI: subagents with sandbox/approval inheritance
 */

export interface SubagentConfig {
  readonly id: string;
  readonly name: string;
  readonly systemPrompt: string;
  readonly modelId: string;
  readonly providerId: string;
  readonly tools: readonly string[];
  readonly maxSteps: number;
  /** Git worktree 路径 — 子代理在独立 worktree 中执行，避免与主工作区冲突 */
  readonly worktree?: string;
}

export interface SubagentGenerateInput {
  readonly systemPrompt: string;
  readonly modelId: string;
  readonly providerId: string;
  readonly messages: readonly SubagentMessage[];
  readonly tools?: readonly string[];
}

export interface SubagentMessage {
  readonly role: "user" | "assistant" | "tool_result";
  readonly content: string;
  readonly toolUseId?: string;
  readonly toolName?: string;
}

export interface SubagentGenerateResult {
  readonly success: boolean;
  readonly type: "message" | "tool_use";
  readonly content?: string;
  readonly toolUses?: readonly { readonly id: string; readonly name: string; readonly input: Record<string, unknown> }[];
  readonly metadata?: { readonly modelId: string; readonly providerId: string };
}

export interface SubagentToolResult {
  readonly toolName: string;
  readonly toolUseId: string;
  readonly result: { readonly ok: boolean; readonly summary: string; readonly data?: unknown };
}

export interface SubagentResult {
  readonly ok: boolean;
  readonly content?: string;
  readonly stopReason?: "completed" | "max_steps" | "error" | "aborted";
  readonly toolResults: readonly SubagentToolResult[];
  readonly error?: string;
  /** 对标 Claude: sidechain transcript 事件 */
  readonly transcript: readonly SubagentTranscriptEvent[];
}

/** 对标 Claude: recordSidechainTranscript */
export interface SubagentTranscriptEvent {
  readonly type: "generate" | "tool_call" | "tool_result" | "message" | "error";
  readonly agentId: string;
  readonly timestamp: number;
  readonly content?: string;
  readonly toolName?: string;
  readonly toolUseId?: string;
}

export interface RunSubagentInput {
  readonly config: SubagentConfig;
  readonly prompt: string;
  readonly generate: (input: SubagentGenerateInput) => Promise<SubagentGenerateResult>;
  readonly executeTool?: (toolName: string, input: Record<string, unknown>, options?: { cwd?: string }) => Promise<{ ok: boolean; summary: string; data?: unknown }>;
  /** 对标 Claude: abortController.signal */
  readonly signal?: AbortSignal;
  /** 对标 Claude: fork context messages (filterIncompleteToolCalls) */
  readonly forkContext?: readonly SubagentMessage[];
}

/**
 * 对标 Claude runAgent(): AsyncGenerator 模式的子代理执行。
 * 返回 AsyncGenerator 允许调用者逐步消费子代理事件。
 */
export async function* runSubagentStream(input: RunSubagentInput): AsyncGenerator<SubagentTranscriptEvent, SubagentResult> {
  const { config, prompt, generate, executeTool, signal, forkContext } = input;

  // 对标 Claude: filterIncompleteToolCalls for fork context
  const contextMessages: SubagentMessage[] = forkContext
    ? [...forkContext.filter((m) => m.role !== "tool_result" || m.toolUseId)]
    : [];
  const messages: SubagentMessage[] = [...contextMessages, { role: "user", content: prompt }];
  const toolResults: SubagentToolResult[] = [];
  const transcript: SubagentTranscriptEvent[] = [];
  let steps = 0;

  while (steps < config.maxSteps) {
    // 对标 Claude: abort signal check
    if (signal?.aborted) {
      return { ok: false, stopReason: "aborted", toolResults, transcript, error: "Aborted" };
    }

    const generateEvent: SubagentTranscriptEvent = { type: "generate", agentId: config.id, timestamp: Date.now() };
    transcript.push(generateEvent);
    yield generateEvent;

    const result = await generate({
      systemPrompt: config.systemPrompt,
      modelId: config.modelId,
      providerId: config.providerId,
      messages,
      tools: config.tools,
    });

    if (!result.success) {
      const errorEvent: SubagentTranscriptEvent = { type: "error", agentId: config.id, timestamp: Date.now(), content: "Generation failed" };
      transcript.push(errorEvent);
      yield errorEvent;
      return { ok: false, stopReason: "error", toolResults, transcript, error: "Generation failed" };
    }

    if (result.type === "message") {
      const msgEvent: SubagentTranscriptEvent = { type: "message", agentId: config.id, timestamp: Date.now(), content: result.content };
      transcript.push(msgEvent);
      yield msgEvent;
      return { ok: true, content: result.content, stopReason: "completed", toolResults, transcript };
    }

    // Tool use loop
    if (result.toolUses && result.toolUses.length > 0) {
      for (const toolUse of result.toolUses) {
        steps++;
        if (steps > config.maxSteps) {
          return { ok: false, stopReason: "max_steps", toolResults, transcript };
        }

        if (signal?.aborted) {
          return { ok: false, stopReason: "aborted", toolResults, transcript, error: "Aborted" };
        }

        const callEvent: SubagentTranscriptEvent = { type: "tool_call", agentId: config.id, timestamp: Date.now(), toolName: toolUse.name, toolUseId: toolUse.id };
        transcript.push(callEvent);
        yield callEvent;

        const toolResult = executeTool
          ? await executeTool(toolUse.name, toolUse.input)
          : { ok: false, summary: `Tool ${toolUse.name} not available in subagent` };

        toolResults.push({ toolName: toolUse.name, toolUseId: toolUse.id, result: toolResult });

        const resultEvent: SubagentTranscriptEvent = { type: "tool_result", agentId: config.id, timestamp: Date.now(), toolName: toolUse.name, toolUseId: toolUse.id, content: toolResult.summary };
        transcript.push(resultEvent);
        yield resultEvent;

        messages.push({ role: "assistant", content: `Calling ${toolUse.name}` });
        messages.push({ role: "tool_result", content: toolResult.summary, toolUseId: toolUse.id, toolName: toolUse.name });
      }
    }
  }

  return { ok: false, stopReason: "max_steps", toolResults, transcript };
}

/**
 * 简化接口：运行子代理并收集所有结果（非流式）。
 * 对标 Claude: 等待 runAgent() generator 完成。
 */
export async function runSubagent(input: RunSubagentInput): Promise<SubagentResult> {
  const generator = runSubagentStream(input);
  let result: IteratorResult<SubagentTranscriptEvent, SubagentResult>;
  do {
    result = await generator.next();
  } while (!result.done);
  return result.value;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3.1 — Subagent Detach/Attach Registry
// ─────────────────────────────────────────────────────────────────────────────

export type SubagentState = "running" | "completed" | "failed" | "detached" | "interrupted";

export interface SubagentEntry {
  readonly id: string;
  readonly sessionId: string;
  readonly config: SubagentConfig;
  readonly state: SubagentState;
  readonly result?: SubagentResult;
  readonly createdAt: number;
  readonly completedAt?: number;
  readonly detachedAt?: number;
}

/**
 * 子代理注册表 — 追踪所有子代理的生命周期状态。
 *
 * 对标：
 * - Claude Code: AgentTool 内部的 sidechain 管理
 * - Codex CLI: subagent registry with detach/attach semantics
 */
export class SubagentRegistry {
  private entries = new Map<string, SubagentEntry>();

  /** 注册一个新的子代理（初始状态为 running） */
  register(sessionId: string, config: SubagentConfig): void {
    const entry: SubagentEntry = {
      id: config.id,
      sessionId,
      config,
      state: "running",
      createdAt: Date.now(),
    };
    this.entries.set(config.id, entry);
  }

  /** 更新子代理状态，可选附带结果 */
  updateState(id: string, state: SubagentState, result?: SubagentResult): void {
    const entry = this.entries.get(id);
    if (!entry) return;

    const updated: SubagentEntry = {
      ...entry,
      state,
      result: result ?? entry.result,
      completedAt: state === "completed" || state === "failed" ? Date.now() : entry.completedAt,
    };
    this.entries.set(id, updated);
  }

  /** 将运行中的子代理分离到后台 */
  detach(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry || entry.state !== "running") return false;

    const updated: SubagentEntry = {
      ...entry,
      state: "detached",
      detachedAt: Date.now(),
    };
    this.entries.set(id, updated);
    return true;
  }

  /** 将后台子代理重新附加到前台 */
  attach(id: string): SubagentEntry | null {
    const entry = this.entries.get(id);
    if (!entry || entry.state !== "detached") return null;

    const updated: SubagentEntry = {
      ...entry,
      state: "running",
    };
    this.entries.set(id, updated);
    return updated;
  }

  /** 获取单个子代理条目 */
  get(id: string): SubagentEntry | undefined {
    return this.entries.get(id);
  }

  /** 列出子代理，可按 sessionId 过滤 */
  list(sessionId?: string): SubagentEntry[] {
    const all = [...this.entries.values()];
    if (!sessionId) return all;
    return all.filter((e) => e.sessionId === sessionId);
  }

  /** 清理过期条目，返回清理数量 */
  cleanup(olderThanMs: number = 30 * 60 * 1000): number {
    const cutoff = Date.now() - olderThanMs;
    let removed = 0;
    for (const [id, entry] of this.entries) {
      const isTerminal = entry.state === "completed" || entry.state === "failed";
      if (isTerminal && entry.completedAt && entry.completedAt < cutoff) {
        this.entries.delete(id);
        removed++;
      }
    }
    return removed;
  }
}

/** 全局单例注册表 */
export const subagentRegistry = new SubagentRegistry();

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3.3 — MCP Tool Inheritance
// ─────────────────────────────────────────────────────────────────────────────

export type SubagentToolPermissionLevel = "none" | "read-only" | "full";

export interface SubagentToolInheritanceConfig {
  /** 从父会话继承哪些工具 */
  readonly inheritLevel: SubagentToolPermissionLevel;
  /** 显式包含的工具名（覆盖 level 限制） */
  readonly includeTools?: readonly string[];
  /** 显式排除的工具名 */
  readonly excludeTools?: readonly string[];
}

/** read-only 级别下允许的安全工具集 */
const READ_SAFE_TOOLS = new Set([
  "Read",
  "Glob",
  "Grep",
  "WebSearch",
  "WebFetch",
  "GetGoals",
  "LearningGuide",
  "Recall",
]);

/**
 * 根据继承配置解析子代理可用的工具列表。
 *
 * 解析逻辑：
 * 1. none → 仅返回 includeTools（如有）
 * 2. read-only → 父工具中仅保留 READ_SAFE_TOOLS，再合并 includeTools
 * 3. full → 继承全部父工具，再合并 includeTools
 * 4. 最后移除 excludeTools
 */
export function resolveSubagentTools(
  parentTools: readonly string[],
  inheritance: SubagentToolInheritanceConfig,
): string[] {
  if (inheritance.inheritLevel === "none") {
    return inheritance.includeTools ? [...inheritance.includeTools] : [];
  }

  let tools = [...parentTools];

  if (inheritance.inheritLevel === "read-only") {
    tools = tools.filter((t) => READ_SAFE_TOOLS.has(t));
  }

  // Apply explicit includes
  if (inheritance.includeTools) {
    for (const tool of inheritance.includeTools) {
      if (!tools.includes(tool)) tools.push(tool);
    }
  }

  // Apply explicit excludes
  if (inheritance.excludeTools) {
    const excludeSet = new Set(inheritance.excludeTools);
    tools = tools.filter((t) => !excludeSet.has(t));
  }

  return tools;
}
