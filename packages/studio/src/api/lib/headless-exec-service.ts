import type { AgentTurnEvent, AgentTurnRuntimeInput } from "./agent-turn-runtime.js";
import type { SessionToolExecutionResult } from "../../shared/agent-native-workspace.js";
import type { CreateNarratorSessionInput, NarratorSessionRecord, SessionConfig, SessionPermissionMode } from "../../shared/session-types.js";
import type { AgentGenerateResult } from "./agent-turn-runtime.js";

import { runAgentTurn } from "./agent-turn-runtime.js";
import { createSession, getSessionById } from "./session-service.js";
import { generateSessionReply } from "./llm-runtime-service.js";
import { getAgentSystemPrompt } from "@vivy1024/novelfork-core";
import { buildAgentContext } from "./agent-context.js";
import { getEnabledSessionTools } from "./session-tool-registry.js";
import { createSessionToolExecutor } from "./session-tool-executor.js";

const AGENT_NATIVE_HEADLESS_INSTRUCTIONS = `

## Headless Execution Mode

你正在非交互 headless 模式下运行。请注意：
- 直接输出最终结果，不要等待用户确认或追问。
- 生成的内容将进入候选区，不会覆盖正式章节。
- 如果需要用户决策的工具调用，系统会自动暂停并返回 pending 状态。
`;

const DEFAULT_MAX_STEPS = 6;

/* ------------------------------------------------------------------ */
/*  Public types                                                       */
/* ------------------------------------------------------------------ */

export interface HeadlessExecInput {
  /** 用户输入 prompt */
  readonly prompt: string;
  /** 可选，复用已有 session */
  readonly sessionId?: string;
  /** Agent ID，默认 "writer" */
  readonly agentId?: string;
  /** 书籍/项目 ID，用于构建上下文 */
  readonly projectId?: string;
  /** 覆盖 session 配置（provider/model/permission） */
  readonly sessionConfig?: Partial<SessionConfig>;
  /** 附加上下文（stdin 管道输入） */
  readonly stdinContext?: string;
  /** 是否输出 JSONL 事件流 */
  readonly jsonOutput?: boolean;
  /** 覆盖默认步数 */
  readonly maxSteps?: number;
}

export interface HeadlessExecResult {
  /** 使用的 session ID */
  readonly sessionId: string;
  /** 完整事件流 */
  readonly events: readonly AgentTurnEvent[];
  /** 最后一条 assistant_message 的 content */
  readonly finalMessage?: string;
  /** 收集到的工具执行结果 */
  readonly toolResults: ReadonlyArray<{ readonly toolName: string; readonly result: SessionToolExecutionResult }>;
  /** 遇到确认门时的 pending 信息 */
  readonly pendingConfirmation?: { readonly toolName: string; readonly id: string };
  /** 是否成功完成 */
  readonly success: boolean;
  /** 退出码：0=成功, 1=失败, 2=pending confirmation */
  readonly exitCode: number;
  /** 失败原因 */
  readonly error?: string;
  /** 失败时的最近工具链摘要 */
  readonly toolChainSummary?: string;
}

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                   */
/* ------------------------------------------------------------------ */

function buildToolChainSummary(events: readonly AgentTurnEvent[]): string {
  const toolCalls: string[] = [];
  for (const event of events) {
    if (event.type === "tool_call") {
      toolCalls.push(`${event.toolName}(${JSON.stringify(event.input)})`);
    }
    if (event.type === "tool_result") {
      const status = event.result.ok ? "ok" : `error: ${event.result.error ?? "unknown"}`;
      toolCalls.push(`  → ${event.toolName}: ${status} — ${event.result.summary}`);
    }
  }
  return toolCalls.join("\n");
}

