import { execFile } from "node:child_process";

export const DEFAULT_PROCESS_TREE_GRACE_MS = 5_000;
export const DEFAULT_PROCESS_TREE_STOP_DEADLINE_MS = DEFAULT_PROCESS_TREE_GRACE_MS * 2;

export type ProcessTreeStopReason = "abort" | "timeout" | "task-stop";
export type ProcessTreeState = "running" | "stopping" | "exited" | "stopped" | "stop-timeout";

export interface ProcessTreeExit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

export interface ProcessTreeStopResult {
  readonly terminal: "stopped" | "stop-timeout";
  readonly reason: ProcessTreeStopReason;
}

export interface ProcessTreeChild {
  readonly pid?: number;
  readonly exitCode: number | null;
  readonly signalCode?: NodeJS.Signals | null;
  once(event: "exit" | "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  kill(signal?: NodeJS.Signals | number): boolean;
}

export interface ProcessTreeTerminationRequest {
  readonly child: ProcessTreeChild;
  readonly pid?: number;
  readonly platform: NodeJS.Platform;
  readonly force: boolean;
}

export interface ProcessTreeControllerOptions {
  readonly platform?: NodeJS.Platform;
  readonly stopTimeoutMs?: number;
  readonly terminateTree?: (request: ProcessTreeTerminationRequest) => Promise<void> | void;
}

export function windowsTaskkillInvocation(pid: number): { readonly file: string; readonly args: readonly string[] } {
  return {
    file: "taskkill.exe",
    args: ["/PID", String(pid), "/T", "/F"],
  };
}

async function defaultTerminateTree(request: ProcessTreeTerminationRequest): Promise<void> {
  const { child, pid, platform, force } = request;
  if (!pid) {
    try {
      child.kill(force ? "SIGKILL" : "SIGTERM");
    } catch {
      // The process may have exited between the state check and termination.
    }
    return;
  }

  if (platform === "win32") {
    const invocation = windowsTaskkillInvocation(pid);
    await new Promise<void>((resolve) => {
      const taskkill = execFile(invocation.file, [...invocation.args], {
        windowsHide: true,
      }, () => resolve());
      taskkill.once("error", () => resolve());
    });
    return;
  }

  try {
    process.kill(-pid, force ? "SIGKILL" : "SIGTERM");
  } catch {
    try {
      child.kill(force ? "SIGKILL" : "SIGTERM");
    } catch {
      // The process may already be gone.
    }
  }
}

/**
 * Owns the lifecycle of one spawned process tree. A stop request has two
 * independent facts: whether the stop deadline was met, and whether the child
 * has really exited. Callers that guard a turn must always await waitForExit().
 */
export class ProcessTreeController {
  readonly child: ProcessTreeChild;
  readonly platform: NodeJS.Platform;
  readonly stopTimeoutMs: number;

  private readonly terminateTree: (request: ProcessTreeTerminationRequest) => Promise<void> | void;
  private readonly exitPromise: Promise<ProcessTreeExit>;
  private readonly closePromise: Promise<void>;
  private readonly terminalPromise: Promise<ProcessTreeExit>;
  private resolveExit!: (exit: ProcessTreeExit) => void;
  private resolveClose!: () => void;
  private exit: ProcessTreeExit | undefined;
  private closed = false;
  private stopReason: ProcessTreeStopReason | undefined;
  private stopPromise: Promise<ProcessTreeStopResult> | undefined;
  private currentState: ProcessTreeState = "running";

  constructor(child: ProcessTreeChild, options: ProcessTreeControllerOptions = {}) {
    this.child = child;
    this.platform = options.platform ?? process.platform;
    this.stopTimeoutMs = typeof options.stopTimeoutMs === "number" && Number.isFinite(options.stopTimeoutMs) && options.stopTimeoutMs > 0
      ? Math.floor(options.stopTimeoutMs)
      : DEFAULT_PROCESS_TREE_GRACE_MS;
    this.terminateTree = options.terminateTree ?? defaultTerminateTree;
    this.exitPromise = new Promise<ProcessTreeExit>((resolve) => {
      this.resolveExit = resolve;
    });
    this.closePromise = new Promise<void>((resolve) => {
      this.resolveClose = resolve;
    });
    this.terminalPromise = Promise.all([this.exitPromise, this.closePromise]).then(([exit]) => exit);

    child.once("exit", (code, signal) => this.recordExit(code, signal));
    child.once("close", (code, signal) => this.recordClose(code, signal));
    if (child.exitCode !== null || child.signalCode) {
      this.recordExit(child.exitCode, child.signalCode ?? null);
    }
  }

  get state(): ProcessTreeState {
    return this.currentState;
  }

  get requestedStopReason(): ProcessTreeStopReason | undefined {
    return this.stopReason;
  }

  waitForExit(): Promise<ProcessTreeExit> {
    return this.terminalPromise;
  }

  requestStop(reason: ProcessTreeStopReason): Promise<ProcessTreeStopResult> {
    if (this.stopPromise) return this.stopPromise;
    this.stopReason = reason;

    if (this.closed) {
      return Promise.resolve({ terminal: "stopped", reason });
    }

    this.currentState = "stopping";
    const initialTermination = this.issueTermination(false);

    this.stopPromise = new Promise<ProcessTreeStopResult>((resolve) => {
      let completed = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (result: ProcessTreeStopResult) => {
        if (completed) return;
        completed = true;
        if (timer) clearTimeout(timer);
        resolve(result);
      };
      const finishStopped = () => {
        if (completed || this.currentState === "stop-timeout") return;
        this.currentState = "stopped";
        finish({ terminal: "stopped", reason });
      };
      const beginForceGrace = () => {
        if (this.closed) {
          finishStopped();
          return;
        }
        void this.issueTermination(true);
        timer = setTimeout(() => {
          if (this.closed) {
            finishStopped();
            return;
          }
          this.currentState = "stop-timeout";
          finish({ terminal: "stop-timeout", reason });
        }, this.stopTimeoutMs);
      };

      // First grace allows cooperative SIGTERM/taskkill completion. Only after
      // it expires do we force-kill, then wait one more grace before admitting
      // that the process tree still has no verified terminal state.
      timer = setTimeout(beginForceGrace, this.stopTimeoutMs);
      void Promise.all([this.terminalPromise, initialTermination]).then(finishStopped);
    });

    return this.stopPromise;
  }

  private issueTermination(force: boolean): Promise<void> {
    const fallback = () => {
      try {
        this.child.kill(force ? "SIGKILL" : "SIGTERM");
      } catch {
        // The real exit event remains authoritative.
      }
    };
    try {
      return Promise.resolve(this.terminateTree({
        child: this.child,
        pid: this.child.pid,
        platform: this.platform,
        force,
      })).catch(() => {
        fallback();
      });
    } catch {
      fallback();
      return Promise.resolve();
    }
  }

  private recordExit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.exit) return;
    this.exit = { code, signal };
    this.resolveExit(this.exit);
  }

  private recordClose(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.closed) return;
    this.closed = true;
    if (!this.exit) this.recordExit(code, signal);
    if (this.currentState === "running") {
      this.currentState = "exited";
    } else if (this.currentState === "stopping") {
      this.currentState = "stopped";
    }
    this.resolveClose();
  }
}
