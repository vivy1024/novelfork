import { describe, expect, it, vi } from "vitest";

import { AbortScope } from "./abort-scope.js";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("AbortScope", () => {
  it("attaches root listeners before the factory runs", async () => {
    const root = new AbortController();
    const order: string[] = [];
    const scope = new AbortScope({ capability: "cooperative", rootSignal: root.signal });

    const result = await scope.execute((signal) => {
      order.push("factory");
      expect(signal.aborted).toBe(false);
      root.abort();
      order.push(signal.aborted ? "aborted-inside-factory" : "not-aborted-inside-factory");
      return "late";
    });

    expect(order).toEqual(["factory", "aborted-inside-factory"]);
    expect(result).toEqual({ terminal: "abort", cause: "abort" });
  });

  it("waits for cooperative work to really settle before projecting abort", async () => {
    const root = new AbortController();
    const late = deferred<string>();
    const removeSpy = vi.spyOn(root.signal, "removeEventListener");
    const scope = new AbortScope({ capability: "cooperative", rootSignal: root.signal });
    let settled = false;

    const resultPromise = scope.execute(() => late.promise).then((result) => {
      settled = true;
      return result;
    });
    root.abort();
    await Promise.resolve();

    expect(settled).toBe(false);
    late.resolve("must not become success");
    await expect(resultPromise).resolves.toEqual({ terminal: "abort", cause: "abort" });
    expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("waits for commit-fenced work to really settle before projecting timeout", async () => {
    const late = deferred<string>();
    const scope = new AbortScope({ capability: "commit-fenced", timeoutMs: 5 });
    let settled = false;
    const resultPromise = scope.execute(() => late.promise).then((result) => {
      settled = true;
      return result;
    });

    await sleep(20);
    expect(settled).toBe(false);

    late.resolve("discarded");
    await expect(resultPromise).resolves.toEqual({ terminal: "timeout", cause: "timeout" });
  });

  it("waits for the real handler settlement after process-killable abort", async () => {
    const root = new AbortController();
    const settle = deferred<{ error: "stopped" }>();
    let childSignal: AbortSignal | undefined;
    let settled = false;
    const scope = new AbortScope({ capability: "process-killable", rootSignal: root.signal });

    const resultPromise = scope.execute((signal) => {
      childSignal = signal;
      return settle.promise;
    }).then((result) => {
      settled = true;
      return result;
    });

    root.abort();
    await Promise.resolve();
    expect(childSignal?.aborted).toBe(true);
    expect(settled).toBe(false);

    settle.resolve({ error: "stopped" });
    await expect(resultPromise).resolves.toMatchObject({
      terminal: "stopped",
      value: { error: "stopped" },
      cause: "abort",
    });
  });

  it("maps process-killable stop-timeout from the handler", async () => {
    const scope = new AbortScope({ capability: "process-killable" });

    await expect(scope.execute(async () => ({ error: "stop-timeout" }))).resolves.toEqual({
      terminal: "stop-timeout",
      value: { error: "stop-timeout" },
    });
  });

  it("reports execution-error when a non-deadlined handler throws", async () => {
    const scope = new AbortScope({ capability: "cooperative" });

    await expect(scope.execute(async () => {
      throw new Error("handler boom");
    })).resolves.toMatchObject({
      terminal: "execution-error",
      error: expect.objectContaining({ message: "handler boom" }),
    });
  });

  it("audits a pre-aborted non-cancellable root without aborting its child", async () => {
    const root = new AbortController();
    const settle = deferred<{ resourceId: string }>();
    let childSignal: AbortSignal | undefined;
    const scope = new AbortScope({ capability: "non-cancellable", rootSignal: root.signal });

    root.abort();
    const resultPromise = scope.execute((signal) => {
      childSignal = signal;
      return settle.promise;
    });

    expect(childSignal?.aborted).toBe(false);
    settle.resolve({ resourceId: "chapter-1" });

    await expect(resultPromise).resolves.toMatchObject({
      terminal: "deadline-exceeded-operation-completed",
      cause: "abort",
      value: { resourceId: "chapter-1" },
      data: {
        audit: {
          cause: "abort",
          settled: "completed",
          terminal: "completed",
          value: { resourceId: "chapter-1" },
        },
      },
    });
  });

  it("audits completion after a non-cancellable timeout", async () => {
    const settle = deferred<{ resourceId: string }>();
    const scope = new AbortScope({ capability: "non-cancellable", timeoutMs: 5 });
    const resultPromise = scope.execute(() => settle.promise);

    setTimeout(() => settle.resolve({ resourceId: "chapter-2" }), 15);

    await expect(resultPromise).resolves.toMatchObject({
      terminal: "deadline-exceeded-operation-completed",
      data: {
        audit: {
          cause: "timeout",
          settled: "completed",
          terminal: "completed",
          value: { resourceId: "chapter-2" },
        },
      },
    });
  });

  it("audits failure after a non-cancellable timeout", async () => {
    const settle = deferred<never>();
    const scope = new AbortScope({ capability: "non-cancellable", timeoutMs: 5 });
    const resultPromise = scope.execute(() => settle.promise);

    setTimeout(() => settle.reject(new Error("write failed")), 15);

    await expect(resultPromise).resolves.toMatchObject({
      terminal: "deadline-exceeded-operation-failed",
      cause: "timeout",
      error: expect.objectContaining({ message: "write failed" }),
      data: {
        audit: {
          cause: "timeout",
          settled: "failed",
          terminal: "execution-error",
          error: expect.objectContaining({ message: "write failed" }),
        },
      },
    });
  });
});