function collectResults(events: readonly AgentTurnEvent[]): HeadlessExecResult & { sessionId: string } {
  let finalMessage: string | undefined;
  const toolResults: Array<{ toolName: string; result: SessionToolExecutionResult }> = [];
  let pendingConfirmation: { toolName: string; id: string } | undefined;
  let success = true;
  let exitCode = 0;
  let error: string | undefined;

  for (const event of events) {
    switch (event.type) {
      case "assistant_message":
        finalMessage = event.content;
        break;
      case "tool_result":
        toolResults.push({ toolName: event.toolName, result: event.result });
        break;
      case "confirmation_required":
        pendingConfirmation = { toolName: event.toolName, id: event.id };
        success = false;
        exitCode = 2;
        break;
      case "turn_failed":
        success = false;
        exitCode = 1;
        error = event.reason;
        break;
      case "turn_completed":
        break;
      case "tool_call":
        break;
    }
  }

  const toolChainSummary = !success ? buildToolChainSummary(events) || undefined : undefined;

  return {
    sessionId: "",
    events,
    finalMessage,
    toolResults,
    pendingConfirmation,
    success,
    exitCode,
    error,
    toolChainSummary,
  };
}

/* ------------------------------------------------------------------ */
/*  Main entry                                                         */
/* ------------------------------------------------------------------ */

export async function executeHeadless(input: HeadlessExecInput): Promise<HeadlessExecResult> {
  // 1. Resolve or create session
  let session: NarratorSessionRecord | null = null;

  if (input.sessionId) {
    session = await getSessionById(input.sessionId);
    if (!session) {
      return {
        sessionId: input.sessionId,
        events: [],
        toolResults: [],
        success: false,
        exitCode: 1,
        error: `Session not found: ${input.sessionId}`,
      };
    }
  } else {
    const createInput: CreateNarratorSessionInput = {
      title: `Headless: ${input.prompt.slice(0, 40)}`,
      agentId: input.agentId ?? "writer",
      kind: "standalone",
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.sessionConfig ? { sessionConfig: input.sessionConfig } : {}),
    };
    session = await createSession(createInput);
  }

  // 2. Build agent context
  const agentSystemPrompt = getAgentSystemPrompt(session.agentId);
  const projectId = input.projectId ?? (session as { projectId?: string }).projectId;
  let bookContext = "";
  if (projectId) {
    try {
      bookContext = await buildAgentContext({ bookId: projectId });
    } catch { /* context build failure is non-fatal */ }
  }

  // 3. Build context with optional stdin
  let context = bookContext;
  if (input.stdinContext) {
    const stdinBlock = `\n\n## 附加上下文（stdin）\n\n${input.stdinContext}`;
    context = context ? `${context}${stdinBlock}` : stdinBlock;
  }

  // 4. Build user message as turn items
  const userMessage = {
    type: "message" as const,
    role: "user" as const,
    content: input.prompt,
    id: `headless-${Date.now()}`,
  };

  // 5. Get enabled tools
  const permissionMode: SessionPermissionMode = session.sessionConfig.permissionMode;
  const tools = getEnabledSessionTools(permissionMode);

  // 6. Create tool executor
  const toolExecutor = createSessionToolExecutor();

  // 7. Run agent turn
  const runtimeEvents = await runAgentTurn({
    sessionId: session.id,
    sessionConfig: session.sessionConfig,
    messages: [userMessage],
    systemPrompt: `${agentSystemPrompt}${AGENT_NATIVE_HEADLESS_INSTRUCTIONS}`,
    context,
    tools,
    permissionMode,
    maxSteps: input.maxSteps ?? DEFAULT_MAX_STEPS,
    shouldContinueAfterToolResult: ({ result }) => result.ok || result.error === "confirmation-rejected",
    generate: async (generateInput): Promise<AgentGenerateResult> => {
      const result = await generateSessionReply({
        sessionConfig: generateInput.sessionConfig,
        messages: generateInput.messages,
        tools: generateInput.tools,
      });
      return result as AgentGenerateResult;
    },
    executeTool: (toolInput) => toolExecutor.execute(toolInput),
  });

  // 8. Collect and return results
  const collected = collectResults(runtimeEvents);
  return {
    ...collected,
    sessionId: session.id,
  };
}
