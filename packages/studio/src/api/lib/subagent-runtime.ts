/**
 * Subagent Runtime — independent agent execution with its own system prompt, model, and tool permissions.
 *
 * 对标：
 * - Claude Code CLI: src/tools/AgentTool/runAgent.ts (independent conversation loop)
 * - Codex CLI: subagents with sandbox/approval inheritance
 *
 * Each subagent runs an independent generate→tool→generate loop with bounded steps.
 */

export interface SubagentConfig {
  readonly id: string;
  readonly name: string;
  readonly systemPrompt: string;
  readonly modelId: string;
  readonly providerId: string;
  readonly tools: readonly string[];
  readonly maxSteps: number;
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
  readonly stopReason?: "completed" | "max_steps" | "error";
  readonly toolResults: readonly SubagentToolResult[];
  readonly error?: string;
}

export interface RunSubagentInput {
  readonly config: SubagentConfig;
  readonly prompt: string;
  readonly generate: (input: SubagentGenerateInput) => Promise<SubagentGenerateResult>;
  readonly executeTool?: (toolName: string, input: Record<string, unknown>) => Promise<{ ok: boolean; summary: string; data?: unknown }>;
}

export async function runSubagent(input: RunSubagentInput): Promise<SubagentResult> {
  const { config, prompt, generate, executeTool } = input;
  const messages: SubagentMessage[] = [{ role: "user", content: prompt }];
  const toolResults: SubagentToolResult[] = [];
  let steps = 0;

  while (steps < config.maxSteps) {
    const result = await generate({
      systemPrompt: config.systemPrompt,
      modelId: config.modelId,
      providerId: config.providerId,
      messages,
      tools: config.tools,
    });

    if (!result.success) {
      return { ok: false, stopReason: "error", toolResults, error: "Generation failed" };
    }

    if (result.type === "message") {
      return { ok: true, content: result.content, stopReason: "completed", toolResults };
    }

    // Tool use
    if (result.toolUses && result.toolUses.length > 0) {
      for (const toolUse of result.toolUses) {
        steps++;
        if (steps > config.maxSteps) {
          return { ok: false, stopReason: "max_steps", toolResults };
        }

        const toolResult = executeTool
          ? await executeTool(toolUse.name, toolUse.input)
          : { ok: false, summary: `Tool ${toolUse.name} not available in subagent` };

        toolResults.push({ toolName: toolUse.name, toolUseId: toolUse.id, result: toolResult });
        messages.push({ role: "assistant", content: `Calling ${toolUse.name}` });
        messages.push({ role: "tool_result", content: toolResult.summary, toolUseId: toolUse.id, toolName: toolUse.name });
      }
    }
  }

  return { ok: false, stopReason: "max_steps", toolResults };
}
