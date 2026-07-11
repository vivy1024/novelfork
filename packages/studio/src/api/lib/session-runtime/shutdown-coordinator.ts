import {
  getSessionRuntimeResourceRegistry,
  type DisposeReport,
  type ResourceDisposeResult,
} from "./resource-registry.js";
import {
  getSessionRuntimeFollowUpTracker,
  type FollowUpDisposeReport,
} from "./follow-up-tracker.js";

export type ShutdownSignal = "SIGINT" | "SIGTERM" | "beforeExit" | "manual";
export type CleanupStepName = "turn-gate" | "resource-tree" | "follow-ups" | "decisions";
export type CleanupStepStatus = "completed" | "failed" | "stop-timeout";

export interface QueuedSessionDisposal {
  readonly reason: "session-disposed";
  readonly sequence: number;
}

export interface SessionRuntimeDisposeStep {
  readonly name: CleanupStepName;
  readonly status: CleanupStepStatus;
  readonly error?: string;
}

export interface StructuredCleanupError {
  readonly step: CleanupStepName | "shutdown" | "terminal-states" | "server" | "database" | "marker";
  readonly message: string;
  readonly resourceId?: string;
  readonly sessionId?: string;
}

export interface SessionRuntimeDisposeReport {
  status: "clean" | "unclean";
  readonly sessionId: string;
  readonly steps: SessionRuntimeDisposeStep[];
  readonly queuedCancellations: QueuedSessionDisposal[];
  readonly resources: ResourceDisposeResult[];
  readonly stuckResourceIds: string[];
  readonly errors: StructuredCleanupError[];
}

export interface SessionRuntimeDisposerDependencies {
  readonly disposeTurnGate: (sessionId: string) => Promise<readonly QueuedSessionDisposal[]>;
  readonly disposeResourceTree: (sessionId: string) => Promise<DisposeReport>;
  readonly disposeFollowUps?: (sessionId: string) => Promise<FollowUpDisposeReport>;
  readonly cleanupDecisions: (sessionId: string) => Promise<void> | void;
  readonly stopDeadlineMs: number;
}

export interface SessionRuntimeDisposer {
  disposeSessionRuntime(sessionId: string): Promise<SessionRuntimeDisposeReport>;
}

type DeadlineResult<T> =
  | { readonly status: "completed"; readonly value: T }
  | { readonly status: "failed"; readonly error: unknown }
  | { readonly status: "stop-timeout" };

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error) || String(error);
  } catch {
    return "unserializable cleanup error";
  }
}

function isStopTimeout(value: string | undefined): boolean {
  return Boolean(value?.toLowerCase().includes("stop-timeout"));
}

function withDeadline<T>(operation: Promise<T>, deadlineMs: number): Promise<DeadlineResult<T>> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: DeadlineResult<T>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => finish({ status: "stop-timeout" }), deadlineMs);
    operation.then(
      (value) => finish({ status: "completed", value }),
      (error) => finish({ status: "failed", error }),
    );
  });
}

