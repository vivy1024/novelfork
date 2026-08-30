import { describe, expect, it } from "vitest";

import { samplePublicChapters } from "./public-chapter-sampler.js";

describe("public chapter sampler", () => {
  it("returns structural metrics and never keeps chapter body", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/api/reader/directory/detail")) {
        return new Response(JSON.stringify({
          data: {
            chapterListWithVolume: [[
              { itemId: "c1", title: "第一章", needPay: 0, isPaidStory: false },
              { itemId: "c2", title: "第二章", needPay: 0, isPaidStory: false },
              { itemId: "c3", title: "第三章", needPay: 1, isPaidStory: true },
            ]],
          },
        }), { status: 200 });
      }
      if (url.endsWith("/reader/c1")) {
        return new Response(`<script>window.__INITIAL_STATE__ = ${JSON.stringify({
          reader: {
            chapterData: {
              title: "第一章",
              content: "<p>林渊说道：“系统，开启金手指。”</p><p>杀意暴起，他重生了！</p>",
            },
          },
        })};</script>`, { status: 200 });
      }
      return new Response("missing", { status: 404 });
    };

    const samples = await samplePublicChapters({ book_id: "book-1", maxChapters: 3 }, {
      fetchImpl,
      delay: async () => undefined,
    });
    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({
      book_id: "book-1",
      chapter_id: "c1",
      title: "第一章",
    });
    expect(samples[0]!.chapter_word_count).toBeGreaterThan(0);
    expect(samples[0]!.paragraph_count).toBe(2);
    expect(samples[0]!.system_word_hits).toBeGreaterThan(0);
    expect(samples[0]!.golden_finger_hits).toBeGreaterThan(0);
    expect(JSON.stringify(samples)).not.toContain("林渊说道");
    expect(JSON.stringify(samples)).not.toContain("开启金手指");
  });
});
