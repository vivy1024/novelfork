import { beforeEach, describe, expect, it, vi } from "vitest";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const accessMock = vi.fn();
const testDir = dirname(fileURLToPath(import.meta.url));
const cliPackageRoot = resolve(testDir, "..", "..");

vi.mock("node:fs/promises", () => ({
  access: accessMock,
}));

describe("studio runtime resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("prefers the repository-local tsx loader for monorepo sources", async () => {
    accessMock.mockImplementation(async (path: string) => {
      if (
        path === "/repo/packages/studio/src/api/index.ts" ||
        path === "/repo/packages/studio/node_modules/tsx/dist/loader.mjs"
      ) {
        return;
      }
      throw new Error(`missing: ${path}`);
    });

    const { resolveStudioLaunch } = await import("../commands/studio.js");
    const launch = await resolveStudioLaunch("/repo/test-project");

    expect(launch).toEqual({
      studioEntry: "/repo/packages/studio/src/api/index.ts",
      command: "node",
      args: [
        "--import",
        "/repo/packages/studio/node_modules/tsx/dist/loader.mjs",
        "/repo/packages/studio/src/api/index.ts",
        "/repo/test-project",
      ],
    });
  });

  it("finds monorepo packages/studio sources from a project directory", async () => {
    accessMock.mockImplementation(async (path: string) => {
      if (path === "/repo/packages/studio/src/api/index.ts") {
        return;
      }
      throw new Error(`missing: ${path}`);
    });

    const { resolveStudioLaunch } = await import("../commands/studio.js");
    const launch = await resolveStudioLaunch("/repo/test-project");

    expect(launch).toEqual({
      studioEntry: "/repo/packages/studio/src/api/index.ts",
      command: "npx",
      args: ["tsx", "/repo/packages/studio/src/api/index.ts", "/repo/test-project"],
    });
  });

  it("uses node for built JavaScript entries", async () => {
    accessMock.mockImplementation(async (path: string) => {
      if (path === "/repo/test-project/node_modules/@actalk/inkos-studio/dist/api/index.js") {
        return;
      }
      throw new Error(`missing: ${path}`);
    });

    const { resolveStudioLaunch } = await import("../commands/studio.js");
    const launch = await resolveStudioLaunch("/repo/test-project");

    expect(launch).toEqual({
      studioEntry: "/repo/test-project/node_modules/@actalk/inkos-studio/dist/api/index.js",
      command: "node",
      args: ["/repo/test-project/node_modules/@actalk/inkos-studio/dist/api/index.js", "/repo/test-project"],
    });
  });

  it("falls back to the CLI installation's bundled studio runtime", async () => {
    accessMock.mockImplementation(async (path: string) => {
      if (path === `${cliPackageRoot}/node_modules/@actalk/inkos-studio/dist/api/index.js`) {
        return;
      }
      throw new Error(`missing: ${path}`);
    });

    const { resolveStudioLaunch } = await import("../commands/studio.js");
    const launch = await resolveStudioLaunch("/repo/test-project");

    expect(launch).toEqual({
      studioEntry: `${cliPackageRoot}/node_modules/@actalk/inkos-studio/dist/api/index.js`,
      command: "node",
      args: [`${cliPackageRoot}/node_modules/@actalk/inkos-studio/dist/api/index.js`, "/repo/test-project"],
    });
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
