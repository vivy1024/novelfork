/**
 * Coordinator Prompt — generates system prompt additions for multi-agent coordination.
 *
 * When a session has subagents/background tasks, injects coordination instructions
 * to help the main agent orchestrate effectively.
 */

export interface CoordinatorContext {
  /** Number of active subagents */
  activeSubagents: number;
  /** Names/descriptions of running subagents */
  subagentDescriptions?: string[];
  /** Whether the session has background tasks */
  hasBackgroundTasks: boolean;
  /** Total tokens used across all agents */
  totalTokensUsed?: number;
}

/**
 * Generate coordinator instructions to append to system prompt.
 * Returns empty string if no coordination is needed.
 */
export function buildCoordinatorPrompt(context: CoordinatorContext): string {
  if (context.activeSubagents === 0 && !context.hasBackgroundTasks) {
    return "";
  }

  const parts: string[] = [];

  if (context.activeSubagents > 0) {
    parts.push(`<coordinator-context>`);
    parts.push(`You are coordinating ${context.activeSubagents} subagent(s).`);

    if (context.subagentDescriptions?.length) {
      parts.push(`Active agents:`);
      for (const desc of context.subagentDescriptions) {
        parts.push(`- ${desc}`);
      }
    }

    parts.push(`Coordination guidelines:`);
    parts.push(`- Delegate independent tasks to subagents when possible`);
    parts.push(`- Wait for subagent results before making decisions that depend on their output`);
    parts.push(`- If a subagent is taking too long, check its status before starting duplicate work`);
    parts.push(`- Summarize subagent results for the user — don't ask them to check directly`);
    parts.push(`</coordinator-context>`);
  }

  if (context.hasBackgroundTasks) {
    parts.push(`[Background tasks are running. Use Await to check their status when needed.]`);
  }

  return parts.join("\n");
}

/**
 * Determine if coordination prompt should be injected based on session state.
 */
export function shouldInjectCoordinatorPrompt(context: CoordinatorContext): boolean {
  return context.activeSubagents > 0 || context.hasBackgroundTasks;
}