export function createSessionRuntimeDisposer(dependencies: SessionRuntimeDisposerDependencies): SessionRuntimeDisposer {
  const inFlight = new Map<string, Promise<SessionRuntimeDisposeReport>>();
  const completed = new Map<string, Promise<SessionRuntimeDisposeReport>>();

  const runDispose = async (sessionId: string): Promise<SessionRuntimeDisposeReport> => {
    const steps: SessionRuntimeDisposeStep[] = [];
    const queuedCancellations: QueuedSessionDisposal[] = [];
    const resources: ResourceDisposeResult[] = [];
    const stuckResourceIds: string[] = [];
    const errors: StructuredCleanupError[] = [];

    const gate = await withDeadline(Promise.resolve().then(() => dependencies.disposeTurnGate(sessionId)), dependencies.stopDeadlineMs);
    if (gate.status === "completed") {
      queuedCancellations.push(...gate.value);
      steps.push({ name: "turn-gate", status: "completed" });
    } else if (gate.status === "stop-timeout") {
      const resourceId = `turn:${sessionId}`;
      stuckResourceIds.push(resourceId);
      steps.push({ name: "turn-gate", status: "stop-timeout" });
      errors.push({ step: "turn-gate", message: "stop-timeout: active turn did not settle", resourceId, sessionId });
    } else {
      const message = errorMessage(gate.error);
      steps.push({ name: "turn-gate", status: "failed", error: message });
      errors.push({ step: "turn-gate", message, sessionId });
    }

    const resourceTree = await withDeadline(
      Promise.resolve().then(() => dependencies.disposeResourceTree(sessionId)),
      dependencies.stopDeadlineMs,
    );
    if (resourceTree.status === "completed") {
      resources.push(...resourceTree.value.resources);
      for (const resource of resourceTree.value.resources) {
        if (!resource.error) continue;
        errors.push({ step: "resource-tree", message: resource.error, resourceId: resource.id, sessionId });
        if (isStopTimeout(resource.error)) stuckResourceIds.push(resource.id);
      }
      const timedOut = resourceTree.value.resources.some((resource) => isStopTimeout(resource.error));
      const status: CleanupStepStatus = timedOut ? "stop-timeout" : resourceTree.value.ok ? "completed" : "failed";
      steps.push({ name: "resource-tree", status });
      if (!resourceTree.value.ok && resourceTree.value.resources.length === 0) {
        errors.push({ step: "resource-tree", message: "resource disposal reported an unspecified failure", sessionId });
      }
    } else if (resourceTree.status === "stop-timeout") {
      const resourceId = `resource-tree:${sessionId}`;
      stuckResourceIds.push(resourceId);
      steps.push({ name: "resource-tree", status: "stop-timeout" });
      errors.push({ step: "resource-tree", message: "stop-timeout: resource tree did not settle", resourceId, sessionId });
    } else {
      const message = errorMessage(resourceTree.error);
      steps.push({ name: "resource-tree", status: "failed", error: message });
      errors.push({ step: "resource-tree", message, sessionId });
    }

    if (dependencies.disposeFollowUps) {
      const followUps = await withDeadline(
        Promise.resolve().then(() => dependencies.disposeFollowUps!(sessionId)),
        dependencies.stopDeadlineMs,
      );
      if (followUps.status === "completed") {
        const followUpErrors = followUps.value.errors;
        steps.push({ name: "follow-ups", status: followUps.value.ok ? "completed" : "failed" });
        for (const failure of followUpErrors) {
          errors.push({ step: "follow-ups", message: `${failure.label}: ${failure.message}`, sessionId });
        }
      } else if (followUps.status === "stop-timeout") {
        const resourceId = `follow-ups:${sessionId}`;
        stuckResourceIds.push(resourceId);
        steps.push({ name: "follow-ups", status: "stop-timeout" });
        errors.push({ step: "follow-ups", message: "stop-timeout: follow-up tasks did not settle", resourceId, sessionId });
      } else {
        const message = errorMessage(followUps.error);
        steps.push({ name: "follow-ups", status: "failed", error: message });
        errors.push({ step: "follow-ups", message, sessionId });
      }
    }

    const decisions = await withDeadline(
      Promise.resolve().then(() => dependencies.cleanupDecisions(sessionId)),
      dependencies.stopDeadlineMs,
    );
    if (decisions.status === "completed") {
      steps.push({ name: "decisions", status: "completed" });
    } else if (decisions.status === "stop-timeout") {
      const resourceId = `decision:${sessionId}`;
      stuckResourceIds.push(resourceId);
      steps.push({ name: "decisions", status: "stop-timeout" });
      errors.push({ step: "decisions", message: "stop-timeout: decision cleanup did not settle", resourceId, sessionId });
    } else {
      const message = errorMessage(decisions.error);
      steps.push({ name: "decisions", status: "failed", error: message });
      errors.push({ step: "decisions", message, sessionId });
    }

    return {
      status: steps.every((step) => step.status === "completed") && errors.length === 0 ? "clean" : "unclean",
      sessionId,
      steps,
      queuedCancellations,
      resources,
      stuckResourceIds: [...new Set(stuckResourceIds)],
      errors,
    };
  };

  return {
    disposeSessionRuntime(sessionId: string): Promise<SessionRuntimeDisposeReport> {
      const existing = completed.get(sessionId) ?? inFlight.get(sessionId);
      if (existing) return existing;

      const attempt = runDispose(sessionId);
      let operation!: Promise<SessionRuntimeDisposeReport>;
      operation = attempt.finally(() => {
        if (inFlight.get(sessionId) === operation) inFlight.delete(sessionId);
      });
      inFlight.set(sessionId, operation);
      void operation.then((report) => {
        if (report.status === "clean") completed.set(sessionId, operation);
      });
      return operation;
    },
  };
}

