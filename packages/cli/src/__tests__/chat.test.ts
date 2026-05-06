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

function jsonResponse(body: unknown, status = 200) {
  return {
    status,
    headers: { get: vi.fn(() => "application/json") },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function ndjsonResponse(lines: readonly unknown[], status = 200) {
  const text = lines.map((line) => JSON.stringify(line)).join("\n");
  return {
    status,
    headers: { get: vi.fn(() => "application/x-ndjson") },
    json: async () => { throw new Error("expected text parsing"); },
    text: async () => text,
  };
}

describe("chat command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(process, "exit").mockImplementation(processExitMock as unknown as (code?: string | number | null) => never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("calls headless chat API and prints the final message for text chat", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      success: true,
      exitCode: 0,
      sessionId: "session-1",
      finalMessage: "第三章候选稿已生成。",
      events: [{ type: "result", success: true, exit_code: 0 }],
    }));

    const { chatCommand } = await import("../commands/chat.js");
    await chatCommand.parseAsync(["node", "chat", "写下一章"]);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4567/api/sessions/headless-chat",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toMatchObject({ prompt: "写下一章", outputFormat: "json" });
    expect(logMock).toHaveBeenCalledWith("第三章候选稿已生成。");
    expect(processExitMock).toHaveBeenCalledWith(0);
  });

  it("passes session, book, model and JSON output options", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      success: true,
      exitCode: 0,
      sessionId: "session/1",
      events: [{ type: "result", success: true, exit_code: 0 }],
    }));

    const { chatCommand } = await import("../commands/chat.js");
    await chatCommand.parseAsync([
      "node", "chat", "继续",
      "--session", "session/1",
      "--book", "book/1",
      "--model", "anthropic:claude-sonnet-4-6",
      "--json",
    ]);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toMatchObject({
      prompt: "继续",
      sessionId: "session/1",
      projectId: "book/1",
      outputFormat: "json",
      sessionConfig: { providerId: "anthropic", modelId: "claude-sonnet-4-6" },
    });
    expect(logMock.mock.calls.map((call: unknown[]) => JSON.parse(call[0] as string))).toEqual([
      expect.objectContaining({ type: "result", success: true }),
    ]);
    expect(processExitMock).toHaveBeenCalledWith(0);
  });

  it("passes stream-json input/output and no-session-persistence options", async () => {
    fetchMock.mockResolvedValue(ndjsonResponse([
      { type: "user_message", content: "审校", ephemeral: true },
      { type: "result", success: true, exit_code: 0, ephemeral: true },
    ]));

    const { chatCommand } = await import("../commands/chat.js");
    await chatCommand.parseAsync([
      "node", "chat", "审校",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--no-session-persistence",
    ]);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toMatchObject({
      inputFormat: "stream-json",
      outputFormat: "stream-json",
      noSessionPersistence: true,
      events: [{ type: "user_message", content: "审校" }],
    });
    const output = logMock.mock.calls.map((call: unknown[]) => JSON.parse(call[0] as string));
    expect(output).toEqual([
      expect.objectContaining({ type: "user_message", ephemeral: true }),
      expect.objectContaining({ type: "result", success: true, exit_code: 0 }),
    ]);
    expect(processExitMock).toHaveBeenCalledWith(0);
  });

  it("exits with code 2 on pending confirmation", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      success: false,
      exitCode: 2,
      sessionId: "session-1",
      pendingConfirmation: { toolName: "guided.exit", id: "confirm-1" },
      events: [{ type: "permission_request", tool_name: "guided.exit" }],
    }, 202));

    const { chatCommand } = await import("../commands/chat.js");
    await chatCommand.parseAsync(["node", "chat", "生成计划"]);

    expect(logErrorMock).toHaveBeenCalledWith(expect.stringContaining("guided.exit"));
    expect(processExitMock).toHaveBeenCalledWith(2);
  });
});
