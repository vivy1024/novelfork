import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  claimDesktopInstanceRecord,
  classifyRuntimeHealth,
  desktopInstanceRecordPath,
  type HealthResponseLike,
  isProcessAlive,
  probeRunningDesktopInstance,
  releaseDesktopInstanceRecord,
  resolveDesktopInstance,
  RUNTIME_INSTANCE_LOCK_FILE,
  RUNTIME_STARTING_HEADER,
  updateDesktopInstanceRecord,
} from "./desktop-instance";

const SELF = 1000;
const OTHER = 2000;
const NOW = Date.parse("2026-11-22T00:00:00.000Z");
const readyHealth = {
  status: "ok",
  version: "0.9.15",
  platform: "windows",
  gitAvailable: true,
  runtimeEnvironment: { kind: "local" },
};

let runtimeDir: string;
beforeEach(() => {
  runtimeDir = mkdtempSync(join(tmpdir(), "nf-desktop-instance-"));
});
afterEach(() => {
  rmSync(runtimeDir, { recursive: true, force: true });
});

function writeRecord(record: Record<string, unknown>) {
  writeFileSync(desktopInstanceRecordPath(runtimeDir), JSON.stringify(record));
}
function writeLock(pid: number) {
  writeFileSync(join(runtimeDir, RUNTIME_INSTANCE_LOCK_FILE), JSON.stringify({ version: 2, pid }));
}
function response(status: number, body: unknown, starting = false): HealthResponseLike {
  return {
    status,
    headers: { has: (name: string) => starting && name === RUNTIME_STARTING_HEADER },
    json: async () => body,
  };
}
const alive = (pids: number[]) => (pid: number) => pids.includes(pid);
const now = () => NOW;
const addressed = { product: "NovelFork", pid: OTHER, url: "http://localhost:4567", windowTitle: "NovelFork", updatedAt: new Date(NOW).toISOString() };