let serverDraining = false;

export function enterServerDraining(): void {
  serverDraining = true;
}

export function isServerDraining(): boolean {
  return serverDraining;
}

const processSessionRuntimeDisposer = createSessionRuntimeDisposer({
  stopDeadlineMs: 15_000,
  async disposeTurnGate(sessionId) {
    const chatRuntime = await import("../session-chat-service.js");
    return chatRuntime.disposeSessionTurnGate(sessionId);
  },
  disposeResourceTree(sessionId) {
    return getSessionRuntimeResourceRegistry().disposeSession(sessionId, "session-dispose");
  },
  disposeFollowUps(sessionId) {
    return getSessionRuntimeFollowUpTracker().disposeOwner(sessionId);
  },
  async cleanupDecisions(sessionId) {
    const chatRuntime = await import("../session-chat-service.js");
    await chatRuntime.cleanupDisposedSessionRuntime(sessionId);
  },
});

export function disposeSessionRuntime(sessionId: string): Promise<SessionRuntimeDisposeReport> {
  return processSessionRuntimeDisposer.disposeSessionRuntime(sessionId);
}

export interface ShutdownMarkerAdapter {
  preserve(report: ShutdownReport): Promise<void> | void;
  clear(): Promise<void> | void;
}

export interface ShutdownCoordinatorDependencies {
  readonly enterDraining: () => Promise<void> | void;
  readonly listSessionIds: () => Promise<readonly string[]>;
  readonly disposeSessionRuntime: (sessionId: string) => Promise<SessionRuntimeDisposeReport>;
  readonly disposeRemainingResources?: () => Promise<readonly DisposeReport[]>;
  readonly persistTerminalStates: (reports: readonly SessionRuntimeDisposeReport[]) => Promise<void> | void;
  readonly marker: ShutdownMarkerAdapter;
  readonly server: { close(): Promise<void> | void };
  readonly database: { close(): Promise<void> | void };
  readonly exit: (code: number, signal: ShutdownSignal) => void;
  readonly stopDeadlineMs: number;
}

export interface ShutdownReport {
  status: "clean" | "unclean";
  readonly signal: ShutdownSignal;
  readonly sessions: SessionRuntimeDisposeReport[];
  readonly resources: ResourceDisposeResult[];
  readonly stuckResourceIds: string[];
  readonly errors: StructuredCleanupError[];
}

export interface ShutdownCoordinator {
  shutdown(signal?: ShutdownSignal): Promise<ShutdownReport>;
}

