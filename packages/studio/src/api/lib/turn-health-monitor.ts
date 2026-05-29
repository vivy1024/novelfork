/**
 * Turn health monitor: detects loops, token overconsumption, repeated failures, and idle spinning.
 * Called after each tool execution in the agent turn loop.
 */

export interface TurnHealthConfig {
  /** Similarity threshold for loop detection (0-1, default 0.8) */
  loopDetectionThreshold: number;
  /** Token consumption warning ratio relative to context window (0-1, default 0.5) */
  tokenConsumptionWarnRatio: number;
  /** Context window size in tokens */
  contextWindowTokens: number;
  /** Max consecutive failures before force-stopping (default 5) */
  maxConsecutiveFailures: number;
}

export const DEFAULT_HEALTH_CONFIG: TurnHealthConfig = {
  loopDetectionThreshold: 0.8,
  tokenConsumptionWarnRatio: 0.5,
  contextWindowTokens: 200_000,
  maxConsecutiveFailures: 5,
};

export interface ToolCallRecord {
  name: string;
  input: Record<string, unknown>;
  output: string;
  success: boolean;
  timestamp: number;
}

export interface TurnHealthCheckResult {
  action: "continue" | "warn" | "stop";
  message?: string;
  reason?: "loop-detected" | "token-overconsumption" | "consecutive-failures" | "idle-spinning";
}

export class TurnHealthMonitor {
  private recentToolCalls: ToolCallRecord[] = [];
  private cumulativeTokens = 0;
  private consecutiveFailureCount = 0;
  private consecutiveEmptyResults = 0;
  private config: TurnHealthConfig;

  constructor(config: Partial<TurnHealthConfig> = {}) {
    this.config = { ...DEFAULT_HEALTH_CONFIG, ...config };
  }

  /** Reset state for a new turn */
  reset(): void {
    this.recentToolCalls = [];
    this.cumulativeTokens = 0;
    this.consecutiveFailureCount = 0;
    this.consecutiveEmptyResults = 0;
  }

  /** Add token usage from a generate call */
  addTokenUsage(tokens: number): void {
    this.cumulativeTokens += tokens;
  }

  /** Check health after a tool execution. Returns action to take. */
  checkHealth(toolCall: ToolCallRecord): TurnHealthCheckResult {
    this.recentToolCalls.push(toolCall);

    // 1. Consecutive failures check (highest priority — can force stop)
    if (!toolCall.success) {
      this.consecutiveFailureCount++;
      if (this.consecutiveFailureCount >= this.config.maxConsecutiveFailures) {
        return {
          action: "stop",
          reason: "consecutive-failures",
          message: `工具连续失败 ${this.consecutiveFailureCount} 次，已停止本轮执行。请检查问题根因后重试。`,
        };
      }
      if (this.consecutiveFailureCount >= 3) {
        return {
          action: "warn",
          reason: "consecutive-failures",
          message: `工具已连续失败 ${this.consecutiveFailureCount} 次。请停下来彻底调查根因，不要继续尝试相同的方法。`,
        };
      }
      if (this.consecutiveFailureCount >= 2) {
        return {
          action: "warn",
          reason: "consecutive-failures",
          message: "同一工具连续失败 2 次，请换一种方法尝试。",
        };
      }
    } else {
      this.consecutiveFailureCount = 0;
    }

    // 2. Empty/idle result detection
    if (toolCall.success && isEmptyResult(toolCall.output)) {
      this.consecutiveEmptyResults++;
      if (this.consecutiveEmptyResults >= 3) {
        const result: TurnHealthCheckResult = {
          action: "warn",
          reason: "idle-spinning",
          message: "最近几次操作没有产生有效结果，请重新评估方法。",
        };
        this.consecutiveEmptyResults = 0; // reset after warning
        return result;
      }
    } else {
      this.consecutiveEmptyResults = 0;
    }

    // 3. Loop pattern detection
    if (this.detectLoopPattern()) {
      return {
        action: "warn",
        reason: "loop-detected",
        message: "你似乎在重复类似操作，请换个方法或重新评估当前策略。",
      };
    }

    // 4. Token overconsumption check
    const tokenThreshold = this.config.contextWindowTokens * this.config.tokenConsumptionWarnRatio;
    if (this.cumulativeTokens > tokenThreshold) {
      // Only warn once per threshold crossing
      const result: TurnHealthCheckResult = {
        action: "warn",
        reason: "token-overconsumption",
        message: `本轮已消耗大量 token（约 ${Math.round(this.cumulativeTokens / 1000)}k），请总结当前进展并决定是否继续。`,
      };
      // Raise threshold so we don't warn again immediately
      this.config = { ...this.config, tokenConsumptionWarnRatio: this.config.tokenConsumptionWarnRatio + 0.2 };
      return result;
    }

    return { action: "continue" };
  }

  /** Detect if recent tool calls form a loop pattern */
  private detectLoopPattern(): boolean {
    if (this.recentToolCalls.length < 4) return false;

    const last = this.recentToolCalls.at(-1)!;
    const window = this.recentToolCalls.slice(-10, -1); // exclude the last one from comparison pool

    let similarCount = 0;
    for (const call of window) {
      if (computeSimilarity(call, last) >= this.config.loopDetectionThreshold) {
        similarCount++;
      }
    }

    return similarCount >= 3;
  }
}

/**
 * Compute similarity between two tool calls (0-1).
 * Same tool name is required; then compare input structure and values.
 */
export function computeSimilarity(a: ToolCallRecord, b: ToolCallRecord): number {
  if (a.name !== b.name) return 0;

  const aKeys = Object.keys(a.input).sort();
  const bKeys = Object.keys(b.input).sort();

  // Different parameter structure
  if (aKeys.join(",") !== bKeys.join(",")) return 0.3;

  if (aKeys.length === 0) return 1.0; // same tool, no params

  // Compare values
  let matchingValues = 0;
  for (const key of aKeys) {
    if (JSON.stringify(a.input[key]) === JSON.stringify(b.input[key])) {
      matchingValues++;
    }
  }

  // Base 0.5 for same tool + same keys, up to 1.0 for identical values
  return 0.5 + 0.5 * (matchingValues / aKeys.length);
}

/**
 * Check if a tool result is effectively empty/no-change.
 */
function isEmptyResult(output: string): boolean {
  if (!output || output.trim().length === 0) return true;
  if (output.trim() === "{}") return true;
  if (output.trim() === "[]") return true;
  if (output.includes("No matches found")) return true;
  if (output.includes("(no output)")) return true;
  return false;
}
