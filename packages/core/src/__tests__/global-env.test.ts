import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GLOBAL_CONFIG_DIR,
  GLOBAL_ENV_PATH,
  resolveGlobalConfigDir,
  resolveGlobalEnvPath,
} from "../utils/global-env.js";

describe("global-env", () => {
  it("resolves ~/.novelfork lazily", () => {
    expect(resolveGlobalConfigDir()).toBe(join(homedir(), ".novelfork"));
    expect(resolveGlobalEnvPath()).toBe(join(homedir(), ".novelfork", ".env"));
    expect(String(GLOBAL_CONFIG_DIR)).toBe(join(homedir(), ".novelfork"));
    expect(String(GLOBAL_ENV_PATH)).toBe(join(homedir(), ".novelfork", ".env"));
  });
});
