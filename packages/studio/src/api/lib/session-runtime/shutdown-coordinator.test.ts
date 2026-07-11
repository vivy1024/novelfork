import { describe, expect, it, vi } from "vitest";

import {
  createSessionRuntimeDisposer,
  createShutdownCoordinator,
  createShutdownSignalHandler,
  type SessionRuntimeDisposeReport,
} from "./shutdown-coordinator.js";

function cleanDisposeReport(sessionId: string): SessionRuntimeDisposeReport {
  return {
    status: "clean",
    sessionId,
    steps: [
      { name: "turn-gate", status: "completed" },
      { name: "resource-tree", status: "completed" },
      { name: "decisions", status: "completed" },
    ],
    queuedCancellations: [],
    resources: [],
    stuckResourceIds: [],
    errors: [],
  };
}

describe("SessionRuntimeDisposer", () => {
  it("is idempotent and follows gate settlement -> child-first resources -> decisions order", async () => {
    const calls: string[] = [];
    const disposer = createSessionRuntimeDisposer({
      stopDeadlineMs: 100,
      disposeTurnGate: vi.fn(async () => {
        calls.push("turn-gate-settled");
        return [{ reason: "session-disposed" as const, sequence: 1 }];
      }),
      disposeResourceTree: vi.fn(async () => {
        calls.push("resource-tree-child-first");
        return {
          ok: true,
          ownerSessionId: "session-a",
          reason: "session-dispose" as const,
          resources: [
            { id: "browser-child", kind: "browser" as const, status: "stopped" as const },
            { id: "agent-parent", kind: "agent" as const, status: "stopped" as const },
          ],
        };
      }),
      disposeFollowUps: vi.fn(async () => {
        calls.push("follow-ups");
        return { ok: true, ownerSessionId: "session-a", errors: [] };
      }),
      cleanupDecisions: vi.fn(async () => {
        calls.push("decisions");
      }),
    });

    const first = disposer.disposeSessionRuntime("session-a");
    const second = disposer.disposeSessionRuntime("session-a");

    expect(second).toBe(first);
    await expect(first).resolves.toMatchObject({
      status: "clean",
      queuedCancellations: [{ reason: "session-disposed", sequence: 1 }],
      resources: [
        { id: "browser-child", status: "stopped" },
        { id: "agent-parent", status: "stopped" },
      ],
    });
    expect(calls).toEqual(["turn-gate-settled", "resource-tree-child-first", "follow-ups", "decisions"]);
  });

  it("continues later cleanup after one step fails and returns a structured unclean report", async () => {
    const calls: string[] = [];
    const disposer = createSessionRuntimeDisposer({
      stopDeadlineMs: 100,
      disposeTurnGate: async () => {
        calls.push("gate");
        throw new Error("gate observer failed");
      },
      disposeResourceTree: async () => {
        calls.push("resources");
        return {
          ok: false,
          ownerSessionId: "session-b",
          reason: "session-dispose" as const,
          resources: [
            { id: "bash-stuck", kind: "bash" as const, status: "failed" as const, error: "stop-timeout: pid still alive" },
            { id: "browser-cleaned", kind: "browser" as const, status: "stopped" as const },
          ],
        };
      },
      cleanupDecisions: async () => {
        calls.push("decisions");
        throw new Error("decision cleanup failed");
      },
    });

    const report = await disposer.disposeSessionRuntime("session-b");

    expect(calls).toEqual(["gate", "resources", "decisions"]);
    expect(report).toMatchObject({
      status: "unclean",
      stuckResourceIds: ["bash-stuck"],
      steps: [
        { name: "turn-gate", status: "failed", error: "gate observer failed" },
        { name: "resource-tree", status: "stop-timeout" },
        { name: "decisions", status: "failed", error: "decision cleanup failed" },
      ],
    });
    expect(report.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ step: "turn-gate", message: "gate observer failed" }),
      expect.objectContaining({ step: "resource-tree", resourceId: "bash-stuck" }),
      expect.objectContaining({ step: "decisions", message: "decision cleanup failed" }),
    ]));
  });

  it("bounds a stuck active turn, marks it stop-timeout, and still runs resources and decisions", async () => {
    const calls: string[] = [];
    const disposer = createSessionRuntimeDisposer({
      stopDeadlineMs: 5,
      disposeTurnGate: async () => {
        calls.push("gate");
        await new Promise<void>(() => undefined);
        return [];
      },
      disposeResourceTree: async () => {
        calls.push("resources");
        return { ok: true, ownerSessionId: "session-c", reason: "session-dispose" as const, resources: [] };
      },
      cleanupDecisions: async () => {
        calls.push("decisions");
      },
    });

    const report = await disposer.disposeSessionRuntime("session-c");

    expect(calls).toEqual(["gate", "resources", "decisions"]);
    expect(report.status).toBe("unclean");
    expect(report.steps[0]).toMatchObject({ name: "turn-gate", status: "stop-timeout" });
    expect(report.stuckResourceIds).toEqual(["turn:session-c"]);
  });

  it("retries an unclean runtime disposal instead of caching the first diagnostic report forever", async () => {
    const disposeResourceTree = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        ownerSessionId: "session-retry",
        reason: "session-dispose" as const,
        resources: [{ id: "bash-late", kind: "bash" as const, status: "failed" as const, error: "stop-timeout" }],
      })
      .mockResolvedValueOnce({
        ok: true,
        ownerSessionId: "session-retry",
        reason: "session-dispose" as const,
        resources: [{ id: "bash-late", kind: "bash" as const, status: "stopped" as const }],
      });
    const disposer = createSessionRuntimeDisposer({
      stopDeadlineMs: 100,
      disposeTurnGate: async () => [],
      disposeResourceTree,
      cleanupDecisions: async () => {},
    });

    expect((await disposer.disposeSessionRuntime("session-retry")).status).toBe("unclean");
    expect((await disposer.disposeSessionRuntime("session-retry")).status).toBe("clean");
    expect(disposeResourceTree).toHaveBeenCalledTimes(2);
  });
});

