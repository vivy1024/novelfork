import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logMock = vi.fn();
const logErrorMock = vi.fn();
const processExitMock = vi.fn();
const fetchMock = vi.fn();

vi.mock("../utils.js", () => ({
  findProjectRoot: vi.fn(() => "/project"),
  log: logMock,
  logError: logErrorMock,
  resolveContext: vi.fn(),
}));

describe("root -p prompt path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(process, "exit").mockImplementation(processExitMock as unknown as (code?: string | number | null) => never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses the same headless prompt request as exec with book session model permission root and stream-json", async () => {
    fetchMock.mockResolvedValue({
      text: async () => [
        JSON.stringify({ type: "assistant_message", session_id: "s-existing", content: "ok" }),
        JSON.stringify({ type: "result", session_id: "s-existing", success: true, exit_code: 0 }),
      ].join("\n"),
    });

    const { createProgram } = await import("../index.js");
    const program = createProgram();
    program.exitOverride();
    await program.parseAsync([
      "node", "novelfork",
      "-p", "写下一章",
      "--book", "book-1",
      "--session", "s-existing",
      "--model", "openai:gpt-4o",
      "--permission-mode", "edit",
      "--root", "D:/books/project",
      "--output-format", "stream-json",
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4567/api/sessions/headless-chat",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toMatchObject({
      prompt: "写下一章",
      outputFormat: "stream-json",
      projectId: "book-1",
      sessionId: "s-existing",
      root: "D:/books/project",
      sessionConfig: { providerId: "openai", modelId: "gpt-4o", permissionMode: "edit" },
    });
    expect(logMock.mock.calls.map((call) => JSON.parse(call[0] as string)).at(-1)).toMatchObject({ type: "result", success: true });
    expect(processExitMock).toHaveBeenCalledWith(0);
  });
});