export function createShutdownCoordinator(dependencies: ShutdownCoordinatorDependencies): ShutdownCoordinator {
  let inFlightShutdown: Promise<ShutdownReport> | undefined;
  let completedCleanShutdown: Promise<ShutdownReport> | undefined;

  const performShutdown = async (signal: ShutdownSignal): Promise<ShutdownReport> => {
    const sessions: SessionRuntimeDisposeReport[] = [];
    const resources: ResourceDisposeResult[] = [];
    const stuckResourceIds: string[] = [];
    const errors: StructuredCleanupError[] = [];

    try {
      await dependencies.enterDraining();
    } catch (error) {
      errors.push({ step: "shutdown", message: `failed to enter draining: ${errorMessage(error)}` });
    }

    let sessionIds: readonly string[] = [];
    try {
      sessionIds = [...new Set(await dependencies.listSessionIds())];
    } catch (error) {
      errors.push({ step: "shutdown", message: `failed to list sessions: ${errorMessage(error)}` });
    }

    const sessionResults = await Promise.all(sessionIds.map(async (sessionId) => {
      const result = await withDeadline(dependencies.disposeSessionRuntime(sessionId), dependencies.stopDeadlineMs);
      if (result.status === "completed") return result.value;
      const timedOut = result.status === "stop-timeout";
      const resourceId = `session:${sessionId}`;
      return {
        status: "unclean" as const,
        sessionId,
        steps: [{ name: "turn-gate" as const, status: timedOut ? "stop-timeout" as const : "failed" as const }],
        queuedCancellations: [],
        resources: [],
        stuckResourceIds: timedOut ? [resourceId] : [],
        errors: [{
          step: "shutdown" as const,
          message: timedOut ? "stop-timeout: session runtime disposal did not settle" : errorMessage(result.error),
          resourceId: timedOut ? resourceId : undefined,
          sessionId,
        }],
      };
    }));
    sessions.push(...sessionResults);
    for (const report of sessions) {
      resources.push(...report.resources);
      stuckResourceIds.push(...report.stuckResourceIds);
      errors.push(...report.errors);
    }

    if (dependencies.disposeRemainingResources) {
      const remaining = await withDeadline(dependencies.disposeRemainingResources(), dependencies.stopDeadlineMs);
      if (remaining.status === "completed") {
        for (const report of remaining.value) {
          resources.push(...report.resources);
          for (const resource of report.resources) {
            if (!resource.error) continue;
            errors.push({ step: "resource-tree", message: resource.error, resourceId: resource.id });
            if (isStopTimeout(resource.error)) stuckResourceIds.push(resource.id);
          }
          if (!report.ok && report.resources.length === 0) {
            errors.push({ step: "resource-tree", message: `remaining owner cleanup failed: ${report.ownerSessionId}` });
          }
        }
      } else if (remaining.status === "stop-timeout") {
        stuckResourceIds.push("resource-tree:remaining");
        errors.push({ step: "resource-tree", message: "stop-timeout: remaining resources did not settle", resourceId: "resource-tree:remaining" });
      } else {
        errors.push({ step: "resource-tree", message: errorMessage(remaining.error) });
      }
    }

    let report: ShutdownReport = {
      status: sessions.every((session) => session.status === "clean") && errors.length === 0 ? "clean" : "unclean",
      signal,
      sessions,
      resources,
      stuckResourceIds: [...new Set(stuckResourceIds)],
      errors,
    };

    if (report.status === "unclean") {
      try {
        await dependencies.marker.preserve(report);
      } catch (error) {
        errors.push({ step: "marker", message: errorMessage(error) });
      }
      return report;
    }

    try {
      await dependencies.persistTerminalStates(sessions);
    } catch (error) {
      errors.push({ step: "terminal-states", message: errorMessage(error) });
    }
    if (errors.length === 0) {
      try {
        await dependencies.server.close();
      } catch (error) {
        errors.push({ step: "server", message: errorMessage(error) });
      }
    }
    if (errors.length === 0) {
      try {
        await dependencies.database.close();
      } catch (error) {
        errors.push({ step: "database", message: errorMessage(error) });
      }
    }
    if (errors.length === 0) {
      try {
        await dependencies.marker.clear();
      } catch (error) {
        errors.push({ step: "marker", message: errorMessage(error) });
      }
    }

    if (errors.length > 0) {
      report = { ...report, status: "unclean", errors };
      try {
        await dependencies.marker.preserve(report);
      } catch (error) {
        errors.push({ step: "marker", message: errorMessage(error) });
      }
      return report;
    }

    dependencies.exit(0, signal);
    return report;
  };

  return {
    shutdown(signal = "manual"): Promise<ShutdownReport> {
      if (completedCleanShutdown) return completedCleanShutdown;
      if (inFlightShutdown) return inFlightShutdown;

      const attempt = performShutdown(signal);
      let operation!: Promise<ShutdownReport>;
      operation = attempt.finally(() => {
        if (inFlightShutdown === operation) inFlightShutdown = undefined;
      });
      inFlightShutdown = operation;
      void operation.then((report) => {
        if (report.status === "clean") completedCleanShutdown = operation;
      });
      return operation;
    },
  };
}

export function createShutdownSignalHandler(coordinator: ShutdownCoordinator): (signal: ShutdownSignal) => Promise<ShutdownReport> {
  let inFlightSignal: Promise<ShutdownReport> | undefined;
  let completedCleanSignal: Promise<ShutdownReport> | undefined;
  return (signal: ShutdownSignal) => {
    if (completedCleanSignal) return completedCleanSignal;
    if (inFlightSignal) return inFlightSignal;

    const attempt = coordinator.shutdown(signal);
    let operation!: Promise<ShutdownReport>;
    operation = attempt.finally(() => {
      if (inFlightSignal === operation) inFlightSignal = undefined;
    });
    inFlightSignal = operation;
    void operation.then((report) => {
      if (report.status === "clean") completedCleanSignal = operation;
    });
    return operation;
  };
}
