import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_USERPROFILE = process.env.USERPROFILE;
const ORIGINAL_RUNTIME_DIR = process.env.NOVELFORK_RUNTIME_DIR;

function runtimePath(homeDir: string, ...segments: string[]) {
  return join(homeDir, ".novelfork", ...segments);
}

describe("runtime-storage-paths", () => {
  let homeDir: string;

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "novelfork-runtime-paths-"));
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
    if (ORIGINAL_RUNTIME_DIR === undefined) {
      delete process.env.NOVELFORK_RUNTIME_DIR;
    } else {
      process.env.NOVELFORK_RUNTIME_DIR = ORIGINAL_RUNTIME_DIR;
    }
    vi.resetModules();
  });

  afterEach(async () => {
    process.env.HOME = ORIGINAL_HOME;
    process.env.USERPROFILE = ORIGINAL_USERPROFILE;
    if (ORIGINAL_RUNTIME_DIR === undefined) {
      delete process.env.NOVELFORK_RUNTIME_DIR;
    } else {
      process.env.NOVELFORK_RUNTIME_DIR = ORIGINAL_RUNTIME_DIR;
    }
    await rm(homeDir, { recursive: true, force: true });
  });

  it("always resolves files under ~/.novelfork", async () => {
    const service = await import("./runtime-storage-paths");

    expect(service.resolveRuntimeStoragePath("sessions.json")).toBe(runtimePath(homeDir, "sessions.json"));
  });

  it("always resolves directories under ~/.novelfork", async () => {
    const service = await import("./runtime-storage-paths");

    expect(service.resolveRuntimeStorageDir("session-history")).toBe(runtimePath(homeDir, "session-history"));
  });

  it("allows release smoke and E2E to isolate runtime state with NOVELFORK_RUNTIME_DIR", async () => {
    const runtimeDir = join(homeDir, "isolated-runtime");
    process.env.NOVELFORK_RUNTIME_DIR = runtimeDir;
    const service = await import("./runtime-storage-paths");

    expect(service.resolveRuntimeStoragePath("provider-runtime.json")).toBe(join(runtimeDir, "provider-runtime.json"));
    expect(service.resolveRuntimeStorageDir("sessions")).toBe(join(runtimeDir, "sessions"));
  });
});
