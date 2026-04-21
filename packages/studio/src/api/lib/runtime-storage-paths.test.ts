import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_USERPROFILE = process.env.USERPROFILE;

function runtimePath(homeDir: string, ...segments: string[]) {
  return join(homeDir, ".novelfork", ...segments);
}

describe("runtime-storage-paths", () => {
  let homeDir: string;

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "novelfork-runtime-paths-"));
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
    vi.resetModules();
  });

  afterEach(async () => {
    process.env.HOME = ORIGINAL_HOME;
    process.env.USERPROFILE = ORIGINAL_USERPROFILE;
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
});
