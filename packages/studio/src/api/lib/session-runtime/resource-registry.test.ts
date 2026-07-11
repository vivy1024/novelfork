import { describe, expect, it, vi } from "vitest";

import {
  SessionRuntimeResourceRegistry,
  createOwnedRuntimeResource,
  createRuntimeResourceId,
  type DisposeReason,
  type ResourceTerminalState,
  type RuntimeResourceKind,
} from "./resource-registry.js";

const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function disposable(status: ResourceTerminalState["status"] = "stopped") {
  return vi.fn<() => Promise<ResourceTerminalState>>(async () => ({ status }));
}

function resource(overrides: {
  id?: string;
  controlOwnerSessionId?: string;
  executionSessionId?: string;
  parentResourceId?: string;
  kind?: RuntimeResourceKind;
  status?: ResourceTerminalState["status"] | "running" | "stopping";
  createdAt?: number;
  value?: unknown;
  dispose?: (reason: DisposeReason) => Promise<ResourceTerminalState>;
} = {}) {
  return createOwnedRuntimeResource({
    id: overrides.id,
    controlOwnerSessionId: overrides.controlOwnerSessionId ?? "owner-a",
    executionSessionId: overrides.executionSessionId ?? "owner-a",
    parentResourceId: overrides.parentResourceId,
    kind: overrides.kind ?? "bash",
    status: overrides.status ?? "running",
    createdAt: overrides.createdAt,
    value: overrides.value ?? {},
    dispose: overrides.dispose ?? disposable(),
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

describe("SessionRuntimeResourceRegistry", () => {
  it("creates full unpredictable UUID resource ids without truncation", () => {
    const ids = Array.from({ length: 12 }, () => createRuntimeResourceId());

    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(uuidV4Pattern);
      expect(id).toHaveLength(36);
    }
  });

  it("filters get/list by control owner and kind without leaking existence", () => {
    const registry = new SessionRuntimeResourceRegistry();
    const ownerBrowser = resource({ kind: "browser", controlOwnerSessionId: "owner-a", executionSessionId: "owner-a" });
    const ownerAgent = resource({ kind: "agent", controlOwnerSessionId: "owner-a", executionSessionId: "child-agent-session" });
    const otherBrowser = resource({ kind: "browser", controlOwnerSessionId: "owner-b", executionSessionId: "owner-b" });

    registry.register(ownerBrowser);
    registry.register(ownerAgent);
    registry.register(otherBrowser);

    expect(registry.getOwned("owner-a", "browser", ownerBrowser.id)).toBe(ownerBrowser);
    expect(registry.getOwned("owner-b", "browser", ownerBrowser.id)).toBeNull();
    expect(registry.getOwned("owner-a", "agent", ownerBrowser.id)).toBeNull();
    expect(registry.getOwned("owner-a", "browser", "missing-id")).toBeNull();
    expect(registry.listOwned("owner-a").map((item) => item.id)).toEqual([ownerBrowser.id, ownerAgent.id]);
    expect(registry.listOwned("owner-a", "browser").map((item) => item.id)).toEqual([ownerBrowser.id]);
    expect(registry.listOwned("owner-b", "browser").map((item) => item.id)).toEqual([otherBrowser.id]);
  });

  it("uses atomic transitions so TaskStop and natural completion race to one terminal state", () => {
    const registry = new SessionRuntimeResourceRegistry();
    const task = resource({ kind: "agent", status: "running" });
    registry.register(task);

    expect(registry.transition(task.id, ["running"], "completed")).toBe(true);
    expect(registry.transition(task.id, ["running"], "stopping")).toBe(false);
    expect(registry.transition(task.id, ["stopping"], "stopped")).toBe(false);
    expect(registry.getOwned("owner-a", "agent", task.id)?.status).toBe("completed");

    const stoppedFirst = resource({ kind: "bash", status: "running" });
    registry.register(stoppedFirst);
    expect(registry.transition(stoppedFirst.id, ["running"], "stopping")).toBe(true);
    expect(registry.transition(stoppedFirst.id, ["running"], "completed")).toBe(false);
    expect(registry.transition(stoppedFirst.id, ["stopping"], "stopped")).toBe(true);
    expect(registry.transition(stoppedFirst.id, ["stopped"], "completed")).toBe(false);
    expect(registry.getOwned("owner-a", "bash", stoppedFirst.id)?.status).toBe("stopped");
  });

  it("disposes a parent tree across parentResourceId and child executionSessionId resources", async () => {
    const registry = new SessionRuntimeResourceRegistry();
    const calls: string[] = [];
    const parent = resource({
      kind: "agent",
      executionSessionId: "child-session",
      dispose: async () => {
        calls.push("parent");
        return { status: "stopped" };
      },
    });
    const childByParent = resource({
      kind: "bash",
      executionSessionId: "child-session",
      parentResourceId: parent.id,
      dispose: async () => {
        calls.push("child-by-parent");
        return { status: "stopped" };
      },
    });
    const childByExecutionSession = resource({
      kind: "browser",
      executionSessionId: "child-session",
      dispose: async () => {
        calls.push("child-by-exec-session");
        return { status: "completed" };
      },
    });
    const nestedChildSession = resource({
      kind: "agent",
      executionSessionId: "grandchild-session",
      parentResourceId: childByParent.id,
      dispose: async () => {
        calls.push("nested-agent");
        return { status: "interrupted" };
      },
    });
    const grandchildByExecutionSession = resource({
      kind: "capture-pipeline",
      executionSessionId: "grandchild-session",
      dispose: async () => {
        calls.push("grandchild-by-exec-session");
        return { status: "stopped" };
      },
    });
    const unrelatedSameOwner = resource({ kind: "decision", executionSessionId: "owner-a" });
    const unrelatedOtherOwner = resource({ kind: "bash", controlOwnerSessionId: "owner-b", executionSessionId: "child-session" });

    for (const item of [
      parent,
      childByParent,
      childByExecutionSession,
      nestedChildSession,
      grandchildByExecutionSession,
      unrelatedSameOwner,
      unrelatedOtherOwner,
    ]) {
      registry.register(item);
    }

    const report = await registry.disposeResourceTree("owner-a", parent.id, "task-stop");

    expect(report.ok).toBe(true);
    expect(report.resources.map((item) => item.id)).toEqual([
      grandchildByExecutionSession.id,
      nestedChildSession.id,
      childByParent.id,
      childByExecutionSession.id,
      parent.id,
    ]);
    expect(calls).toEqual(["grandchild-by-exec-session", "nested-agent", "child-by-parent", "child-by-exec-session", "parent"]);
    expect(report.resources.map((item) => ({ id: item.id, status: item.status }))).toEqual([
      { id: grandchildByExecutionSession.id, status: "stopped" },
      { id: nestedChildSession.id, status: "interrupted" },
      { id: childByParent.id, status: "stopped" },
      { id: childByExecutionSession.id, status: "completed" },
      { id: parent.id, status: "stopped" },
    ]);
    expect(registry.getOwned("owner-a", "decision", unrelatedSameOwner.id)).toBe(unrelatedSameOwner);
    expect(registry.getOwned("owner-b", "bash", unrelatedOtherOwner.id)).toBe(unrelatedOtherOwner);
  });

  it("disposes only an owner-scoped root's descendants without invoking the root disposer", async () => {
    const registry = new SessionRuntimeResourceRegistry();
    const calls: string[] = [];
    const root = resource({
      kind: "agent",
      executionSessionId: "child-session",
      dispose: async () => {
        calls.push("root");
        return { status: "stopped" };
      },
    });
    const child = resource({
      kind: "bash",
      executionSessionId: "child-session",
      parentResourceId: root.id,
      dispose: async () => {
        calls.push("child");
        return { status: "stopped" };
      },
    });
    const grandchild = resource({
      kind: "browser",
      executionSessionId: "child-session",
      parentResourceId: child.id,
      dispose: async () => {
        calls.push("grandchild");
        return { status: "completed" };
      },
    });
    const otherOwner = resource({
      controlOwnerSessionId: "owner-b",
      executionSessionId: "child-session",
      parentResourceId: root.id,
      kind: "decision",
    });

    registry.register(root);
    registry.register(child);
    registry.register(grandchild);
    expect(() => registry.register(otherOwner)).toThrow(/belongs to control owner owner-a/);

    const report = await registry.disposeResourceDescendants("owner-a", root.id, "session-dispose");

    expect(report.ok).toBe(true);
    expect(report.resources.map((item) => item.id)).toEqual([grandchild.id, child.id]);
    expect(calls).toEqual(["grandchild", "child"]);
    expect(root.status).toBe("running");
    await expect(registry.disposeResourceDescendants("owner-b", root.id, "session-dispose")).resolves.toEqual({
      ok: true,
      ownerSessionId: "owner-b",
      reason: "session-dispose",
      resources: [],
    });
  });

  it("keeps disposing siblings after failures and reports each real terminal state or error", async () => {
    const registry = new SessionRuntimeResourceRegistry();
    const root = resource({ kind: "agent", executionSessionId: "child-session", dispose: disposable("stopped") });
    const failed = resource({
      kind: "bash",
      executionSessionId: "child-session",
      parentResourceId: root.id,
      dispose: async () => {
        throw new Error("kill failed");
      },
    });
    const completed = resource({ kind: "browser", executionSessionId: "child-session", parentResourceId: root.id, dispose: disposable("completed") });
    const captureDisposed = resource({ kind: "capture-pipeline", executionSessionId: "child-session", parentResourceId: root.id, dispose: disposable("stopped") });

    registry.register(root);
    registry.register(failed);
    registry.register(completed);
    registry.register(captureDisposed);

    const report = await registry.disposeResourceTree("owner-a", root.id, "session-dispose");

    expect(report.ok).toBe(false);
    expect(report.resources).toEqual([
      { id: failed.id, kind: "bash", status: "failed", error: "kill failed" },
      { id: completed.id, kind: "browser", status: "completed" },
      { id: captureDisposed.id, kind: "capture-pipeline", status: "stopped" },
      { id: root.id, kind: "agent", status: "stopped" },
    ]);
    expect(registry.getOwned("owner-a", "bash", failed.id)?.status).toBe("failed");
    expect(registry.getOwned("owner-a", "browser", completed.id)?.status).toBe("completed");
    expect(registry.getOwned("owner-a", "capture-pipeline", captureDisposed.id)?.status).toBe("stopped");
  });

  it("marks dispose reports failed when terminal cleanup returns an error without failed status", async () => {
    const registry = new SessionRuntimeResourceRegistry();
    const stoppedWithError = resource({
      kind: "bash",
      dispose: async () => ({ status: "stopped", error: new Error("cleanup partial") }),
    });
    const completedWithError = resource({
      kind: "capture-pipeline",
      dispose: async () => ({ status: "completed", error: "completed with leaked handles" }),
    });

    registry.register(stoppedWithError);
    registry.register(completedWithError);

    const report = await registry.disposeSession("owner-a", "session-dispose");

    expect(report.ok).toBe(false);
    expect(report.resources).toEqual([
      { id: stoppedWithError.id, kind: "bash", status: "stopped", error: "cleanup partial" },
      { id: completedWithError.id, kind: "capture-pipeline", status: "completed", error: "completed with leaked handles" },
    ]);
    expect(report.resources[0].error).toBe("cleanup partial");
  });

  it("rejects cross-owner parent links whether the parent already exists or registers later", () => {
    const registry = new SessionRuntimeResourceRegistry();
    const parent = resource({ controlOwnerSessionId: "owner-a", executionSessionId: "owner-a", kind: "agent" });
    const child = resource({
      controlOwnerSessionId: "owner-b",
      executionSessionId: "owner-b",
      kind: "bash",
      parentResourceId: parent.id,
    });

    registry.register(parent);

    expect(() => registry.register(child)).toThrow(
      /parentResourceId .* belongs to control owner owner-a, but resource .* is owned by owner-b/,
    );

    const deferredRegistry = new SessionRuntimeResourceRegistry();
    const deferredParentId = createRuntimeResourceId();
    const deferredChild = resource({
      controlOwnerSessionId: "owner-a",
      executionSessionId: "owner-a",
      parentResourceId: deferredParentId,
      kind: "bash",
    });
    const crossOwnerParent = resource({
      id: deferredParentId,
      controlOwnerSessionId: "owner-b",
      executionSessionId: "owner-b",
      kind: "agent",
    });

    deferredRegistry.register(deferredChild);
    expect(() => deferredRegistry.register(crossOwnerParent)).toThrow(
      /would become parent of resource .* owned by owner-a, but parent is owned by owner-b/,
    );
    expect(deferredRegistry.getOwned("owner-b", "agent", deferredParentId)).toBeNull();
  });

  it("makes resource and session disposal idempotent", async () => {
    const registry = new SessionRuntimeResourceRegistry();
    const disposeRoot = disposable("stopped");
    const disposeChild = disposable("stopped");
    const root = resource({ kind: "agent", executionSessionId: "child-session", dispose: disposeRoot });
    const child = resource({ kind: "bash", executionSessionId: "child-session", parentResourceId: root.id, dispose: disposeChild });
    registry.register(root);
    registry.register(child);

    const first = await registry.disposeResourceTree("owner-a", root.id, "task-stop");
    const second = await registry.disposeResourceTree("owner-a", root.id, "task-stop");
    const session = await registry.disposeSession("owner-a", "session-dispose");

    expect(first.resources.map((item) => item.status)).toEqual(["stopped", "stopped"]);
    expect(second.resources.map((item) => item.status)).toEqual(["stopped", "stopped"]);
    expect(session.resources.map((item) => item.status)).toEqual(["stopped", "stopped"]);
    expect(disposeRoot).toHaveBeenCalledTimes(1);
    expect(disposeChild).toHaveBeenCalledTimes(1);
  });

  it("retries an unclean owner disposal after the underlying resource can really settle", async () => {
    const registry = new SessionRuntimeResourceRegistry();
    let canSettle = false;
    const disposeOwnerResource = vi.fn(async () => canSettle
      ? { status: "stopped" as const }
      : { status: "failed" as const, error: "stop-timeout: process still alive" });
    const ownerResource = resource({ kind: "bash", dispose: disposeOwnerResource });
    registry.register(ownerResource);

    const first = await registry.disposeSession("owner-a", "session-dispose");
    expect(first).toMatchObject({ ok: false, resources: [{ id: ownerResource.id, status: "failed", error: "stop-timeout: process still alive" }] });

    canSettle = true;
    const second = await registry.disposeSession("owner-a", "session-dispose");

    expect(second).toMatchObject({ ok: true, resources: [{ id: ownerResource.id, status: "stopped" }] });
    expect(disposeOwnerResource).toHaveBeenCalledTimes(2);
  });

  it("places an owner disposal barrier around disposeSession and shares concurrent cleanup", async () => {
    const registry = new SessionRuntimeResourceRegistry();
    const gate = deferred<ResourceTerminalState>();
    const disposeOwnerResource = vi.fn(async () => gate.promise);
    const ownerResource = resource({ kind: "bash", dispose: disposeOwnerResource });
    registry.register(ownerResource);

    const firstDispose = registry.disposeSession("owner-a", "session-dispose");
    const secondDispose = registry.disposeSession("owner-a", "session-dispose");

    expect(secondDispose).toBe(firstDispose);
    expect(() => registry.register(resource({ controlOwnerSessionId: "owner-a", executionSessionId: "owner-a" }))).toThrow(
      /session-runtime-disposed|disposed|disposing/,
    );

    const otherOwnerDuringDispose = resource({ controlOwnerSessionId: "owner-b", executionSessionId: "owner-b" });
    expect(() => registry.register(otherOwnerDuringDispose)).not.toThrow();

    gate.resolve({ status: "stopped" });
    const [firstReport, secondReport] = await Promise.all([firstDispose, secondDispose]);

    expect(firstReport).toEqual(secondReport);
    expect(firstReport.resources).toEqual([{ id: ownerResource.id, kind: "bash", status: "stopped" }]);
    expect(disposeOwnerResource).toHaveBeenCalledTimes(1);
    expect(() => registry.register(resource({ controlOwnerSessionId: "owner-a", executionSessionId: "owner-a" }))).toThrow(
      /session-runtime-disposed|disposed|disposing/,
    );
    expect(() => registry.register(resource({ controlOwnerSessionId: "owner-b", executionSessionId: "owner-b" }))).not.toThrow();
  });

  it("disposes session children before parents by hierarchy rather than registration order", async () => {
    const registry = new SessionRuntimeResourceRegistry();
    const calls: string[] = [];
    const parent = resource({
      kind: "agent",
      executionSessionId: "child-session",
      dispose: async () => {
        calls.push("parent");
        return { status: "stopped" };
      },
    });
    const explicitChild = resource({
      kind: "bash",
      executionSessionId: "owner-a",
      parentResourceId: parent.id,
      dispose: async () => {
        calls.push("explicit-child");
        return { status: "stopped" };
      },
    });
    const executionSessionChild = resource({
      kind: "browser",
      executionSessionId: "child-session",
      dispose: async () => {
        calls.push("execution-session-child");
        return { status: "completed" };
      },
    });

    registry.register(parent);
    registry.register(explicitChild);
    registry.register(executionSessionChild);

    const report = await registry.disposeSession("owner-a", "session-dispose");

    expect(report.resources.map((item) => item.id)).toEqual([explicitChild.id, executionSessionChild.id, parent.id]);
    expect(calls).toEqual(["explicit-child", "execution-session-child", "parent"]);
  });

  it("normalizes hostile dispose errors to a fixed fallback and keeps siblings disposing", async () => {
    const registry = new SessionRuntimeResourceRegistry();
    const hostile: Record<string, unknown> = {};
    hostile.self = hostile;
    Object.defineProperty(hostile, "toJSON", {
      enumerable: true,
      get() {
        throw new Error("toJSON exploded");
      },
    });
    Object.defineProperty(hostile, Symbol.toPrimitive, {
      value() {
        throw new Error("toPrimitive exploded");
      },
    });
    const first = resource({
      kind: "bash",
      dispose: async () => ({ status: "stopped", error: hostile }),
    });
    const sibling = resource({
      kind: "browser",
      dispose: async () => ({ status: "completed" }),
    });

    registry.register(first);
    registry.register(sibling);

    const report = await registry.disposeSession("owner-a", "session-dispose");

    expect(report.ok).toBe(false);
    expect(report.resources).toEqual([
      { id: first.id, kind: "bash", status: "stopped", error: "unserializable dispose error" },
      { id: sibling.id, kind: "browser", status: "completed" },
    ]);
    expect(registry.getOwned("owner-a", "bash", first.id)?.status).toBe("stopped");
    expect(registry.getOwned("owner-a", "browser", sibling.id)?.status).toBe("completed");
  });

  it("normalizes a thrown hostile error to the same fallback and still disposes siblings", async () => {
    const registry = new SessionRuntimeResourceRegistry();
    const hostile: Record<string, unknown> = {};
    hostile.self = hostile;
    Object.defineProperty(hostile, "toJSON", {
      enumerable: true,
      get() {
        throw new Error("toJSON exploded");
      },
    });
    Object.defineProperty(hostile, Symbol.toPrimitive, {
      value() {
        throw new Error("toPrimitive exploded");
      },
    });
    const first = resource({
      kind: "bash",
      dispose: async () => {
        throw hostile;
      },
    });
    const sibling = resource({
      kind: "browser",
      dispose: async () => ({ status: "completed" }),
    });

    registry.register(first);
    registry.register(sibling);

    const report = await registry.disposeSession("owner-a", "session-dispose");

    expect(report.ok).toBe(false);
    expect(report.resources).toEqual([
      { id: first.id, kind: "bash", status: "failed", error: "unserializable dispose error" },
      { id: sibling.id, kind: "browser", status: "completed" },
    ]);
    expect(registry.getOwned("owner-a", "bash", first.id)?.status).toBe("failed");
    expect(registry.getOwned("owner-a", "browser", sibling.id)?.status).toBe("completed");
  });

  it("keeps registered identity fields immutable through get/list while status and value stay mutable", () => {
    const registry = new SessionRuntimeResourceRegistry();
    const value = { marker: "initial" };
    const registered = resource({ kind: "bash", value });
    const original = {
      id: registered.id,
      controlOwnerSessionId: registered.controlOwnerSessionId,
      executionSessionId: registered.executionSessionId,
      parentResourceId: registered.parentResourceId,
      kind: registered.kind,
      createdAt: registered.createdAt,
    };
    registry.register(registered);

    const fromGet = registry.getOwned<typeof value>("owner-a", "bash", original.id);
    const fromList = registry.listOwned<typeof value>("owner-a", "bash")[0];
    expect(fromGet).not.toBeNull();

    for (const descriptor of [fromGet, fromList]) {
      expect(descriptor).toBeDefined();
      for (const [field, nextValue] of Object.entries({
        id: createRuntimeResourceId(),
        controlOwnerSessionId: "owner-b",
        executionSessionId: "owner-b",
        parentResourceId: createRuntimeResourceId(),
        kind: "browser",
        createdAt: 0,
      })) {
        try {
          (descriptor as Record<string, unknown>)[field] = nextValue;
        } catch {
          // Non-writable identity fields may throw in strict mode; no-op assignment is also acceptable.
        }
      }
    }

    expect(fromGet).toMatchObject(original);
    expect(fromList).toMatchObject(original);
    expect(registry.getOwned("owner-b", "browser", original.id)).toBeNull();
    expect(registry.getOwned("owner-a", "bash", original.id)).toBe(fromGet);
    expect(registry.transition(original.id, ["running"], "stopping")).toBe(true);
    expect(fromGet?.status).toBe("stopping");
    fromGet!.value.marker = "mutated";
    expect(value.marker).toBe("mutated");
  });

  it("disposes every owner tree during process shutdown without exposing a global resource list", async () => {
    const registry = new SessionRuntimeResourceRegistry();
    const calls: string[] = [];
    for (const owner of ["owner-a", "owner-b"]) {
      registry.register(resource({
        controlOwnerSessionId: owner,
        executionSessionId: owner,
        kind: "bash",
        dispose: async () => {
          calls.push(owner);
          return { status: "stopped" };
        },
      }));
    }

    const reports = await registry.disposeAll("shutdown");

    expect(reports.map((report) => report.ownerSessionId)).toEqual(["owner-a", "owner-b"]);
    expect(reports.every((report) => report.ok)).toBe(true);
    expect(calls).toEqual(["owner-a", "owner-b"]);
  });

  it("uses TTL only as an explicit fallback for anomalously old live resources", async () => {
    const registry = new SessionRuntimeResourceRegistry();
    const oldDispose = vi.fn(async (reason: DisposeReason) => ({ status: "stopped" as const, reason }));
    const descendantDispose = vi.fn(async (reason: DisposeReason) => ({ status: "stopped" as const, reason }));
    const freshDispose = vi.fn(async (reason: DisposeReason) => ({ status: "stopped" as const, reason }));
    const old = resource({ kind: "agent", createdAt: 1_000, executionSessionId: "expired-child-session", dispose: oldDispose });
    const freshDescendant = resource({ kind: "browser", createdAt: 9_500, executionSessionId: "expired-child-session", parentResourceId: old.id, dispose: descendantDispose });
    const fresh = resource({ createdAt: 9_500, dispose: freshDispose });
    registry.register(old);
    registry.register(freshDescendant);
    registry.register(fresh);

    const ttlReports = await registry.disposeExpiredResources(5_000, 10_000);

    expect(ttlReports).toMatchObject([{ ownerSessionId: "owner-a", reason: "ttl", resources: [{ id: freshDescendant.id }, { id: old.id }] }]);
    expect(descendantDispose).toHaveBeenCalledWith("ttl");
    expect(oldDispose).toHaveBeenCalledWith("ttl");
    expect(freshDispose).not.toHaveBeenCalled();
    expect(registry.getOwned("owner-a", "bash", fresh.id)?.status).toBe("running");

    await registry.disposeResourceTree("owner-a", fresh.id, "task-stop");
    expect(freshDispose).toHaveBeenCalledWith("task-stop");
  });

  it("logs only structured resource identity and completion fields without resource values", async () => {
    const registry = new SessionRuntimeResourceRegistry();
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const sensitiveApiKey = "sk-task17-secret-value";
    const fullPrompt = "FULL PRIVATE PROMPT THAT MUST NEVER ENTER RESOURCE LOGS";
    const owned = resource({
      kind: "browser",
      value: { apiKey: sensitiveApiKey, prompt: fullPrompt },
      dispose: async () => ({ status: "stopped" }),
    });
    registry.register(owned);

    try {
      await registry.disposeResourceTree("owner-a", owned.id, "task-stop");
      const entry = consoleLog.mock.calls
        .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
        .find((candidate) => candidate.msg === "Runtime resource settled");

      expect(entry).toMatchObject({
        sessionId: "owner-a",
        resourceKind: "browser",
        resourceId: owned.id,
        completionReason: "stopped",
        disposeReason: "task-stop",
      });
      const serialized = JSON.stringify(entry);
      expect(serialized).not.toContain(sensitiveApiKey);
      expect(serialized).not.toContain(fullPrompt);
      expect(entry).not.toHaveProperty("value");
      expect(entry).not.toHaveProperty("prompt");
      expect(entry).not.toHaveProperty("apiKey");
    } finally {
      consoleLog.mockRestore();
    }
  });

  it("returns empty dispose reports for missing roots and owner mismatches", async () => {
    const registry = new SessionRuntimeResourceRegistry();
    const root = resource({ kind: "agent", controlOwnerSessionId: "owner-a", executionSessionId: "child-session" });
    registry.register(root);

    await expect(registry.disposeResourceTree("owner-b", root.id, "task-stop")).resolves.toEqual({
      ok: true,
      ownerSessionId: "owner-b",
      reason: "task-stop",
      resources: [],
    });
    await expect(registry.disposeResourceTree("owner-a", "missing-id", "task-stop")).resolves.toEqual({
      ok: true,
      ownerSessionId: "owner-a",
      reason: "task-stop",
      resources: [],
    });
  });
});
