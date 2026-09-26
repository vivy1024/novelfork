import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  GLOBAL_CONFIG_DIR,
  GLOBAL_ENV_PATH,
  resolveGlobalConfigDir,
  resolveGlobalEnvPath,
} from "../utils/global-env.js";

describe("global-env", () => {
  const originalNovelForkHome = process.env.NOVELFORK_HOME;

  beforeEach(() => {
    delete process.env.NOVELFORK_HOME;
  });

  afterEach(() => {
    if (originalNovelForkHome === undefined) delete process.env.NOVELFORK_HOME;
    else process.env.NOVELFORK_HOME = originalNovelForkHome;
  });

  it("resolves ~/.novelfork lazily", () => {
    expect(resolveGlobalConfigDir()).toBe(join(homedir(), ".novelfork"));
    expect(resolveGlobalEnvPath()).toBe(join(homedir(), ".novelfork", ".env"));
    expect(String(GLOBAL_CONFIG_DIR)).toBe(join(homedir(), ".novelfork"));
    expect(String(GLOBAL_ENV_PATH)).toBe(join(homedir(), ".novelfork", ".env"));
  });

  it("follows NOVELFORK_HOME when it is set", () => {
    const relocated = join(tmpdir(), "relocated-novelfork-home");
    process.env.NOVELFORK_HOME = relocated;
    expect(resolveGlobalConfigDir()).toBe(relocated);
    expect(resolveGlobalEnvPath()).toBe(join(relocated, ".env"));
    expect(String(GLOBAL_CONFIG_DIR)).toBe(relocated);
  });

  it("resolves a relative or padded NOVELFORK_HOME to an absolute path", () => {
    process.env.NOVELFORK_HOME = "  relative-novelfork-home  ";
    expect(resolveGlobalConfigDir()).toBe(resolve("relative-novelfork-home"));
  });
});
