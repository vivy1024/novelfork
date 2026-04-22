import type { RunAction } from "../../shared/contracts.js";
import type { RuntimeDebugSettings, RuntimeRecoverySettings } from "../../types/settings.js";
import type { RunStore } from "./run-store.js";

export interface RuntimeExecutionEnvelope {
  readonly runId: string | null;
  readonly attempts: number;
  readonly traceEnabled: boolean;
  readonly dumpEnabled: boolean;
}

export type RuntimeAttemptResult<T> =
  | { readonly success: true; readonly value: T }
  | { readonly success: false; readonly error: string };

export interface RuntimeExecutionOptions<T> {
  readonly runStore?: RunStore;
  readonly bookId?: string;
  readonly action?: RunAction;
  readonly label: string;
  readonly recovery: RuntimeRecoverySettings;
  readonly runtimeDebug: RuntimeDebugSettings;
  readonly input?: unknown;
  readonly execute: (attempt: number) => Promise<RuntimeAttemptResult<T>>;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
}

export type RuntimeExecutionResult<T> =
  | {
      readonly success: true;
      readonly value: T;
      readonly execution: RuntimeExecutionEnvelope;
    }
  | {
      readonly success: false;
      readonly error: string;
      readonly execution: RuntimeExecutionEnvelope;
    };

const SYSTEM_BOOK_ID = "__studio__";
const MAX_DUMP_LENGTH = 600;

function stringifyForLog(value: unknown): string {
  try {
    const serialized = JSON.stringify(value);
    if (!serialized) {
      return String(value);
    }
    return serialized.length > MAX_DUMP_LENGTH
      ? `${serialized.slice(0, MAX_DUMP_LENGTH)}…`
      : serialized;
  } catch {
    return String(value);
  }
}

export function shouldTraceExecution(runtimeDebug: RuntimeDebugSettings, random: () => number = Math.random): boolean {
  if (!runtimeDebug.traceEnabled) {
    return false;
  }
  if (runtimeDebug.traceSampleRatePercent >= 100) {
    return true;
  }
  if (runtimeDebug.traceSampleRatePercent <= 0) {
    return false;
  }
  return random() * 100 < runtimeDebug.traceSampleRatePercent;
}

export function calculateRetryDelayMs(
  recovery: RuntimeRecoverySettings,
  attemptIndex: number,
  random: () => number = Math.random,
): number {
  const baseDelay = Math.min(
    recovery.maxRetryDelayMs,
    Math.round(recovery.initialRetryDelayMs * recovery.backoffMultiplier ** attemptIndex),
  );
  if (baseDelay <= 0 || recovery.jitterPercent <= 0) {
    return baseDelay;
  }

  const jitterWindow = baseDelay * (recovery.jitterPercent / 100);
  const jitterOffset = (random() * 2 - 1) * jitterWindow;
  return Math.max(0, Math.round(baseDelay + jitterOffset));
}

export async function executeWithRuntimePolicy<T>(
  options: RuntimeExecutionOptions<T>,
): Promise<RuntimeExecutionResult<T>> {
  const sleep = options.sleep ?? (async (ms: number) => {
    if (ms <= 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
  const random = options.random ?? Math.random;
  const traceEnabled = shouldTraceExecution(options.runtimeDebug, random);
  const dumpEnabled = options.runtimeDebug.dumpEnabled;
  const totalAttempts = Math.max(1, options.recovery.maxRetryAttempts);
  const run = options.runStore?.create({
    bookId: options.bookId ?? SYSTEM_BOOK_ID,
    action: options.action ?? "tool",
  });

  if (run) {
    options.runStore?.markRunning(run.id, options.label);
    options.runStore?.appendLog(run.id, {
      timestamp: new Date().toISOString(),
      level: "info",
      message: `Execution started · trace ${traceEnabled ? "on" : "off"} · dump ${dumpEnabled ? "on" : "off"}`,
    });
    if (dumpEnabled && options.input !== undefined) {
      options.runStore?.appendLog(run.id, {
        timestamp: new Date().toISOString(),
        level: "info",
        message: `Input dump: ${stringifyForLog(options.input)}`,
      });
    }
  }

  let attempts = 0;
  let lastError = "Execution failed";

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    attempts = attempt;
    if (run) {
      options.runStore?.appendLog(run.id, {
        timestamp: new Date().toISOString(),
        level: "info",
        message: `Attempt ${attempt} started`,
      });
    }

    const result = await options.execute(attempt);
    if (result.success) {
      if (run) {
        if (dumpEnabled) {
          options.runStore?.appendLog(run.id, {
            timestamp: new Date().toISOString(),
            level: "info",
            message: `Result dump: ${stringifyForLog(result.value)}`,
          });
        }
        options.runStore?.succeed(run.id, {
          attempts,
          traceEnabled,
          dumpEnabled,
          label: options.label,
        });
      }

      return {
        success: true,
        value: result.value,
        execution: {
          runId: run?.id ?? null,
          attempts,
          traceEnabled,
          dumpEnabled,
        },
      };
    }

    lastError = result.error;
    if (run) {
      options.runStore?.appendLog(run.id, {
        timestamp: new Date().toISOString(),
        level: attempt < totalAttempts ? "warn" : "error",
        message: `Attempt ${attempt} failed: ${result.error}`,
      });
    }

    if (attempt >= totalAttempts) {
      break;
    }

    const delayMs = calculateRetryDelayMs(options.recovery, attempt - 1, random);
    if (run) {
      options.runStore?.appendLog(run.id, {
        timestamp: new Date().toISOString(),
        level: "info",
        message: `Retrying after ${delayMs}ms`,
      });
    }
    await sleep(delayMs);
  }

  if (run) {
    options.runStore?.fail(run.id, lastError);
  }

  return {
    success: false,
    error: lastError,
    execution: {
      runId: run?.id ?? null,
      attempts,
      traceEnabled,
      dumpEnabled,
    },
  };
}
