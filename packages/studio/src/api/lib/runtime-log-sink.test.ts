import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createRuntimeJsonLineSink } from "./runtime-log-sink";
import { getRequestLogs, resetRequestHistory } from "./request-observability";

describe("createRuntimeJsonLineSink", () => {
  let root: string;

  beforeEach(async () => {
    resetRequestHistory();
    root = await mkdtemp(join(tmpdir(), "novelfork-runtime-sink-"));
  });

  afterEach(async () => {
    resetRequestHistory();
    await rm(root, { recursive: true, force: true });
  });

  it("persists ai.request entries to novelfork.log and mirrors them into request history", async () => {
    const logPath = join(root, "novelfork.log");
    const sink = createRuntimeJsonLineSink(logPath);

    sink.write({
      timestamp: "2026-04-20T10:00:00.000Z",
      level: "info",
      tag: "studio",
      message: "AI request completed (inline-complete)",
      ctx: {
        eventType: "ai.request",
        requestDomain: "ai",
        endpoint: "/api/ai/complete",
        method: "POST",
        requestKind: "inline-complete",
        narrator: "studio.ai.complete",
        provider: "openai",
        model: "gpt-4-turbo",
        bookId: "demo-book",
        sessionId: "session-42",
        durationMs: 321,
        ttftMs: 88,
        status: "success",
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        tokenSource: "actual",
      },
    });

    const fileContent = await readFile(logPath, "utf-8");
    expect(fileContent).toContain('"eventType":"ai.request"');

    const [request] = getRequestLogs();
    expect(request).toMatchObject({
      endpoint: "/api/ai/complete",
      requestDomain: "ai",
      provider: "openai",
      model: "gpt-4-turbo",
      bookId: "demo-book",
      sessionId: "session-42",
      aiStatus: "success",
      ttftMs: 88,
      tokens: {
        input: 100,
        output: 50,
        total: 150,
        source: "actual",
      },
    });
    expect(request.costUsd).toBeGreaterThan(0);
  });
});
