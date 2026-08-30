import { describe, expect, it } from "vitest";

import { decodeFanqiePua, FANQIE_PUA_MAP } from "./fanqie-pua.js";
import { parseFanqieRankingHtml, scrapeFanqieRank } from "./fanqie.js";

describe("fanqie pua and ranking parser", () => {
  it("covers digits, latin letters and common chinese characters", () => {
    const mapped = Object.values(FANQIE_PUA_MAP);
    for (const ch of "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ的一是了我不人在") {
      expect(mapped).toContain(ch);
    }
    expect(Object.keys(FANQIE_PUA_MAP).length).toBeGreaterThanOrEqual(250);
    expect(decodeFanqiePua(String.fromCodePoint(58670, 58413, 58611))).toBe("01的");
  });

  it("parses __INITIAL_STATE__ book_list into RankRecord", () => {
    const html = `<html><script>window.__INITIAL_STATE__ = ${JSON.stringify({
      rank: {
        book_list: [{
          bookId: "123",
          bookName: `修仙${String.fromCodePoint(58670)}`,
          author: "张三",
          categoryV2: "玄幻",
          currentPos: 1,
          wordNumber: 120000,
          abstract: "简介",
        }],
      },
    })};</script></html>`;
    const records = parseFanqieRankingHtml(html, "male_read", "2026-06-22");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      platform: "fanqie",
      book_id: "123",
      title: "修仙0",
      author: "张三",
      category: "玄幻",
      rank: 1,
      source_status: "ok",
      font_decoded: true,
    });
  });

  it("falls back to signed API when HTML has no state", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/api/rank/category/list")) {
        expect(url).toContain("a_bogus=");
        return new Response(JSON.stringify({
          data: {
            book_list: [{ book_id: "9", bookName: "黑马", author: "李四", abstract: "简介" }],
          },
        }), { status: 200 });
      }
      return new Response("<html>no state</html>", { status: 200 });
    };
    const snapshot = await scrapeFanqieRank("male_read", {
      fetchImpl,
      delay: async () => undefined,
      now: () => new Date("2026-06-22T00:00:00.000Z"),
      maxPages: 1,
    });
    expect(snapshot.records[0]?.book_id).toBe("9");
    expect(snapshot.records[0]?.title).toBe("黑马");
  });
});
