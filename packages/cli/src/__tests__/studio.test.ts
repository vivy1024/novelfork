import { beforeEach, describe, expect, it, vi } from "vitest";

const accessMock = vi.fn();
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
      if (path === "/project/packages/studio/src/api/index.ts") {
        return;
      }
      throw new Error(`missing: ${path}`);
    });

    const { studioCommand } = await import("../commands/studio.js");
    await studioCommand.parseAsync(["node", "studio", "--port", "9001"]);

    expect(spawnMock).toHaveBeenCalledWith(
      "npx",
      ["tsx", "/project/packages/studio/src/api/index.ts", "/project"],
      expect.objectContaining({
        cwd: "/project",
        stdio: "inherit",
        env: expect.objectContaining({ NOVELFORK_STUDIO_PORT: "9001" }),
      }),
    );
  });

  it("launches built JavaScript entries through node", async () => {
    accessMock.mockImplementation(async (path: string) => {
      if (path === "/project/node_modules/@vivy1024/novelfork-studio/dist/api/index.js") {
        return;
      }
      throw new Error(`missing: ${path}`);
    });

    const { studioCommand } = await import("../commands/studio.js");
    await studioCommand.parseAsync(["node", "studio", "--port", "4567"]);

    expect(spawnMock).toHaveBeenCalledWith(
      "node",
      ["/project/node_modules/@vivy1024/novelfork-studio/dist/api/index.js", "/project"],
      expect.objectContaining({
        cwd: "/project",
        stdio: "inherit",
        env: expect.objectContaining({ NOVELFORK_STUDIO_PORT: "4567" }),
      }),
    );
  });
});
