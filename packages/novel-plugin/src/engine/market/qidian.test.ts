import { describe, expect, it } from "vitest";

import { looksLikeBlockPage, parseQidianDesktopHtml, parseQidianMobileHtml, scrapeQidianRank } from "./qidian.js";

const DESKTOP_HTML = `
<ul class="all-img-list">
  <li>
    <h2><a href="/info/1001">剑来</a></h2>
    <p class="author"><a href="/author/1">烽火戏诸侯</a><a href="/all/xuanhuan">玄幻</a></p>
    <p class="intro">一剑开天门</p>
    <p class="update">123.4万字</p>
  </li>
</ul>
`;

const MOBILE_HTML = `
<script id="vite-plugin-ssr_pageContext">${JSON.stringify({
  pageContext: {
    pageProps: {
      pageData: {
        records: [{ bid: "2002", bName: "夜的命名术", bAuth: "会说话的肘子", cat: "都市", cnt: "80万字", desc: "简介" }],
      },
    },
  },
})}</script>
`;

describe("qidian ranking parser", () => {
  it("parses desktop SSR list items", () => {
    const records = parseQidianDesktopHtml(DESKTOP_HTML, "sanjiang", "2026-06-22");
    expect(records).toEqual([expect.objectContaining({
      platform: "qidian",
      book_id: "1001",
      title: "剑来",
      author: "烽火戏诸侯",
      category: "玄幻",
      word_count: 1_234_000,
      source_status: "ok",
    })]);
  });

  it("detects WAF probe pages", () => {
    expect(looksLikeBlockPage("WAF拦截页面 probe.js")).toBe(true);
    expect(parseQidianDesktopHtml("WAF拦截页面", "sanjiang", "2026-06-22")).toEqual([]);
  });

  it("parses mobile vite pageContext JSON", () => {
    const records = parseQidianMobileHtml(MOBILE_HTML, "newbook", "2026-06-22");
    expect(records[0]).toMatchObject({ book_id: "2002", title: "夜的命名术", author: "会说话的肘子", category: "都市" });
  });

  it("falls back to mobile when desktop is blocked", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("www.qidian.com")) return new Response("WAF拦截页面 probe.js", { status: 200 });
      return new Response(MOBILE_HTML, { status: 200 });
    };
    const snapshot = await scrapeQidianRank("newbook", {
      fetchImpl,
      delay: async () => undefined,
      now: () => new Date("2026-06-22T00:00:00.000Z"),
      maxPages: 1,
    });
    expect(snapshot.records[0]?.title).toBe("夜的命名术");
    expect(snapshot.rank_type).toBe("newbook");
  });
});
