import { beforeEach, describe, expect, it, vi } from "vitest";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const accessMock = vi.fn();
const testDir = dirname(fileURLToPath(import.meta.url));
const cliPackageRoot = resolve(testDir, "..", "..");
const normalizePath = (value: string) => value.replace(/\\/g, "/");

vi.mock("node:fs/promises", () => ({
  access: accessMock,
}));

describe("studio runtime resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("prefers the repository Bun main entry before legacy studio bridges", async () => {
    accessMock.mockImplementation(async (path: string) => {
      if (
        normalizePath(path).endsWith("/test-project/main.ts") ||
        normalizePath(path).endsWith("/packages/studio/src/api/index.ts")
      ) {
        return;
      }
      throw new Error(`missing: ${path}`);
    });

    const { resolveStudioLaunch } = await import("../commands/studio.js");
    const launch = await resolveStudioLaunch("/repo/test-project");

    expect(launch).not.toBeNull();
    expect(normalizePath(launch!.studioEntry)).toMatch(/\/test-project\/main\.ts$/);
    expect(launch!.command).toBe("bun");
    expect(launch!.args.map(normalizePath)).toEqual([
      "run",
      expect.stringMatching(/\/test-project\/main\.ts$/),
      "--root=/repo/test-project",
    ]);
  });

  it("prefers the built studio package before the legacy source bridge", async () => {
    accessMock.mockImplementation(async (path: string) => {
      if (
        normalizePath(path).endsWith("/node_modules/@vivy1024/novelfork-studio/dist/api/index.js") ||
        normalizePath(path).endsWith("/packages/studio/src/api/index.ts") ||
        normalizePath(path).endsWith("/packages/studio/node_modules/tsx/dist/loader.mjs")
      ) {
        return;
      }
      throw new Error(`missing: ${path}`);
    });

    const { resolveStudioLaunch } = await import("../commands/studio.js");
    const launch = await resolveStudioLaunch("/repo/test-project");

    expect(launch).not.toBeNull();
    expect(normalizePath(launch!.studioEntry)).toMatch(/\/node_modules\/\@vivy1024\/novelfork-studio\/dist\/api\/index\.js$/);
    expect(launch!.command).toBe("node");
    expect(launch!.args.map(normalizePath)).toEqual([
      expect.stringMatching(/\/node_modules\/\@vivy1024\/novelfork-studio\/dist\/api\/index\.js$/),
      "/repo/test-project",
    ]);
  });

  it("finds monorepo packages/studio sources from a project directory", async () => {
    accessMock.mockImplementation(async (path: string) => {
      if (normalizePath(path).endsWith("/packages/studio/src/api/index.ts")) {
        return;
      }
      throw new Error(`missing: ${path}`);
    });

    const { resolveStudioLaunch } = await import("../commands/studio.js");
    const launch = await resolveStudioLaunch("/repo/test-project");

    expect(launch).not.toBeNull();
    expect(normalizePath(launch!.studioEntry)).toMatch(/\/packages\/studio\/src\/api\/index\.ts$/);
    expect(launch!.command).toBe("npx");
    expect(launch!.args.map(normalizePath)).toEqual(["tsx", expect.stringMatching(/\/packages\/studio\/src\/api\/index\.ts$/), "/repo/test-project"]);
  });

  it("uses node for built JavaScript entries", async () => {
    accessMock.mockImplementation(async (path: string) => {
      if (normalizePath(path).endsWith("/test-project/node_modules/@vivy1024/novelfork-studio/dist/api/index.js")) {
        return;
      }
      throw new Error(`missing: ${path}`);
    });

    const { resolveStudioLaunch } = await import("../commands/studio.js");
    const launch = await resolveStudioLaunch("/repo/test-project");

    expect(launch).not.toBeNull();
    expect(normalizePath(launch!.studioEntry)).toMatch(/\/node_modules\/@vivy1024\/novelfork-studio\/dist\/api\/index\.js$/);
    expect(launch!.command).toBe("node");
    expect(launch!.args.map(normalizePath)).toEqual([
      expect.stringMatching(/\/node_modules\/@vivy1024\/novelfork-studio\/dist\/api\/index\.js$/),
      "/repo/test-project",
    ]);
  });

  it("falls back to the CLI installation's bundled studio runtime", async () => {
    accessMock.mockImplementation(async (path: string) => {
      if (normalizePath(path).endsWith("/node_modules/@vivy1024/novelfork-studio/dist/api/index.js")) {
        return;
      }
      throw new Error(`missing: ${path}`);
    });

    const { resolveStudioLaunch } = await import("../commands/studio.js");
    const launch = await resolveStudioLaunch("/repo/test-project");

    expect(launch).not.toBeNull();
    expect(normalizePath(launch!.studioEntry)).toMatch(/\/node_modules\/@vivy1024\/novelfork-studio\/dist\/api\/index\.js$/);
    expect(launch!.command).toBe("node");
    expect(launch!.args.map(normalizePath)).toEqual([
      expect.stringMatching(/\/node_modules\/@vivy1024\/novelfork-studio\/dist\/api\/index\.js$/),
      "/repo/test-project",
    ]);
  });

  it("returns a browser launch spec for macOS", async () => {
    const { resolveBrowserLaunch } = await import("../commands/studio.js");
    expect(resolveBrowserLaunch("darwin", "http://localhost:4567")).toEqual({
      command: "open",
      args: ["http://localhost:4567"],
    });
  });

  it("returns a browser launch spec for Windows", async () => {
    const { resolveBrowserLaunch } = await import("../commands/studio.js");
    expect(resolveBrowserLaunch("win32", "http://localhost:4567")).toEqual({
      command: "cmd",
      args: ["/c", "start", "", "http://localhost:4567"],
    });
  });

  it("returns a browser launch spec for Linux", async () => {
    const { resolveBrowserLaunch } = await import("../commands/studio.js");
    expect(resolveBrowserLaunch("linux", "http://localhost:4567")).toEqual({
      command: "xdg-open",
      args: ["http://localhost:4567"],
    });
  });
});
