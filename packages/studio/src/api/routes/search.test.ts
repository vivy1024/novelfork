import { afterEach, describe, expect, it } from "vitest";

import { globalSearchIndex } from "../lib/search-index.js";
import { createSearchRouter } from "./search.js";

afterEach(() => {
  globalSearchIndex.clear();
});

describe("search routes", () => {
  it("serves POST /api/search using the implemented results contract", async () => {
    globalSearchIndex.index({
      id: "chapter:book-1:1",
      type: "chapter",
      title: "第一章 灵潮初起",
      content: "灵潮从城墙外涌来，主角第一次听见命运的回声。",
      bookId: "book-1",
      timestamp: 1,
      metadata: { chapterNumber: 1, bookTitle: "灵潮纪元" },
    });

    const app = createSearchRouter({ state: {} } as never);
    const response = await app.request("http://localhost/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "灵潮", type: "chapter" }),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as {
      results: Array<{
        id: string;
        bookId: string;
        title: string;
        type: string;
        highlights: string[];
      }>;
    };
    expect(body.results[0]).toMatchObject({
      id: "chapter:book-1:1",
      bookId: "book-1",
      title: "第一章 灵潮初起",
      type: "chapter",
    });
    expect(body.results[0]?.highlights).toContainEqual(expect.stringContaining("灵潮"));
  });
});
