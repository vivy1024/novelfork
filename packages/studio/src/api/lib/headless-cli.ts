/**
 * Headless CLI mode — run agent without web UI.
 * Usage: novelfork --headless --prompt "fix the bug in src/utils.ts"
 *
 * This allows CI/CD integration and scripted usage.
 */

import type { HeadlessExecResult } from "./headless-exec-service.js";

export interface HeadlessCLIOptions {
  prompt: string;
  sessionId?: string;
  workDir?: string;
  model?: string;
  maxSteps?: number;
  outputFormat?: "text" | "json";
}

export interface HeadlessCLIResult {
  success: boolean;
  output: string;
  toolCalls: Array<{ name: string; status: string; duration?: number }>;
  error?: string;
}

export async function runHeadlessCLI(options: HeadlessCLIOptions): Promise<HeadlessCLIResult> {
  const { prompt, workDir, model, maxSteps = 30, outputFormat = "text" } = options;

  try {
    const { executeHeadless } = await import("./headless-exec-service.js");

    // Build session config override if model is specified
    const sessionConfig = model
      ? {
          providerId: model.split(":")[0] ?? "",
          modelId: model.split(":").slice(1).join(":") || "",
        }
      : undefined;

    // Set working directory for the agent
    if (workDir) {
      process.env.NOVELFORK_PROJECT_ROOT = workDir;
    }

    const result: HeadlessExecResult = await executeHeadless({
      prompt,
      sessionId: options.sessionId,
      sessionConfig: sessionConfig as any,
      maxSteps,
    });

    // Collect tool call summaries
    const toolCalls = result.toolResults.map((tr) => ({
      name: tr.toolName,
      status: tr.result.ok ? "ok" : (tr.result.error ?? "failed"),
    }));

    if (outputFormat === "json") {
      return {
        success: result.success,
        output: JSON.stringify({
          success: result.success,
          message: result.finalMessage ?? "",
          toolCalls,
          error: result.error,
        }, null, 2),
        toolCalls,
        error: result.error,
      };
    }

    return {
      success: result.success,
      output: result.finalMessage ?? result.error ?? "No output",
      toolCalls,
      error: result.error,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      output: "",
      toolCalls: [],
      error: errorMessage,
    };
  }
}