describe("probeRunningDesktopInstance", () => {
  it("finds a live NovelFork whose address answers the Runtime health check", async () => {
    writeRecord(addressed);
    writeLock(OTHER);
    const requested: string[] = [];
    const probe = await probeRunningDesktopInstance(runtimeDir, SELF, {
      isAlive: alive([OTHER]),
      now,
      fetch: async (url) => {
        requested.push(url);
        return response(200, readyHealth);
      },
    });
    expect(probe).toEqual({ kind: "running", pid: OTHER, url: "http://localhost:4567", starting: false, windowTitle: "NovelFork" });
    expect(requested).toEqual(["http://localhost:4567/api/health"]);
  });

  it("treats an instance still on its startup status page as running", async () => {
    writeRecord(addressed);
    const probe = await probeRunningDesktopInstance(runtimeDir, SELF, {
      isAlive: alive([OTHER]),
      now,
      fetch: async () => response(503, { status: "starting" }, true),
    });
    expect(probe).toMatchObject({ kind: "running", starting: true });
  });

  it("reports no instance without a record (fresh data directory)", async () => {
    const probe = await probeRunningDesktopInstance(runtimeDir, SELF, { now });
    expect(probe).toEqual({ kind: "none", reason: "no-record" });
  });

  it("ignores a stale record whose process has exited", async () => {
    writeRecord(addressed);
    writeLock(OTHER);
    const probe = await probeRunningDesktopInstance(runtimeDir, SELF, {
      isAlive: alive([]),
      now,
      fetch: async () => {
        throw new Error("must not probe a dead instance");
      },
    });
    expect(probe).toEqual({ kind: "none", reason: "process-gone" });
  });

  it("does not trust a record when another live process holds the Runtime lock", async () => {
    writeRecord(addressed);
    writeLock(3000);
    const probe = await probeRunningDesktopInstance(runtimeDir, SELF, { isAlive: alive([OTHER, 3000]), now });
    expect(probe).toEqual({ kind: "none", reason: "lock-held-by-other" });
  });

  it("rejects a port answered by something that is not NovelFork's Runtime", async () => {
    writeRecord(addressed);
    const probe = await probeRunningDesktopInstance(runtimeDir, SELF, {
      isAlive: alive([OTHER]),
      now,
      fetch: async () => response(200, { status: "ok", version: "1.0" }),
    });
    expect(probe).toEqual({ kind: "none", reason: "not-runtime" });
  });

  it("treats an address that no longer answers as stale (recycled pid)", async () => {
    writeRecord(addressed);
    const probe = await probeRunningDesktopInstance(runtimeDir, SELF, {
      isAlive: alive([OTHER]),
      now,
      fetch: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    expect(probe).toEqual({ kind: "none", reason: "unreachable" });
  });

  it("ignores records written by something else or by itself", async () => {
    writeRecord({ ...addressed, product: "NarraFork" });
    expect(await probeRunningDesktopInstance(runtimeDir, SELF, { now })).toEqual({ kind: "none", reason: "no-record" });
    writeRecord({ ...addressed, pid: SELF });
    expect(await probeRunningDesktopInstance(runtimeDir, SELF, { now })).toEqual({ kind: "none", reason: "own-record" });
  });

  it("distinguishes a fresh claim without an address from an abandoned one", async () => {
    writeRecord({ ...addressed, url: null });
    expect(await probeRunningDesktopInstance(runtimeDir, SELF, { isAlive: alive([OTHER]), now })).toEqual({
      kind: "none",
      reason: "unaddressed",
    });
    writeRecord({ ...addressed, url: null, updatedAt: new Date(NOW - 120_000).toISOString() });
    expect(await probeRunningDesktopInstance(runtimeDir, SELF, { isAlive: alive([OTHER]), now })).toEqual({
      kind: "none",
      reason: "stale-unaddressed",
    });
  });
});

describe("classifyRuntimeHealth", () => {
  it("accepts the Runtime's ready and starting answers only", () => {
    expect(classifyRuntimeHealth(200, false, readyHealth)).toBe("ready");
    expect(classifyRuntimeHealth(503, true, {})).toBe("starting");
    expect(classifyRuntimeHealth(503, false, {})).toBe("other");
    expect(classifyRuntimeHealth(200, false, { version: "1" })).toBe("other");
    expect(classifyRuntimeHealth(404, false, readyHealth)).toBe("other");
  });
});

describe("instance record lifecycle", () => {
  it("claims exclusively, updates the address, and releases only its own record", () => {
    expect(claimDesktopInstanceRecord(runtimeDir, SELF, { windowTitle: "NovelFork", now })).toBe(true);
    const path = desktopInstanceRecordPath(runtimeDir);
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ product: "NovelFork", pid: SELF, url: null, windowTitle: "NovelFork" });
    // 另一个存活进程不能再认领
    expect(claimDesktopInstanceRecord(runtimeDir, OTHER, { isAlive: alive([SELF]) })).toBe(false);
    expect(updateDesktopInstanceRecord(runtimeDir, SELF, { url: "http://localhost:4567" })).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ pid: SELF, url: "http://localhost:4567", windowTitle: "NovelFork" });
    expect(updateDesktopInstanceRecord(runtimeDir, OTHER, { url: "http://localhost:9" })).toBe(false);
    releaseDesktopInstanceRecord(runtimeDir, OTHER);
    expect(existsSync(path)).toBe(true);
    releaseDesktopInstanceRecord(runtimeDir, SELF);
    expect(existsSync(path)).toBe(false);
  });

  it("takes over a record whose process is gone", () => {
    writeRecord(addressed);
    expect(claimDesktopInstanceRecord(runtimeDir, SELF, { isAlive: alive([]) })).toBe(true);
    expect(JSON.parse(readFileSync(desktopInstanceRecordPath(runtimeDir), "utf8")).pid).toBe(SELF);
  });
});

describe("resolveDesktopInstance", () => {
  it("hands over to a running instance", async () => {
    writeRecord(addressed);
    const result = await resolveDesktopInstance(runtimeDir, SELF, {
      isAlive: alive([OTHER]),
      now,
      fetch: async () => response(200, readyHealth),
    });
    expect(result).toMatchObject({ kind: "running", url: "http://localhost:4567" });
  });

  it("claims when the recorded instance is stale, overwriting an untrustworthy record", async () => {
    writeRecord(addressed);
    const result = await resolveDesktopInstance(runtimeDir, SELF, {
      isAlive: alive([OTHER]),
      now,
      fetch: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    expect(result).toEqual({ kind: "claimed" });
    expect(JSON.parse(readFileSync(desktopInstanceRecordPath(runtimeDir), "utf8"))).toMatchObject({ pid: SELF, url: null });
  });

  it("waits for a just-started instance to publish its address", async () => {
    let reads = 0;
    const result = await resolveDesktopInstance(runtimeDir, SELF, {
      isAlive: alive([OTHER]),
      now,
      intervalMs: 1,
      readText: (path) => {
        if (path.endsWith(RUNTIME_INSTANCE_LOCK_FILE)) return undefined;
        reads++;
        return JSON.stringify(reads < 3 ? { ...addressed, url: null } : addressed);
      },
      fetch: async () => response(503, {}, true),
    });
    expect(result).toMatchObject({ kind: "running", starting: true });
    expect(reads).toBe(3);
  });
});

describe("isProcessAlive", () => {
  it("sees the current process and rejects invalid pids", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(0)).toBe(false);
    expect(isProcessAlive(-1)).toBe(false);
  });
});
