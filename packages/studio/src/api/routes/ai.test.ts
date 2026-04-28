import { describe, expect, it, vi } from "vitest";

const coreMocks = vi.hoisted(() => ({
  chatCompletion: vi.fn(() => Promise.resolve({ content: "山门外风声渐紧", usage: { inputTokens: 10, outputTokens: 8 } })),
}));

vi.mock("@vivy1024/novelfork-core", () => ({
  PipelineRunner: vi.fn(),
  chatCompletion: coreMocks.chatCompletion,
  createLLMClient: vi.fn(() => ({})),
  extractPOVFromOutline: vi.fn(() => undefined),
  fetchUrl: vi.fn(() => Promise.resolve("captured text")),
  filterCharacterMatrix: vi.fn((value: string) => value),
  filterEmotionalArcs: vi.fn((value: string) => value),
  filterHooks: vi.fn((value: string) => value),
  filterHooksByPOV: vi.fn((value: string) => value),
  filterMatrixByPOV: vi.fn((value: string) => value),
  filterSubplots: vi.fn((value: string) => value),
  filterSummaries: vi.fn((value: string) => value),
}));

import { createAIRouter } from "./ai";

function createRoute() {
  return createAIRouter({
    root: "D:/tmp/novelfork-test",
    state: {
      bookDir: (bookId: string) => `D:/tmp/novelfork-test/books/${bookId}`,
      loadBookConfig: vi.fn(() => Promise.resolve({ id: "book-1", title: "测试书" })),
      rollbackToChapter: vi.fn(),
    },
    broadcast: vi.fn(),
    buildPipelineConfig: vi.fn(() => Promise.resolve({
      client: { provider: "test-provider" },
      model: "test-model",
      logger: undefined,
    })),
    getSessionLlm: vi.fn(() => Promise.resolve(undefined)),
    runStore: {} as never,
    getStartupSummary: () => null,
    setStartupSummary: vi.fn(),
    setStartupRecoveryRunner: vi.fn(),
  } as never);
}

function parseSseData(text: string): Array<Record<string, unknown>> {
  return text
    .split(/\n\n+/)
    .flatMap((event) => event.split("\n").filter((line) => line.startsWith("data: ")))
    .map((line) => JSON.parse(line.slice("data: ".length)) as Record<string, unknown>);
}

describe("AI routes", () => {
  it("marks inline completion SSE chunks as chunked-buffer when upstream streaming is not used", async () => {
    const app = createRoute();

    const response = await app.request("http://localhost/api/ai/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "山门外", surrounding: "林月抬头。", bookId: "book-1", chapterNumber: 1 }),
    });

    expect(response.status).toBe(200);
    const events = parseSseData(await response.text());
    expect(coreMocks.chatCompletion).toHaveBeenCalledTimes(1);
    expect(events[0]).toMatchObject({ done: false, streamSource: "chunked-buffer" });
    expect(events.at(-1)).toMatchObject({ text: "", done: true, streamSource: "chunked-buffer" });
  });
});
