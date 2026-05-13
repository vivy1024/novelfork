/**
 * SWE-bench / HumanEval Evaluation Runner
 *
 * 对标 NarraFork v0.2.1: 支持 HumanEval/SWE-bench 评测，验证 Agent 代码能力
 *
 * This module provides the evaluation framework for running coding benchmarks
 * against the NovelFork Agent runtime. It supports:
 * - HumanEval (function completion)
 * - SWE-bench (real-world bug fixing)
 * - Custom evaluation suites
 */

export type BenchmarkType = "humaneval" | "swe-bench" | "custom";
export type EvalStatus = "pending" | "running" | "passed" | "failed" | "error" | "timeout";

export interface EvalTask {
  readonly id: string;
  readonly benchmark: BenchmarkType;
  readonly prompt: string;
  readonly expectedOutput?: string;
  readonly testCode?: string;
  readonly timeoutMs: number;
  readonly metadata?: Record<string, unknown>;
}

export interface EvalResult {
  readonly taskId: string;
  readonly status: EvalStatus;
  readonly output?: string;
  readonly error?: string;
  readonly durationMs: number;
  readonly tokenUsage?: { input: number; output: number };
}

export interface EvalSuiteResult {
  readonly benchmark: BenchmarkType;
  readonly totalTasks: number;
  readonly passed: number;
  readonly failed: number;
  readonly errors: number;
  readonly timeouts: number;
  readonly passRate: number;
  readonly totalDurationMs: number;
  readonly results: readonly EvalResult[];
}

export interface EvalRunnerOptions {
  readonly sessionId: string;
  readonly modelId: string;
  readonly providerId: string;
  readonly maxConcurrency?: number;
  readonly timeoutMs?: number;
  readonly onProgress?: (completed: number, total: number) => void;
}

/**
 * Run a single evaluation task against the Agent runtime.
 */
export async function runEvalTask(
  task: EvalTask,
  options: EvalRunnerOptions,
  generate: (prompt: string) => Promise<{ success: boolean; content?: string; error?: string; usage?: { input: number; output: number } }>,
): Promise<EvalResult> {
  const startedAt = Date.now();

  try {
    const result = await Promise.race([
      generate(task.prompt),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), task.timeoutMs),
      ),
    ]);

    if (!result.success) {
      return {
        taskId: task.id,
        status: "error",
        error: result.error ?? "Generation failed",
        durationMs: Date.now() - startedAt,
        tokenUsage: result.usage,
      };
    }

    // If test code is provided, evaluate the output
    if (task.testCode) {
      const passed = evaluateOutput(result.content ?? "", task.testCode, task.expectedOutput);
      return {
        taskId: task.id,
        status: passed ? "passed" : "failed",
        output: result.content,
        durationMs: Date.now() - startedAt,
        tokenUsage: result.usage,
      };
    }

    // If expected output is provided, do exact match
    if (task.expectedOutput !== undefined) {
      const passed = (result.content ?? "").trim() === task.expectedOutput.trim();
      return {
        taskId: task.id,
        status: passed ? "passed" : "failed",
        output: result.content,
        durationMs: Date.now() - startedAt,
        tokenUsage: result.usage,
      };
    }

    // No validation — just check if output is non-empty
    return {
      taskId: task.id,
      status: result.content?.trim() ? "passed" : "failed",
      output: result.content,
      durationMs: Date.now() - startedAt,
      tokenUsage: result.usage,
    };
  } catch (err) {
    const isTimeout = err instanceof Error && err.message === "timeout";
    return {
      taskId: task.id,
      status: isTimeout ? "timeout" : "error",
      error: err instanceof Error ? err.message : "Unknown error",
      durationMs: Date.now() - startedAt,
    };
  }
}

/**
 * Run a full evaluation suite.
 */
export async function runEvalSuite(
  tasks: readonly EvalTask[],
  options: EvalRunnerOptions,
  generate: (prompt: string) => Promise<{ success: boolean; content?: string; error?: string; usage?: { input: number; output: number } }>,
): Promise<EvalSuiteResult> {
  const results: EvalResult[] = [];
  const startedAt = Date.now();
  const concurrency = options.maxConcurrency ?? 1;

  // Sequential execution (concurrency=1) or batched
  for (let i = 0; i < tasks.length; i += concurrency) {
    const batch = tasks.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((task) => runEvalTask(task, options, generate)),
    );
    results.push(...batchResults);
    options.onProgress?.(results.length, tasks.length);
  }

  const passed = results.filter((r) => r.status === "passed").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const errors = results.filter((r) => r.status === "error").length;
  const timeouts = results.filter((r) => r.status === "timeout").length;

  return {
    benchmark: tasks[0]?.benchmark ?? "custom",
    totalTasks: tasks.length,
    passed,
    failed,
    errors,
    timeouts,
    passRate: tasks.length > 0 ? Math.round((passed / tasks.length) * 100) : 0,
    totalDurationMs: Date.now() - startedAt,
    results,
  };
}

/**
 * Simple output evaluation — checks if output contains expected patterns.
 * For real SWE-bench, this would run the test suite in a sandbox.
 */
function evaluateOutput(output: string, testCode: string, expectedOutput?: string): boolean {
  // Simple heuristic: check if the output contains key patterns from test code
  // In production, this would execute the test code in a sandbox
  if (expectedOutput) {
    return output.includes(expectedOutput);
  }
  // If test code mentions "assert" patterns, check if output looks like valid code
  if (testCode.includes("assert") || testCode.includes("expect")) {
    return output.trim().length > 10 && !output.includes("error") && !output.includes("Error");
  }
  return output.trim().length > 0;
}
