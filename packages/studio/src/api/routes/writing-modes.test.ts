import { describe, expect, it, vi } from "vitest";
import { createWritingModesRouter } from "./writing-modes.js";

const coreMocks = vi.hoisted(() => ({
  buildContinuationPrompt: vi.fn(() => "continuation-prompt"),
  buildExpansionPrompt: vi.fn(() => "expansion-prompt"),
  buildBridgePrompt: vi.fn(() => "bridge-prompt"),
  buildDialoguePrompt: vi.fn(() => "dialogue-prompt"),
  buildVariantPrompts: vi.fn((_i: unknown, _c: unknown, count: number) =>
    Array.from({ length: count }, (_, i) => `variant-prompt-${i}`),
  ),
  buildBranchPrompt: vi.fn(() => "branch-prompt"),
  parseFile: vi.fn(() => ({ chapters: [{ title: "Ch1", content: "text" }] })),
  mergeStyleProfiles: vi.fn(() => ({
    mergedFrom: 1,
    avgSentenceLength: { min: 18, max: 18, mean: 18 },
    vocabularyDiversity: { min: 0.7, max: 0.7, mean: 0.7 },
    dialogueRatio: { min: 0.3, max: 0.3, mean: 0.3 },
  })),
  detectStyleDrift: vi.fn(() => ({
    sentenceLengthDrift: 0.1,
    vocabularyDrift: 0.05,
    overallDrift: 0.075,
    isSignificant: false,
  })),
}));

vi.mock("@vivy1024/novelfork-core", () => ({
  ...coreMocks,
}));

function buildCtx(): Parameters<typeof createWritingModesRouter>[0] {
  return {
    state: {} as never,
    root: "/tmp/test",
    broadcast: vi.fn(),
    buildPipelineConfig: vi.fn(),
    getSessionLlm: vi.fn(),
    runStore: {} as never,
    getStartupSummary: vi.fn(() => null),
    setStartupSummary: vi.fn(),
    setStartupRecoveryRunner: vi.fn(),
  };
}

describe("writing-modes router", () => {
  const router = createWritingModesRouter(buildCtx());

  async function request(method: string, path: string, body?: unknown) {
    const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
    if (body) init.body = JSON.stringify(body);
    const res = await router.request(new Request(`http://localhost${path}`, init));
    return { status: res.status, json: await res.json() };
  }

  it("POST /api/books/:bookId/inline-write — continuation", async () => {
    const { status, json } = await request("POST", "/api/books/book1/inline-write", {
      mode: "continuation",
      selectedText: "他拔出了剑。",
      beforeText: "前文...",
      chapterNumber: 3,
    });
    expect(status).toBe(200);
    expect(json.prompt).toBe("continuation-prompt");
    expect(json.mode).toBe("continuation");
  });

  it("POST /api/books/:bookId/inline-write — invalid mode", async () => {
    const { status } = await request("POST", "/api/books/book1/inline-write", { mode: "invalid" });
    expect(status).toBe(400);
  });

  it("POST /api/books/:bookId/dialogue/generate", async () => {
    const { status, json } = await request("POST", "/api/books/book1/dialogue/generate", {
      characters: [{ name: "林月" }],
      scene: "山门前",
      purpose: "争论",
    });
    expect(status).toBe(200);
    expect(json.prompt).toBe("dialogue-prompt");
  });

  it("POST /api/books/:bookId/dialogue/generate — no characters", async () => {
    const { status } = await request("POST", "/api/books/book1/dialogue/generate", {
      scene: "山门前",
    });
    expect(status).toBe(400);
  });

  it("POST /api/books/:bookId/variants/generate", async () => {
    const { status, json } = await request("POST", "/api/books/book1/variants/generate", {
      selectedText: "原文",
      count: 3,
    });
    expect(status).toBe(200);
    expect(json.prompts).toHaveLength(3);
    expect(json.count).toBe(3);
  });

  it("POST /api/books/:bookId/outline/branch", async () => {
    const { status, json } = await request("POST", "/api/books/book1/outline/branch", {
      outline: [{ id: "n1", title: "开端", summary: "..." }],
      hooks: [],
      state: "当前状态",
      summaries: [],
    });
    expect(status).toBe(200);
    expect(json.prompt).toBe("branch-prompt");
  });

  it("POST /api/books/:bookId/outline/branch/:branchId/expand", async () => {
    const { status, json } = await request("POST", "/api/books/book1/outline/branch/b1/expand", {
      title: "分支一",
      description: "描述",
      chapters: [],
    });
    expect(status).toBe(200);
    expect(json.branchId).toBe("b1");
    expect(json.prompt).toContain("大纲分支扩展任务");
  });

  it("POST /api/works/import", async () => {
    const { status, json } = await request("POST", "/api/works/import", {
      content: "第一章\n正文",
      filename: "novel.txt",
    });
    expect(status).toBe(200);
    expect(json.chapters).toHaveLength(1);
  });

  it("POST /api/works/import — empty content", async () => {
    const { status } = await request("POST", "/api/works/import", { content: "", filename: "a.txt" });
    expect(status).toBe(400);
  });

  it("GET /api/style/personal-profile", async () => {
    const profiles = JSON.stringify([{ avgSentenceLength: 18, sentenceLengthStdDev: 5, vocabularyDiversity: 0.7, dialogueRatio: 0.3 }]);
    const { status, json } = await request("GET", `/api/style/personal-profile?profiles=${encodeURIComponent(profiles)}`);
    expect(status).toBe(200);
    expect(json.profile.mergedFrom).toBe(1);
  });

  it("GET /api/style/personal-profile — missing param", async () => {
    const { status } = await request("GET", "/api/style/personal-profile");
    expect(status).toBe(400);
  });

  it("POST /api/books/:bookId/style/drift-check", async () => {
    const profile = { avgSentenceLength: 20, sentenceLengthStdDev: 5, vocabularyDiversity: 0.7, dialogueRatio: 0.3 };
    const { status, json } = await request("POST", "/api/books/book1/style/drift-check", {
      current: profile,
      base: profile,
    });
    expect(status).toBe(200);
    expect(json.drift.isSignificant).toBe(false);
  });

  it("POST /api/books/:bookId/style/drift-check — missing profiles", async () => {
    const { status } = await request("POST", "/api/books/book1/style/drift-check", {});
    expect(status).toBe(400);
  });
});
