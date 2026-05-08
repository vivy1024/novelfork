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
