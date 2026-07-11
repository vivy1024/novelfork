import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

import {
  ProcessTreeController,
  windowsTaskkillInvocation,
  type ProcessTreeChild,
} from "./process-tree-controller.js";

class FakeChild extends EventEmitter implements ProcessTreeChild {
  readonly pid = 4242;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly kill = vi.fn(() => true);

  exit(code: number | null = 0, signal: NodeJS.Signals | null = null): void {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit("exit", code, signal);
    this.emit("close", code, signal);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("ProcessTreeController", () => {
  it("builds a shell-free Windows taskkill /T /F invocation", () => {
    expect(windowsTaskkillInvocation(4242)).toEqual({
      file: "taskkill.exe",
      args: ["/PID", "4242", "/T", "/F"],
    });
  });

  it("does not report stopped until the child emits a real exit", async () => {
    const child = new FakeChild();
    const terminateTree = vi.fn(async () => {});
    const controller = new ProcessTreeController(child, {
      platform: "win32",
      stopTimeoutMs: 100,
      terminateTree,
    });

    let stopSettled = false;
    const stopPromise = controller.requestStop("abort").then((result) => {
      stopSettled = true;
      return result;
    });
    await Promise.resolve();

    expect(controller.state).toBe("stopping");
    expect(stopSettled).toBe(false);
    expect(terminateTree).toHaveBeenCalledWith(expect.objectContaining({ pid: 4242, force: false }));

    child.exit(null, "SIGTERM");
    await expect(stopPromise).resolves.toEqual({ terminal: "stopped", reason: "abort" });
    await expect(controller.waitForExit()).resolves.toMatchObject({ code: null, signal: "SIGTERM" });
  });

  it("does not report stopped until stdio closes after process exit", async () => {
    const child = new FakeChild();
    const controller = new ProcessTreeController(child, {
      platform: "win32",
      stopTimeoutMs: 100,
      terminateTree: async () => {},
    });
    let settled = false;
    const stopPromise = controller.requestStop("task-stop").then((result) => {
      settled = true;
      return result;
    });

    child.exitCode = null;
    child.signalCode = "SIGTERM";
    child.emit("exit", null, "SIGTERM");
    const preCloseOutcome = await Promise.race([
      stopPromise.then(() => "settled" as const),
      sleep(10).then(() => "pending" as const),
    ]);

    expect(preCloseOutcome).toBe("pending");
    expect(settled).toBe(false);
    child.emit("close", null, "SIGTERM");
    await expect(stopPromise).resolves.toEqual({ terminal: "stopped", reason: "task-stop" });
  });

  it("waits a second grace after force kill before reporting stop-timeout", async () => {
    const child = new FakeChild();
    const terminateTree = vi.fn(async () => {});
    const controller = new ProcessTreeController(child, {
      platform: "linux",
      stopTimeoutMs: 20,
      terminateTree,
    });

    let stopSettled = false;
    let processSettled = false;
    void controller.waitForExit().then(() => { processSettled = true; });
    const stopPromise = controller.requestStop("timeout").then((result) => {
      stopSettled = true;
      return result;
    });

    await sleep(25);
    expect(terminateTree).toHaveBeenNthCalledWith(1, expect.objectContaining({ pid: 4242, force: false }));
    expect(terminateTree).toHaveBeenNthCalledWith(2, expect.objectContaining({ pid: 4242, force: true }));
    expect(stopSettled).toBe(false);
    expect(processSettled).toBe(false);

    const result = await stopPromise;
    expect(result).toEqual({ terminal: "stop-timeout", reason: "timeout" });
    expect(controller.state).toBe("stop-timeout");
    expect(processSettled).toBe(false);

    child.exit(null, "SIGKILL");
    await controller.waitForExit();
    expect(processSettled).toBe(true);
  });

  it("records natural exit without sending a termination request", async () => {
    const child = new FakeChild();
    const terminateTree = vi.fn(async () => {});
    const controller = new ProcessTreeController(child, { terminateTree });

    child.exit(0, null);

    await expect(controller.waitForExit()).resolves.toEqual({ code: 0, signal: null });
    expect(controller.state).toBe("exited");
    expect(terminateTree).not.toHaveBeenCalled();
  });

  it("keeps the exit promise pending after the stop deadline", async () => {
    const child = new FakeChild();
    const controller = new ProcessTreeController(child, {
      stopTimeoutMs: 5,
      terminateTree: async () => {},
    });
    const stopResult = await controller.requestStop("task-stop");
    let settled = false;
    void controller.waitForExit().then(() => { settled = true; });

    await sleep(10);

    expect(stopResult.terminal).toBe("stop-timeout");
    expect(settled).toBe(false);
    child.exit(null, "SIGKILL");
    await controller.waitForExit();
  });
});
