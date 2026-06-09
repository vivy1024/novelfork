import { beforeAll, describe, expect, it, vi } from "vitest";

import { registerBuiltinPresets } from "@vivy1024/novelfork-novel-plugin/engine";

import { createPresetsRouter } from "./presets";

beforeAll(() => {
  // 预设是内部静态数据：注册真实内置预设，而非 mock。
  registerBuiltinPresets();
});

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
    const bundlesJson = await bundlesResponse.json() as { bundles: Array<{ id: string; category: string }> };
    expect(bundlesJson.bundles.length).toBeGreaterThan(0);
    expect(bundlesJson.bundles.every((b) => b.category === "bundle")).toBe(true);
    expect(bundlesJson.bundles.some((b) => b.id === "industrial-occult-mystery")).toBe(true);

    const beatsResponse = await app.request("http://localhost/api/presets/beats");
    expect(beatsResponse.status).toBe(200);
    const beatsJson = await beatsResponse.json() as { beats: Array<{ id: string }> };
    expect(beatsJson.beats.some((b) => b.id === "three-act")).toBe(true);
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
