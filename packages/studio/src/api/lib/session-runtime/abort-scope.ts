import type { ToolCancellationCapability } from "./tool-cancellation-policy.js";

export type AbortScopeCause = "abort" | "timeout";

/** The outcome returned by a handler before any deadline wrapping is applied. */
export type AbortScopeSettledTerminal = "completed" | "stopped" | "stop-timeout" | "execution-error";

/** Terminal values exposed by the scope API. */
export type AbortScopeTerminal =
  | AbortScopeCause
  | AbortScopeSettledTerminal
  | "deadline-exceeded-operation-completed"
  | "deadline-exceeded-operation-failed";

export interface AbortScopeOptions {
  readonly capability: ToolCancellationCapability;
  readonly rootSignal?: AbortSignal;
  /** null means no automatic deadline. */
  readonly timeoutMs?: number | null;
  /** Observability hook: cancellation has been observed. */
  readonly onStopping?: (cause: AbortScopeCause) => void;
}

export interface AbortScopeAudit<T = unknown> {
  readonly cause: AbortScopeCause;
  readonly settled: "completed" | "failed";
  readonly terminal: AbortScopeSettledTerminal;
  readonly value?: T;
  readonly error?: unknown;
}

export interface AbortScopeResult<T> {
  readonly terminal: AbortScopeTerminal;
  readonly value?: T;
  readonly error?: unknown;
  readonly cause?: AbortScopeCause;
  readonly data?: {
    readonly audit: AbortScopeAudit<T>;
  };
}

function isAbortScopeCause(value: unknown): value is AbortScopeCause {
  return value === "abort" || value === "timeout";
}

export function normalizeAbortScopeTerminal(value: unknown): AbortScopeSettledTerminal | undefined {
  if (!value || typeof value !== "object") return undefined;
  const error = (value as { error?: unknown }).error;
  if (error === "stopped") return "stopped";
  if (error === "stop-timeout") return "stop-timeout";
  return undefined;
}

function resolveAuditTerminal<T>(value: T): AbortScopeSettledTerminal {
  return normalizeAbortScopeTerminal(value) ?? "completed";
}

function buildCompletedResult<T>(value: T, cause?: AbortScopeCause): AbortScopeResult<T> {
  return cause ? { terminal: "completed", value, cause } : { terminal: "completed", value };
}

function buildDeadlineExceededResult<T>(cause: AbortScopeCause, settled: "completed", value: T): AbortScopeResult<T>;
function buildDeadlineExceededResult<T>(cause: AbortScopeCause, settled: "failed", error: unknown): AbortScopeResult<T>;
function buildDeadlineExceededResult<T>(cause: AbortScopeCause, settled: "completed" | "failed", outcome: T | unknown): AbortScopeResult<T> {
  const audit: AbortScopeAudit<T> = settled === "completed"
    ? {
        cause,
        settled,
        terminal: resolveAuditTerminal(outcome as T),
        value: outcome as T,
      }
    : {
        cause,
        settled,
        terminal: "execution-error",
        error: outcome,
      };

  return settled === "completed"
    ? {
        terminal: "deadline-exceeded-operation-completed",
        cause,
        value: outcome as T,
        data: { audit },
      }
    : {
        terminal: "deadline-exceeded-operation-failed",
        cause,
        error: outcome,
        data: { audit },
      };
}

function executionError<T>(error: unknown): AbortScopeResult<T> {
  return { terminal: "execution-error", error };
}

/**
 * Binds one handler invocation to a child signal and its cancellation contract.
 * Listeners are installed before the factory runs so cancellation cannot race
 * the initial setup.
 */
export class AbortScope {
  private readonly capability: ToolCancellationCapability;
  private readonly rootSignal?: AbortSignal;
  private readonly timeoutMs: number | null;
  private readonly onStopping?: (cause: AbortScopeCause) => void;

  constructor(options: AbortScopeOptions) {
    this.capability = options.capability;
    this.rootSignal = options.rootSignal;
    this.timeoutMs = typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? Math.floor(options.timeoutMs)
      : null;
    this.onStopping = options.onStopping;
  }

  async execute<T>(factory: (signal: AbortSignal) => Promise<T> | T): Promise<AbortScopeResult<T>> {
    const childController = new AbortController();
    let stopCause: AbortScopeCause | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cleaned = false;

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      if (timer !== undefined) clearTimeout(timer);
      this.rootSignal?.removeEventListener("abort", onRootAbort);
    };

    const requestStop = (cause: AbortScopeCause) => {
      if (stopCause) return;
      stopCause = cause;
      try {
        this.onStopping?.(cause);
      } catch {
        // Observability must not affect settlement semantics.
      }
      if (this.capability !== "non-cancellable") {
        childController.abort(cause);
      }
    };

    const onRootAbort = () => requestStop("abort");
    this.rootSignal?.addEventListener("abort", onRootAbort, { once: true });
    if (this.timeoutMs !== null) {
      timer = setTimeout(() => requestStop("timeout"), this.timeoutMs);
    }

    const projectsCancellationAfterSettlement = this.capability === "cooperative" || this.capability === "commit-fenced";
    if (this.rootSignal?.aborted) {
      requestStop("abort");
    }

    let operation: Promise<T>;
    try {
      operation = Promise.resolve(factory(childController.signal));
    } catch (error) {
      cleanup();
      if (this.capability === "non-cancellable" && isAbortScopeCause(stopCause)) {
        return buildDeadlineExceededResult(stopCause, "failed", error);
      }
      if (projectsCancellationAfterSettlement && isAbortScopeCause(stopCause)) {
        return { terminal: stopCause, cause: stopCause };
      }
      return executionError(error);
    }

    try {
      const value = await operation;
      cleanup();
      if (projectsCancellationAfterSettlement && isAbortScopeCause(stopCause)) {
        return { terminal: stopCause, cause: stopCause };
      }
      if (this.capability === "process-killable") {
        const terminal = normalizeAbortScopeTerminal(value);
        return terminal ? { terminal, value, ...(stopCause ? { cause: stopCause } : {}) } : buildCompletedResult(value, stopCause);
      }
      if (this.capability === "non-cancellable" && isAbortScopeCause(stopCause)) {
        return buildDeadlineExceededResult(stopCause, "completed", value);
      }
      const terminal = normalizeAbortScopeTerminal(value);
      return terminal ? { terminal, value, ...(stopCause ? { cause: stopCause } : {}) } : buildCompletedResult(value, stopCause);
    } catch (error) {
      cleanup();
      if (this.capability === "non-cancellable" && isAbortScopeCause(stopCause)) {
        return buildDeadlineExceededResult(stopCause, "failed", error);
      }
      if (projectsCancellationAfterSettlement && isAbortScopeCause(stopCause)) {
        return { terminal: stopCause, cause: stopCause };
      }
      return executionError(error);
    }
  }
}

export function createAbortScope(options: AbortScopeOptions): AbortScope {
  return new AbortScope(options);
}
