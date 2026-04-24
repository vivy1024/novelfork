import { describe, expect, it } from "vitest";

import { detectRuntimeMode } from "./runtime-mode";

describe("detectRuntimeMode", () => {
  it("identifies compiled Bun executables from runtime hints", () => {
    expect(detectRuntimeMode({
      bunAvailable: true,
      metaUrl: "file:///snapshot/novelfork/main.ts",
      execPath: "D:/DESKTOP/novelfork/dist/novelfork.exe",
      nodeEnv: "production",
    })).toMatchObject({
      runtime: "bun",
      isProd: true,
      isCompiledBinary: true,
      exePath: "D:/DESKTOP/novelfork/dist/novelfork.exe",
    });
  });

  it("does not treat the Bun CLI executable as a compiled NovelFork binary", () => {
    expect(detectRuntimeMode({
      bunAvailable: true,
      metaUrl: "file:///D:/DESKTOP/novelfork/packages/studio/src/api/lib/runtime-mode.ts",
      execPath: "C:/Users/17655/.bun/bin/bun.exe",
      nodeEnv: "development",
    })).toMatchObject({
      runtime: "bun",
      isProd: false,
      isCompiledBinary: false,
    });
  });

  it("keeps dev node runtime separate from compiled binaries", () => {
    expect(detectRuntimeMode({
      bunAvailable: false,
      metaUrl: "file:///D:/DESKTOP/novelfork/packages/studio/src/api/server.ts",
      execPath: "C:/Program Files/nodejs/node.exe",
      nodeEnv: "development",
    })).toMatchObject({
      runtime: "node",
      isProd: false,
      isCompiledBinary: false,
    });
  });
});