describe("ShutdownCoordinator", () => {
  it("drains all sessions and resources before terminal persistence, server/database close, marker clear, and clean exit", async () => {
    const calls: string[] = [];
    const coordinator = createShutdownCoordinator({
      stopDeadlineMs: 100,
      enterDraining: () => { calls.push("draining"); },
      listSessionIds: async () => ["session-a", "session-b"],
      disposeSessionRuntime: async (sessionId) => {
        calls.push(`dispose:${sessionId}`);
        return cleanDisposeReport(sessionId);
      },
      disposeRemainingResources: async () => {
        calls.push("remaining-resources");
        return [];
      },
      persistTerminalStates: async () => { calls.push("terminal-states"); },
      marker: {
        preserve: async () => { calls.push("marker-preserve"); },
        clear: async () => { calls.push("marker-clear"); },
      },
      server: { close: async () => { calls.push("server-close"); } },
      database: { close: async () => { calls.push("database-close"); } },
      exit: (code) => { calls.push(`exit:${code}`); },
    });

    const report = await coordinator.shutdown("SIGTERM");

    expect(report).toMatchObject({ status: "clean", signal: "SIGTERM", stuckResourceIds: [] });
    expect(calls[0]).toBe("draining");
    expect(calls.indexOf("terminal-states")).toBeGreaterThan(calls.indexOf("remaining-resources"));
    expect(calls).toEqual(expect.arrayContaining(["dispose:session-a", "dispose:session-b"]));
    expect(calls.slice(-4)).toEqual(["server-close", "database-close", "marker-clear", "exit:0"]);
    expect(calls).not.toContain("marker-preserve");
  });

  it("keeps draining and diagnostic infrastructure alive on stop-timeout", async () => {
    const calls: string[] = [];
    const unclean = cleanDisposeReport("session-stuck");
    unclean.status = "unclean";
    unclean.steps[1] = { name: "resource-tree", status: "stop-timeout" };
    unclean.stuckResourceIds.push("bash-stuck");
    unclean.errors.push({ step: "resource-tree", message: "stop-timeout", resourceId: "bash-stuck" });

    const coordinator = createShutdownCoordinator({
      stopDeadlineMs: 100,
      enterDraining: () => { calls.push("draining"); },
      listSessionIds: async () => ["session-stuck"],
      disposeSessionRuntime: async () => unclean,
      disposeRemainingResources: async () => [],
      persistTerminalStates: async () => { calls.push("terminal-states"); },
      marker: {
        preserve: async (report) => { calls.push(`marker-preserve:${report.stuckResourceIds.join(",")}`); },
        clear: async () => { calls.push("marker-clear"); },
      },
      server: { close: async () => { calls.push("server-close"); } },
      database: { close: async () => { calls.push("database-close"); } },
      exit: (code) => { calls.push(`exit:${code}`); },
    });

    const report = await coordinator.shutdown("SIGINT");

    expect(report).toMatchObject({ status: "unclean", stuckResourceIds: ["bash-stuck"] });
    expect(calls).toEqual(["draining", "marker-preserve:bash-stuck"]);
  });

  it("allows a later shutdown attempt to become clean after an unclean attempt settles late", async () => {
    const disposeSessionRuntime = vi.fn()
      .mockResolvedValueOnce({
        ...cleanDisposeReport("session-late"),
        status: "unclean" as const,
        stuckResourceIds: ["bash-late"],
        errors: [{ step: "resource-tree" as const, message: "stop-timeout", resourceId: "bash-late" }],
      })
      .mockResolvedValueOnce(cleanDisposeReport("session-late"));
    const exit = vi.fn();
    const coordinator = createShutdownCoordinator({
      stopDeadlineMs: 100,
      enterDraining: () => {},
      listSessionIds: async () => ["session-late"],
      disposeSessionRuntime,
      disposeRemainingResources: async () => [],
      persistTerminalStates: async () => {},
      marker: { preserve: async () => {}, clear: async () => {} },
      server: { close: async () => {} },
      database: { close: async () => {} },
      exit,
    });

    expect((await coordinator.shutdown("SIGINT")).status).toBe("unclean");
    expect((await coordinator.shutdown("SIGTERM")).status).toBe("clean");
    expect(disposeSessionRuntime).toHaveBeenCalledTimes(2);
    expect(exit).toHaveBeenCalledWith(0, "SIGTERM");
  });

  it("shares one direct coordinator attempt concurrently but retries after an unclean result", async () => {
    let releaseFirst!: () => void;
    const firstAttempt = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const disposeSessionRuntime = vi.fn()
      .mockImplementationOnce(async () => {
        await firstAttempt;
        return {
          ...cleanDisposeReport("session-shared-retry"),
          status: "unclean" as const,
          stuckResourceIds: ["bash-late"],
          errors: [{ step: "resource-tree" as const, message: "stop-timeout", resourceId: "bash-late" }],
        };
      })
      .mockResolvedValueOnce(cleanDisposeReport("session-shared-retry"));
    const coordinator = createShutdownCoordinator({
      stopDeadlineMs: 100,
      enterDraining: () => {},
      listSessionIds: async () => ["session-shared-retry"],
      disposeSessionRuntime,
      disposeRemainingResources: async () => [],
      persistTerminalStates: async () => {},
      marker: { preserve: async () => {}, clear: async () => {} },
      server: { close: async () => {} },
      database: { close: async () => {} },
      exit: () => {},
    });

    const first = coordinator.shutdown("SIGINT");
    const concurrent = coordinator.shutdown("SIGTERM");
    expect(concurrent).toBe(first);
    releaseFirst();
    expect((await first).status).toBe("unclean");
    expect((await coordinator.shutdown("SIGTERM")).status).toBe("clean");
    expect(disposeSessionRuntime).toHaveBeenCalledTimes(2);
  });

  it("lets the signal handler retry after an unclean report while sharing only in-flight attempts", async () => {
    const shutdown = vi.fn()
      .mockResolvedValueOnce({ status: "unclean" as const, signal: "SIGINT" as const, sessions: [], resources: [], stuckResourceIds: ["late"], errors: [] })
      .mockResolvedValueOnce({ status: "clean" as const, signal: "SIGTERM" as const, sessions: [], resources: [], stuckResourceIds: [], errors: [] });
    const handler = createShutdownSignalHandler({ shutdown });

    expect((await handler("SIGINT")).status).toBe("unclean");
    expect((await handler("SIGTERM")).status).toBe("clean");
    expect(shutdown).toHaveBeenCalledTimes(2);
  });

  it("shares one shutdown promise across repeated signals", async () => {
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => { release = resolve; });
    const shutdown = vi.fn(async () => {
      await blocker;
      return { status: "clean" as const, signal: "SIGINT", sessions: [], resources: [], stuckResourceIds: [], errors: [] };
    });
    const handler = createShutdownSignalHandler({ shutdown });

    const first = handler("SIGINT");
    const second = handler("SIGTERM");

    expect(second).toBe(first);
    expect(shutdown).toHaveBeenCalledTimes(1);
    release();
    await expect(first).resolves.toMatchObject({ status: "clean" });
  });
});
