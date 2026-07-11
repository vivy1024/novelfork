import { describe, expect, it, vi } from "vitest";

import { SessionRuntimeFollowUpTracker } from "./follow-up-tracker.js";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

describe("SessionRuntimeFollowUpTracker", () => {
  it("tracks follow-ups by owner and waits only for the requested owner", async () => {
    const tracker = new SessionRuntimeFollowUpTracker();
    const ownerA = deferred();
    const ownerB = deferred();
    tracker.track("owner-a", "turn-memory", ownerA.promise);
    tracker.track("owner-b", "webhook", ownerB.promise);

    let ownerAIdle = false;
    const waitForA = tracker.waitForIdle("owner-a").then(() => {
      ownerAIdle = true;
    });
    await Promise.resolve();
    expect(ownerAIdle).toBe(false);

    ownerB.resolve();
    await Promise.resolve();
    expect(ownerAIdle).toBe(false);

    ownerA.resolve();
    await waitForA;
    expect(ownerAIdle).toBe(true);
    expect(tracker.hasPending("owner-a")).toBe(false);
  });

  it("returns structured failures after every owner follow-up settles and supports a clean retry", async () => {
    const tracker = new SessionRuntimeFollowUpTracker();
    const rejection = Promise.reject(new Error("memory extraction failed"));
    tracker.track("owner-a", "turn-memory", rejection);
    tracker.track("owner-a", "webhook", Promise.resolve());

    await expect(tracker.disposeOwner("owner-a")).resolves.toEqual({
      ok: false,
      ownerSessionId: "owner-a",
      errors: [{ label: "turn-memory", message: "memory extraction failed" }],
    });

    tracker.track("owner-a", "retry-cleanup", Promise.resolve());
    await expect(tracker.disposeOwner("owner-a")).resolves.toEqual({
      ok: true,
      ownerSessionId: "owner-a",
      errors: [],
    });
  });

  it("shares concurrent owner drains without leaking failures as unhandled rejections", async () => {
    const tracker = new SessionRuntimeFollowUpTracker();
    const pending = deferred();
    const observer = vi.fn();
    tracker.track("owner-a", "context-write", pending.promise.then(observer));

    const first = tracker.disposeOwner("owner-a");
    const second = tracker.disposeOwner("owner-a");
    expect(second).toBe(first);
    pending.resolve();

    expect(await first).toEqual(await second);
    expect(observer).toHaveBeenCalledTimes(1);
  });
});
