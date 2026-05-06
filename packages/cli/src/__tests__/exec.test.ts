import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logMock = vi.fn();
const logErrorMock = vi.fn();
const processExitMock = vi.fn();

vi.mock("../utils.js", () => ({
  findProjectRoot: vi.fn(() => "/project"),
  log: logMock,
  logError: logErrorMock,
  resolveContext: vi.fn(),
}));

const fetchMock = vi.fn();

describe("exec command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(process, "exit").mockImplementation(processExitMock as unknown as (code?: string | number | null) => never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("outputs the final message on successful execution", async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({
        success: true,
        exitCode: 0,
        sessionId: "s-1",
        finalMessage: "第三章候选稿已生成。",
        events: [],
        toolResults: [],
      }),
    });

    const { execCommand } = await import("../commands/exec.js");
    await execCommand.parseAsync(["node", "exec", "写下一章"]);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4567/api/exec",
      expect.objectContaining({ method: "POST" }),
    );
    expect(logMock).toHaveBeenCalledWith("第三章候选稿已生成。");
    expect(processExitMock).toHaveBeenCalledWith(0);
  });

  it("outputs JSONL events when --json is specified", async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({
        success: true,
        exitCode: 0,
        sessionId: "s-1",
        finalMessage: "ok",
        events: [
          { type: "assistant_message", content: "ok" },
          { type: "turn_completed" },
        ],
        toolResults: [],
      }),
    });

    const { execCommand } = await import("../commands/exec.js");
    await execCommand.parseAsync(["node", "exec", "写", "--json"]);

    const jsonCalls = logMock.mock.calls.map((c: unknown[]) => JSON.parse(c[0] as string));
    expect(jsonCalls[0]).toEqual(expect.objectContaining({ type: "session.created", sessionId: "s-1" }));
    expect(jsonCalls.some((c: { type: string }) => c.type === "assistant_message")).toBe(true);
    expect(jsonCalls.at(-1)).toEqual(expect.objectContaining({ type: "exec.completed", exitCode: 0 }));
    expect(processExitMock).toHaveBeenCalledWith(0);
  });

  it("exits with code 2 on pending confirmation", async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({
        success: false,
        exitCode: 2,
        sessionId: "s-1",
        pendingConfirmation: { toolName: "candidate.create_chapter", id: "tc-1" },
        events: [],
        toolResults: [],
      }),
    });

    const { execCommand } = await import("../commands/exec.js");
    await execCommand.parseAsync(["node", "exec", "生成候选稿"]);

    expect(logErrorMock).toHaveBeenCalledWith(expect.stringContaining("candidate.create_chapter"));
    expect(processExitMock).toHaveBeenCalledWith(2);
  });

  it("exits with code 1 on failure and shows tool chain summary", async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({
        success: false,
        exitCode: 1,
        error: "model-unavailable",
        toolChainSummary: "cockpit.get_snapshot → error",
        events: [],
        toolResults: [],
      }),
    });

    const { execCommand } = await import("../commands/exec.js");
    await execCommand.parseAsync(["node", "exec", "写"]);

    expect(logErrorMock).toHaveBeenCalledWith(expect.stringContaining("model-unavailable"));
    expect(logErrorMock).toHaveBeenCalledWith(expect.stringContaining("cockpit.get_snapshot"));
    expect(processExitMock).toHaveBeenCalledWith(1);
  });

  it("passes stream-json, input-format, and no-session-persistence options to the headless chat API", async () => {
    fetchMock.mockResolvedValue({
      text: async () => [
        JSON.stringify({ type: "user_message", content: "写" }),
        JSON.stringify({ type: "result", success: true, exit_code: 0 }),
      ].join("\n"),
    });

    const { execCommand } = await import("../commands/exec.js");
    await execCommand.parseAsync([
      "node", "exec", "写",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--no-session-persistence",
      "--max-turns", "1",
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4567/api/sessions/headless-chat",
      expect.objectContaining({ method: "POST" }),
    );
    const callBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(callBody).toMatchObject({
      inputFormat: "stream-json",
      outputFormat: "stream-json",
      noSessionPersistence: true,
      maxTurns: 1,
      events: [{ type: "user_message", content: "写" }],
    });
    const jsonCalls = logMock.mock.calls.map((c: unknown[]) => JSON.parse(c[0] as string));
    expect(jsonCalls.at(-1)).toEqual(expect.objectContaining({ type: "result", success: true }));
    expect(processExitMock).toHaveBeenCalledWith(0);
  });

  it("passes --model, --book, --session and --max-steps to the API", async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({
        success: true,
        exitCode: 0,
        finalMessage: "ok",
        events: [],
        toolResults: [],
      }),
    });

    const { execCommand } = await import("../commands/exec.js");
    await execCommand.parseAsync([
      "node", "exec", "写一章",
      "--model", "openai:gpt-4o",
      "--book", "book-1",
      "--session", "s-existing",
      "--max-steps", "10",
    ]);

    const callBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(callBody.prompt).toBe("写一章");
    expect(callBody.projectId).toBe("book-1");
    expect(callBody.sessionId).toBe("s-existing");
    expect(callBody.sessionConfig).toEqual({ providerId: "openai", modelId: "gpt-4o" });
    expect(callBody.maxSteps).toBe(10);
  });
});
