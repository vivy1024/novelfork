import { beforeEach, describe, expect, it, vi } from "vitest";

const accessMock = vi.fn();
const normalizePath = (value: string) => value.replace(/\\/g, "/");
const spawnMock = vi.fn(() => ({
  on: vi.fn(),
}));
const logMock = vi.fn();
const logErrorMock = vi.fn();

vi.mock("node:fs/promises", () => ({
  access: accessMock,
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

vi.mock("../utils.js", () => ({
  findProjectRoot: vi.fn(() => "/project"),
  log: logMock,
  logError: logErrorMock,
}));

describe("studio command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("launches TypeScript sources through tsx in monorepo mode", async () => {
    accessMock.mockImplementation(async (path: string) => {
      if (normalizePath(path).endsWith("/packages/studio/src/api/index.ts")) {
        return;
      }
      throw new Error(`missing: ${path}`);
    });

    const { studioCommand } = await import("../commands/studio.js");
    await studioCommand.parseAsync(["node", "studio", "--port", "9001"]);

    const launchCall = spawnMock.mock.calls[0] as unknown as [string, string[], Record<string, unknown>];
    expect(launchCall).toBeDefined();
    expect(launchCall[0]).toBe("npx");
    expect(launchCall[1].map(normalizePath)).toEqual(["tsx", expect.stringMatching(/\/packages\/studio\/src\/api\/index\.ts$/), "/project"]);
    expect(launchCall[2]).toEqual(expect.objectContaining({
      cwd: "/project",
      stdio: ["pipe", "pipe", "pipe"],
      env: expect.objectContaining({ NOVELFORK_STUDIO_PORT: "9001" }),
    }));
  });

  it("launches built JavaScript entries through node", async () => {
    accessMock.mockImplementation(async (path: string) => {
      if (normalizePath(path).endsWith("/node_modules/@vivy1024/novelfork-studio/dist/api/index.js")) {
        return;
      }
      throw new Error(`missing: ${path}`);
    });

    const { studioCommand } = await import("../commands/studio.js");
    await studioCommand.parseAsync(["node", "studio", "--port", "4567"]);

    const launchCall = spawnMock.mock.calls[0] as unknown as [string, string[], Record<string, unknown>];
    expect(launchCall).toBeDefined();
    expect(launchCall[0]).toBe("node");
    expect(launchCall[1].map(normalizePath)).toEqual([
      expect.stringMatching(/\/node_modules\/@vivy1024\/novelfork-studio\/dist\/api\/index\.js$/),
      "/project",
    ]);
    expect(launchCall[2]).toEqual(expect.objectContaining({
      cwd: "/project",
      stdio: ["pipe", "pipe", "pipe"],
      env: expect.objectContaining({ NOVELFORK_STUDIO_PORT: "4567" }),
    }));
  });
});
