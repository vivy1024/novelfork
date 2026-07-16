import { describe, expect, it, vi } from "vitest";
import {
  buildSearchResultHref,
  compactSnippet,
  countSearchResultTypes,
  createRuntimeSearchClient,
  filterAndSortSearchResults,
  normalizeSearchSort,
  normalizeSearchType,
  resolvePrimaryNarratorForChapter,
  summarizeSearchRuntimeState,
  type RuntimeSearchResponse,
  type RuntimeSearchResult,
} from "./runtime-search";

const results: RuntimeSearchResult[] = [
  { id: "message-1", type: "message", narratorId: "narrator/1", title: "消息", matchScore: 4, updatedAt: "2026-02-02T00:00:00.000Z" },
  { id: "chapter-1", type: "chapter", chapterTitle: "第一章", matchScore: 9, updatedAt: "2026-01-01T00:00:00.000Z" },
  { id: "narrator-1", type: "narrator", narratorTitle: "主叙述者", matchScore: 6, updatedAt: "2026-03-03T00:00:00.000Z" },
];

describe("Runtime search contract", () => {
  it("uses the original NarraFork GET search endpoint and entity set", async () => {
    const json = vi.fn(async () => ({ results: [] })) as unknown as <T>(path: string, init?: RequestInit) => Promise<T>;

    await createRuntimeSearchClient(json).search("角色 弧光");

    expect(json).toHaveBeenCalledWith("/api/search?q=%E8%A7%92%E8%89%B2+%E5%BC%A7%E5%85%89&entities=chapters%2Cmessages%2Cnarrators");
  });

  it("resolves chapter deep links through the original primary narrator contract", async () => {
    const json = vi.fn(async () => ({
      items: [
        { id: "reviewer", variant: "reviewer" },
        { id: "primary-narrator", variant: "primary" },
      ],
    })) as unknown as <T>(path: string, init?: RequestInit) => Promise<T>;

    await expect(resolvePrimaryNarratorForChapter("chapter/1", json)).resolves.toBe("primary-narrator");
    expect(json).toHaveBeenCalledWith("/api/narrators?chapterId=chapter%2F1&limit=100");
  });

  it("normalizes original plural URL values", () => {
    expect(normalizeSearchType("chapters")).toBe("chapter");
    expect(normalizeSearchType("narrators")).toBe("narrator");
    expect(normalizeSearchType("messages")).toBe("message");
    expect(normalizeSearchType("invalid")).toBe("all");
    expect(normalizeSearchSort("invalid")).toBe("relevance");
  });

  it("filters and applies the original relevance and time sorting", () => {
    expect(filterAndSortSearchResults(results, "all", "relevance").map((result) => result.id)).toEqual([
      "chapter-1",
      "narrator-1",
      "message-1",
    ]);
    expect(filterAndSortSearchResults(results, "narrator", "relevance").map((result) => result.id)).toEqual(["narrator-1"]);
    expect(filterAndSortSearchResults(results, "all", "time").map((result) => result.id)).toEqual([
      "narrator-1",
      "message-1",
      "chapter-1",
    ]);
    expect(countSearchResultTypes(results)).toEqual({ all: 3, chapter: 1, narrator: 1, message: 1 });
  });

  it("preserves canonical narrator, chapter, and message deep links", () => {
    expect(buildSearchResultHref(results[0])).toBe("/narrators/narrator%2F1#msg-message-1");
    expect(buildSearchResultHref(results[1])).toBe("/chapters/chapter-1");
    expect(buildSearchResultHref(results[2])).toBe("/narrators/narrator-1");
    expect(buildSearchResultHref({ id: "message-2", type: "message", chapterId: "chapter/2" })).toBe("/chapters/chapter%2F2#msg-message-2");
    expect(buildSearchResultHref({ id: "narrator-2", type: "narrator", chapterId: "chapter-2" })).toBe("/chapters/chapter-2");
  });

  it("summarizes and deduplicates degraded Runtime fallbacks", () => {
    const fallback = { entity: "messages", reason: "fts unavailable", from: "fts", to: "like" };
    const response: RuntimeSearchResponse = {
      results: [],
      degraded: true,
      fallbacks: [fallback],
      searchMetadata: { mode: "fallback", fallbacks: [fallback] },
    };

    expect(summarizeSearchRuntimeState(response)).toEqual({
      degraded: true,
      mode: "fallback",
      fallbackMessages: ["messages: fts unavailable (fts → like)"],
    });
  });

  it("builds a compact snippet around the first match", () => {
    expect(compactSnippet("前文 前文 目标词 后文 后文", "目标词", 4)).toBe("… 前文 目标词 后文 …");
  });
});
