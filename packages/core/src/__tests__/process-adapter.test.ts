import { describe, expect, it } from "vitest";

import { execFileCommand } from "../runtime/process-adapter.js";

describe("process-adapter", () => {
  it("returns exitCode 0 for successful commands in the Node fallback", async () => {
    const result = await execFileCommand(process.execPath, ["-e", 'console.log("ok")']);

    expect(result.stdout).toBe("ok");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.signal).toBeNull();
  });

  it("preserves a null exitCode and signal when the Node fallback times out", async () => {
    const result = await execFileCommand(
      process.execPath,
      ["-e", "setTimeout(() => {}, 10000)"],
      { timeout: 50 },
    );

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBeNull();
    expect(result.signal).toBe("SIGTERM");
  });
});
