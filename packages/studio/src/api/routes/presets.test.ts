import { describe, expect, it, vi } from "vitest";
import { createPresetsRouter } from "./presets";

const coreMocks = vi.hoisted(() => {
  const presets = [
    { id: "anti-ai-full-scan", name: "12 特征全量扫描", category: "anti-ai", description: "AI 味过滤", promptInjection: "scan" },
    { id: "literary-controlling-idea", name: "控制观念锚定", category: "literary", description: "文学技法", promptInjection: "idea" },
  ];
  const bundles = [
    {
      id: "industrial-occult-mystery",
      name: "工业神秘悬疑",
      category: "bundle",
      description: "组合",
      promptInjection: "bundle",
      genreIds: ["mystery"],
      toneId: "austere-pragmatic",
      settingBaseId: "victorian-industrial-occult",
      logicRiskIds: ["information-flow"],
      difficulty: "hard",
    },
  ];
  const beats = [{ id: "three-act", name: "三幕结构", description: "三幕", beats: [] }];
  const allPresets = [...presets, ...bundles];

  return {
    presets,
    bundles,
    beats,
    listPresets: vi.fn((category?: string) => category ? allPresets.filter((p) => p.category === category) : allPresets),
    listBundles: vi.fn(() => bundles),
    listBeatTemplates: vi.fn(() => beats),
    getPreset: vi.fn((id: string) => allPresets.find((p) => p.id === id)),
    getBundle: vi.fn((id: string) => bundles.find((p) => p.id === id)),
    getPresetsByGenre: vi.fn(() => presets),
  };
});

vi.mock("@vivy1024/novelfork-core", () => ({
  listPresets: coreMocks.listPresets,
  listBundles: coreMocks.listBundles,
  listBeatTemplates: coreMocks.listBeatTemplates,
  getPreset: coreMocks.getPreset,
  getBundle: coreMocks.getBundle,
  getPresetsByGenre: coreMocks.getPresetsByGenre,
}));

function createRoute(initialBook?: Record<string, unknown>) {
  let book = initialBook;
  const state = {
    async loadBookConfig(id: string) {
      if (!book || book.id !== id) throw new Error("missing book");
      return book;
    },
    async saveBookConfig(id: string, updated: Record<string, unknown>) {
      if (!book || book.id !== id) throw new Error("missing book");
      book = updated;
    },
  };

  return {
    app: createPresetsRouter({
      state,
      root: "",
      broadcast: vi.fn(),
      buildPipelineConfig: vi.fn(),
      getSessionLlm: vi.fn(),
      runStore: {} as never,
      getStartupSummary: () => null,
      setStartupSummary: vi.fn(),
      setStartupRecoveryRunner: vi.fn(),
    } as never),
    getBook: () => book,
  };
}

describe("presets routes", () => {
  it("lists presets, bundles, and beat templates", async () => {
    const { app } = createRoute();

    const presetsResponse = await app.request("http://localhost/api/presets");
    expect(presetsResponse.status).toBe(200);
    const presetsJson = await presetsResponse.json() as { presets: Array<{ id: string; category: string }> };
    expect(presetsJson.presets.some((p) => p.category === "anti-ai")).toBe(true);
    expect(presetsJson.presets.some((p) => p.category === "literary")).toBe(true);

    const bundlesResponse = await app.request("http://localhost/api/presets/bundles");
    expect(bundlesResponse.status).toBe(200);
    const bundlesJson = await bundlesResponse.json() as { bundles: Array<{ id: string }> };
    expect(bundlesJson.bundles).toEqual(coreMocks.bundles);

    const beatsResponse = await app.request("http://localhost/api/presets/beats");
    expect(beatsResponse.status).toBe(200);
    const beatsJson = await beatsResponse.json() as { beats: Array<{ id: string }> };
    expect(beatsJson.beats).toEqual(coreMocks.beats);
  });

  it("persists enabled presets to the book config", async () => {
    const { app, getBook } = createRoute({
      id: "book-a",
      title: "Book A",
      platform: "tomato",
      genre: "xianxia",
      status: "active",
      targetChapters: 10,
      chapterWordCount: 3000,
      createdAt: "2026-04-26T00:00:00.000Z",
      updatedAt: "2026-04-26T00:00:00.000Z",
    });

    const putResponse = await app.request("http://localhost/api/books/book-a/presets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabledPresetIds: ["anti-ai-full-scan", "literary-controlling-idea"] }),
    });

    expect(putResponse.status).toBe(200);
    expect(getBook()?.enabledPresetIds).toEqual(["anti-ai-full-scan", "literary-controlling-idea"]);

    const getResponse = await app.request("http://localhost/api/books/book-a/presets");
    expect(getResponse.status).toBe(200);
    const getJson = await getResponse.json() as { enabledPresetIds: string[]; enabledPresets: Array<{ id: string }> };
    expect(getJson.enabledPresetIds).toEqual(["anti-ai-full-scan", "literary-controlling-idea"]);
    expect(getJson.enabledPresets.map((p) => p.id)).toEqual(["anti-ai-full-scan", "literary-controlling-idea"]);
  });

  it("saves custom preset overrides without replacing the built-in preset", async () => {
    const { app, getBook } = createRoute({
      id: "book-a",
      title: "Book A",
      platform: "tomato",
      genre: "xianxia",
      status: "active",
      targetChapters: 10,
      chapterWordCount: 3000,
      createdAt: "2026-04-26T00:00:00.000Z",
      updatedAt: "2026-04-26T00:00:00.000Z",
    });

    const response = await app.request("http://localhost/api/books/book-a/presets/anti-ai-full-scan/customize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ promptInjection: "custom scan" }),
    });

    expect(response.status).toBe(200);
    expect(getBook()?.customPresetOverrides).toEqual({
      "anti-ai-full-scan": { promptInjection: "custom scan" },
    });
  });
});
