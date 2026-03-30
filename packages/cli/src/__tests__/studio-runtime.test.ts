import { beforeEach, describe, expect, it, vi } from "vitest";

const accessMock = vi.fn();

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
});
