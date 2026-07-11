import { describe, expect, it, vi } from "vitest";

import {
  SessionTurnGate,
  SessionTurnGateDisposedError,
  type TurnLease,
} from "./turn-gate.js";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

async function nextTurn(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("SessionTurnGate", () => {
  it("starts the first item and queues the second item for the same session", async () => {
    const gate = new SessionTurnGate({ maxQueueSize: 10 });
    const firstDone = deferred();
    const secondDone = deferred();
    const started: string[] = [];
    const leases: TurnLease[] = [];

    const first = await gate.enqueue("session-a", "first", async (lease, item) => {
      started.push(item);
      leases.push(lease);
      await firstDone.promise;
    });
    const second = await gate.enqueue("session-a", "second", async (lease, item) => {
      started.push(item);
      leases.push(lease);
      await secondDone.promise;
    });

    expect(first).toBe("started");
    expect(second).toBe("queued");

    await nextTurn();
    expect(started).toEqual(["first"]);
    expect(leases[0]?.sessionId).toBe("session-a");
    expect(leases[0]?.rootSignal).toBeInstanceOf(AbortSignal);
    expect(leases[0]?.signal).toBe(leases[0]?.rootSignal);

    firstDone.resolve();
    await nextTurn();
    expect(started).toEqual(["first", "second"]);

    secondDone.resolve();
    await nextTurn();
    expect(gate.requestAbort("session-a")).toBe(false);
  });

  it("preserves FIFO for accepted items, reports queue-full, and never runs more than one active turn per session under pressure", async () => {
    const gate = new SessionTurnGate({ maxQueueSize: 10 });
    const completions = new Map<number, ReturnType<typeof deferred>>();
    const startedOrder: number[] = [];
    let activeTurns = 0;
    let maxActiveTurns = 0;

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, item) => gate.enqueue("session-a", item, async (_lease, acceptedItem) => {
        const done = deferred();
        completions.set(acceptedItem, done);
        startedOrder.push(acceptedItem);
        activeTurns += 1;
        maxActiveTurns = Math.max(maxActiveTurns, activeTurns);
        await done.promise;
        activeTurns -= 1;
      })),
    );

    expect(results).toEqual([
      "started",
      ...Array.from({ length: 10 }, () => "queued"),
      ...Array.from({ length: 9 }, () => "queue-full"),
    ]);

    await nextTurn();
    expect(startedOrder).toEqual([0]);

    for (const item of Array.from({ length: 11 }, (_, index) => index)) {
      expect(completions.has(item)).toBe(true);
      completions.get(item)!.resolve();
      await nextTurn();
    }

    expect(startedOrder).toEqual(Array.from({ length: 11 }, (_, index) => index));
    expect(maxActiveTurns).toBe(1);
    expect(activeTurns).toBe(0);
  });

  it("allows different sessions to run independently in parallel", async () => {
    const gate = new SessionTurnGate();
    const doneA = deferred();
    const doneB = deferred();
    const activeSessions = new Set<string>();
    let maxParallel = 0;

    await Promise.all([
      gate.enqueue("session-a", "a", async (lease) => {
        activeSessions.add(lease.sessionId);
        maxParallel = Math.max(maxParallel, activeSessions.size);
        await doneA.promise;
        activeSessions.delete(lease.sessionId);
      }),
      gate.enqueue("session-b", "b", async (lease) => {
        activeSessions.add(lease.sessionId);
        maxParallel = Math.max(maxParallel, activeSessions.size);
        await doneB.promise;
        activeSessions.delete(lease.sessionId);
      }),
    ]);

    await nextTurn();
    expect(maxParallel).toBe(2);
    expect(activeSessions).toEqual(new Set(["session-a", "session-b"]));

    doneA.resolve();
    doneB.resolve();
    await nextTurn();
    expect(activeSessions.size).toBe(0);
  });

  it("observes run errors, releases in finally, and drains the next queued turn", async () => {
    const onRunError = vi.fn();
    const gate = new SessionTurnGate({ onRunError });
    const done = deferred();
    const started: string[] = [];

    await gate.enqueue("session-a", "throws", async (_lease, item) => {
      started.push(item);
      throw new Error("boom");
    });
    const queued = await gate.enqueue("session-a", "after-throw", async (_lease, item) => {
      started.push(item);
      await done.promise;
    });

    expect(queued).toBe("queued");
    await nextTurn();
    await nextTurn();

    expect(started).toEqual(["throws", "after-throw"]);
    expect(onRunError).toHaveBeenCalledTimes(1);
    expect(onRunError.mock.calls[0]?.[0]).toMatchObject({ sessionId: "session-a", item: "throws" });
    expect(onRunError.mock.calls[0]?.[0].error).toBeInstanceOf(Error);

    done.resolve();
    await nextTurn();
    expect(gate.requestAbort("session-a")).toBe(false);
  });

  it("contains async rejecting error observers without unhandled rejection and still drains queued turns", async () => {
    const onRunError = vi.fn(async () => {
      throw new Error("observer failed async");
    });
    const gate = new SessionTurnGate({ onRunError });
    const done = deferred();
    const started: string[] = [];

    await gate.enqueue("session-a", "throws", async (_lease, item) => {
      started.push(item);
      throw new Error("turn failed");
    });
    await gate.enqueue("session-a", "after-observer-reject", async (_lease, item) => {
      started.push(item);
      await done.promise;
    });

    await nextTurn();
    await nextTurn();
    await nextTurn();

    expect(onRunError).toHaveBeenCalledTimes(1);
    expect(started).toEqual(["throws", "after-observer-reject"]);

    done.resolve();
    await nextTurn();
    expect(await gate.enqueue("session-a", "after-drain", async (_lease, item) => {
      started.push(item);
    })).toBe("started");
    await nextTurn();
    expect(started).toEqual(["throws", "after-observer-reject", "after-drain"]);
    expect(gate.requestAbort("session-a")).toBe(false);
  });

  it("retains a stopping lease until its real runtime settlement before draining the next turn", async () => {
    const gate = new SessionTurnGate<string>();
    const runtimeSettled = deferred();
    const started: string[] = [];

    await gate.enqueue("session-stopping", "stopping", async (lease, item) => {
      started.push(item);
      lease.retainUntil(runtimeSettled.promise);
    });
    await gate.enqueue("session-stopping", "next", async (_lease, item) => {
      started.push(item);
    });

    await nextTurn();
    expect(started).toEqual(["stopping"]);
    expect(gate.hasActive("session-stopping")).toBe(true);

    runtimeSettled.resolve();
    await nextTurn();
    await nextTurn();
    expect(started).toEqual(["stopping", "next"]);
    expect(gate.hasActive("session-stopping")).toBe(false);
  });

  it("requestAbort only aborts the active lease and does not start the next turn before the old turn settles", async () => {
    const gate = new SessionTurnGate();
    const activeDone = deferred();
    const queuedDone = deferred();
    const started: string[] = [];
    let activeLease: TurnLease | undefined;

    await gate.enqueue("session-a", "active", async (lease, item) => {
      activeLease = lease;
      started.push(item);
      await activeDone.promise;
    });
    await gate.enqueue("session-a", "queued", async (_lease, item) => {
      started.push(item);
      await queuedDone.promise;
    });

    await nextTurn();
    expect(started).toEqual(["active"]);
    expect(gate.requestAbort("session-a")).toBe(true);
    expect(gate.requestAbort("session-a")).toBe(true);
    expect(activeLease?.rootSignal.aborted).toBe(true);

    await nextTurn();
    expect(started).toEqual(["active"]);

    activeDone.resolve();
    await nextTurn();
    expect(started).toEqual(["active", "queued"]);

    queuedDone.resolve();
    await nextTurn();
    expect(gate.requestAbort("session-a")).toBe(false);
    expect(gate.requestAbort("missing-session")).toBe(false);
  });

  it("cancels only queued items selected by the owner-safe predicate", async () => {
    const gate = new SessionTurnGate<{ readonly id: string; readonly transport: string }>();
    const activeDone = deferred();
    const allowedDone = deferred();
    const started: string[] = [];

    await gate.enqueue("session-a", { id: "active", transport: "primary" }, async (_lease, item) => {
      started.push(item.id);
      await activeDone.promise;
    });
    await gate.enqueue("session-a", { id: "keep", transport: "primary" }, async (_lease, item) => {
      started.push(item.id);
      await allowedDone.promise;
    });
    await gate.enqueue("session-a", { id: "disconnect", transport: "disconnected" }, async (_lease, item) => {
      started.push(item.id);
    });
    await nextTurn();

    expect(gate.cancelQueued("session-a", (item) => item.transport === "disconnected")).toEqual([
      expect.objectContaining({ sessionId: "session-a", item: { id: "disconnect", transport: "disconnected" }, reason: "transport-disconnected" }),
    ]);

    activeDone.resolve();
    await nextTurn();
    expect(started).toEqual(["active", "keep"]);
    allowedDone.resolve();
    await nextTurn();
    expect(started).toEqual(["active", "keep"]);
  });

  it("dispose cancels queued items, aborts and waits for the active turn, rejects later enqueue, and is idempotent", async () => {
    const gate = new SessionTurnGate();
    const activeDone = deferred();
    const disposeObserved = deferred<readonly unknown[]>();
    let activeLease: TurnLease | undefined;

    await gate.enqueue("session-a", "active", async (lease) => {
      activeLease = lease;
      await activeDone.promise;
    });
    await gate.enqueue("session-a", "queued-1", async () => {});
    await gate.enqueue("session-a", "queued-2", async () => {});
    await nextTurn();

    const disposePromise = gate.dispose("session-a");
    const secondDisposePromise = gate.dispose("session-a");
    void disposePromise.then(disposeObserved.resolve);

    await nextTurn();
    expect(activeLease?.rootSignal.aborted).toBe(true);
    let disposeSettled = false;
    void disposeObserved.promise.then(() => {
      disposeSettled = true;
    });
    await nextTurn();
    expect(disposeSettled).toBe(false);

    activeDone.resolve();
    const cancellations = await disposePromise;
    expect(await secondDisposePromise).toEqual(cancellations);
    expect(disposeSettled).toBe(true);
    expect(cancellations).toEqual([
      expect.objectContaining({ sessionId: "session-a", item: "queued-1", reason: "session-disposed" }),
      expect.objectContaining({ sessionId: "session-a", item: "queued-2", reason: "session-disposed" }),
    ]);

    await expect(gate.enqueue("session-a", "after-dispose", async () => {})).rejects.toBeInstanceOf(SessionTurnGateDisposedError);
    await expect(gate.enqueue("session-a", "after-dispose", async () => {})).rejects.toThrow(/session-runtime-disposed/);
    expect(await gate.dispose("session-a")).toEqual([]);
  });

  it("publishes session-disposed queue cancellations before a stuck active turn settles", async () => {
    const gate = new SessionTurnGate<string>();
    const activeDone = deferred();
    let activeLease: TurnLease | undefined;
    const observed: string[] = [];

    await gate.enqueue("session-a", "active", async (lease) => {
      activeLease = lease;
      await activeDone.promise;
    });
    await gate.enqueue("session-a", "queued", async () => {});
    await nextTurn();

    const disposal = gate.dispose("session-a", (cancellations) => {
      observed.push(...cancellations.map((item) => `${item.item}:${item.reason}`));
    });
    await nextTurn();

    expect(observed).toEqual(["queued:session-disposed"]);
    expect(activeLease?.signal.aborted).toBe(true);
    activeDone.resolve();
    await disposal;
  });

  it("waitForIdle spans the active turn and every queued turn before resolving", async () => {
    const gate = new SessionTurnGate();
    const firstDone = deferred();
    const secondDone = deferred();
    const started: string[] = [];

    await gate.enqueue("session-a", "first", async (_lease, item) => {
      started.push(item);
      await firstDone.promise;
    });
    await gate.enqueue("session-a", "second", async (_lease, item) => {
      started.push(item);
      await secondDone.promise;
    });
    await nextTurn();

    let idleResolved = false;
    const idle = gate.waitForIdle("session-a").then(() => {
      idleResolved = true;
    });
    await nextTurn();
    expect(idleResolved).toBe(false);

    firstDone.resolve();
    await nextTurn();
    expect(started).toEqual(["first", "second"]);
    expect(idleResolved).toBe(false);

    secondDone.resolve();
    await idle;
    expect(idleResolved).toBe(true);
    expect(gate.hasActive("session-a")).toBe(false);
    await expect(gate.waitForIdle("session-a")).resolves.toBeUndefined();
  });

  it("removes drained session state so a later enqueue can start again", async () => {
    const gate = new SessionTurnGate();
    const firstDone = deferred();
    const secondDone = deferred();
    const started: string[] = [];

    expect(await gate.enqueue("session-a", "first", async (_lease, item) => {
      started.push(item);
      await firstDone.promise;
    })).toBe("started");

    await nextTurn();
    firstDone.resolve();
    await nextTurn();

    expect(await gate.enqueue("session-a", "second", async (_lease, item) => {
      started.push(item);
      await secondDone.promise;
    })).toBe("started");
    await nextTurn();
    expect(started).toEqual(["first", "second"]);
    secondDone.resolve();
    await nextTurn();
    expect(gate.requestAbort("session-a")).toBe(false);
  });
});
