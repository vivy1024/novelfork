import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChapterTimelinePanel } from "./ChapterTimelinePanel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** 30 章真形数据：1–25 已结算，26–30 未结算；第 12 章摘要过期。 */
function thirtyChaptersPayload() {
  const chapters = Array.from({ length: 30 }, (_, index) => {
    const number = index + 1;
    return {
      number,
      title: `第${number}回`,
      chars: 2000 + number * 10,
      summary: number === 7 ? null : `第 ${number} 章的一句摘要`,
      summaryStale: number === 12,
      eventCount: number % 3,
      plantedHooks: number === 5 ? 2 : 0,
      recoveredHooks: number === 9 ? 1 : 0,
      cast: number === 3 ? [{ name: "林晚" }, { name: "陈默" }, { name: "薛行之" }, { name: "沈遥" }, { name: "阿九" }] : [{ name: "林晚" }],
      moreCast: number === 3 ? 3 : 0,
    };
  });
  return { chapters, settledThrough: 25 };
}

function installFetch(overrides?: { timeline?: (url: string) => { body: unknown; status?: number } | null }) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.includes("/narrative-memory/chapter-timeline")) {
      if (overrides?.timeline) {
        const out = overrides.timeline(url);
        if (out) return reply(out.body, out.status ?? 200);
      }
      return reply(thirtyChaptersPayload());
    }
    if (url.includes("/narrative-memory/list")) {
      return reply({
        entries: [
          { id: "ev-1", eventType: "conflict", subject: "林晚", predicate: "识破", object: "拍卖会的暗算", chapterNumber: 5 },
          { id: "ev-2", eventType: "reveal", subject: "锈剑", predicate: "露出", object: "另一半铭文", chapterNumber: 5 },
        ],
      });
    }
    return reply({ ok: true });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

describe("ChapterTimelinePanel 全书走势", () => {
  it("空数据：接口挂不上 → 空态说明 + 第一步，没有假行", async () => {
    installFetch({ timeline: () => ({ body: { error: "not implemented yet" }, status: 404 }) });
    render(<ChapterTimelinePanel bookId="book-1" />);

    await waitFor(() => expect(screen.getByTestId("chapter-timeline-empty")).toBeTruthy());
    expect(screen.getByTestId("chapter-timeline-empty").textContent).toContain("全书走势");
    expect(screen.queryAllByTestId("chapter-timeline-row")).toHaveLength(0);
  });

  it("接口返回空章列表 → 同样的空态", async () => {
    installFetch({ timeline: () => ({ body: { chapters: [], settledThrough: null } }) });
    render(<ChapterTimelinePanel bookId="book-1" />);

    await waitFor(() => expect(screen.getByTestId("chapter-timeline-empty")).toBeTruthy());
  });

  it("30 章渲染 30 行，未结算的 5 章带「未结算」标，过期摘要标「以正文为准」", async () => {
    installFetch();
    render(<ChapterTimelinePanel bookId="book-1" />);

    await waitFor(() => expect(screen.getAllByTestId("chapter-timeline-row")).toHaveLength(30));

    // 行内容：章号 · 章名 · 摘要 · 字数 · 伏笔账
    const row5 = screen.getByTestId("chapter-timeline-row-5");
    expect(row5.textContent).toContain("第 5 章");
    expect(row5.textContent).toContain("第5回");
    expect(row5.textContent).toContain("第 5 章的一句摘要");
    expect(row5.textContent).toContain("2050 字");
    expect(row5.textContent).toContain("新埋 2 / 回收 0");

    // 未结算的章：data-settled=false + 「未结算」文字标（不是彩色块）
    expect(screen.getByTestId("chapter-timeline-row-25").closest("li")!.getAttribute("data-settled")).toBe("true");
    expect(screen.getByTestId("chapter-timeline-row-26").closest("li")!.getAttribute("data-settled")).toBe("false");
    expect(screen.getAllByTestId("chapter-timeline-tag-unsettled")).toHaveLength(5);
    expect(screen.getByTestId("chapter-timeline-row-26").textContent).toContain("未结算");
    // 第 25 行已结算 → 行不带透明度降级，第 26 行带
    expect(screen.getByTestId("chapter-timeline-row-25").className).not.toContain("opacity-70");
    expect(screen.getByTestId("chapter-timeline-row-26").className).toContain("opacity-70");

    // 过期摘要只此一章
    expect(screen.getAllByTestId("chapter-timeline-tag-stale")).toHaveLength(1);
    expect(screen.getByTestId("chapter-timeline-row-12").textContent).toContain("以正文为准");
    // 无摘要
    expect(screen.getByTestId("chapter-summary-7").textContent).toContain("这一章还没有摘要");
    // 出场人物超过展示上限时给「等 N 人」
    expect(screen.getByTestId("chapter-timeline-row-3").textContent).toContain("等 8 人");
  });

  it("点一行展开：按章取叙事事件并列出", async () => {
    const { calls } = installFetch();
    render(<ChapterTimelinePanel bookId="book-1" />);

    await waitFor(() => screen.getByTestId("chapter-timeline-row-5"));
    fireEvent.click(screen.getByTestId("chapter-timeline-row-5"));

    await waitFor(() => {
      const listCalls = calls.filter((call) => call.url.includes("/narrative-memory/list"));
      expect(listCalls).toHaveLength(1);
      const url = listCalls[0]!.url;
      expect(url).toContain("kind=event");
      expect(url).toContain("chapterFrom=5");
      expect(url).toContain("chapterTo=5");
    });
    await waitFor(() => {
      const pane = screen.getByTestId("chapter-events-5");
      expect(pane.textContent).toContain("拍卖会的暗算");
      expect(pane.textContent).toContain("另一半铭文");
    });

    // 再点一次收起
    fireEvent.click(screen.getByTestId("chapter-timeline-row-5"));
    expect(screen.queryByTestId("chapter-events-5")).toBeNull();
  });

  it("事件明细取不回来时退回计数，不编数据", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : "x";
      if (url.includes("/narrative-memory/chapter-timeline")) {
        return new Response(JSON.stringify(thirtyChaptersPayload()), { headers: { "content-type": "application/json" } });
      }
      if (url.includes("/narrative-memory/list")) {
        return new Response("boom", { status: 500 });
      }
      return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ChapterTimelinePanel bookId="book-1" />);

    await waitFor(() => screen.getByTestId("chapter-timeline-row-5"));
    fireEvent.click(screen.getByTestId("chapter-timeline-row-5"));

    await waitFor(() => {
      expect(screen.getByTestId("chapter-events-error-5").textContent).toContain("本章记录 2 个事件");
    });
  });

  it("正在写的章带「在写」标", async () => {
    installFetch();
    render(<ChapterTimelinePanel bookId="book-1" currentChapter={28} />);

    await waitFor(() => expect(screen.getByTestId("chapter-timeline-row-28").textContent).toContain("在写"));
    expect(screen.getByTestId("chapter-timeline-row-1").textContent).not.toContain("在写");
  });
});
