import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isChapterSettled,
  normalizeChapterTimeline,
  timelineAnchorChapter,
  useChapterEvents,
  useChapterTimeline,
} from "./use-chapter-timeline";

afterEach(() => {
  vi.unstubAllGlobals();
});

function timelinePayload() {
  return {
    settledThrough: 3,
    chapters: [
      { number: 1, title: "起局", chars: 3000, summary: "林晚拾起锈剑", summaryStale: false, eventCount: 2, plantedHooks: 1, recoveredHooks: 0, cast: [{ name: "林晚" }, { name: "陈默", entryId: "e-2" }], moreCast: 0 },
      { number: 2, title: "旧站", chars: 2400, summary: null, summaryStale: false, eventCount: 0, plantedHooks: 0, recoveredHooks: 0, cast: [], moreCast: 0 },
      { number: 3, title: "拍卖", chars: 2600, summary: "拍走丹方", summaryStale: true, eventCount: 3, plantedHooks: 0, recoveredHooks: 1, cast: [{ name: "薛行之" }], moreCast: 2 },
      { number: 4, title: "夜谈", chars: 500, summary: "草稿章", summaryStale: false, eventCount: 0, plantedHooks: 0, recoveredHooks: 0, cast: [], moreCast: 0, volume: "第二卷" },
    ],
  };
}

describe("normalizeChapterTimeline", () => {
  it("按契约解析：排序、脏字段剔除、摘要空串归 null", () => {
    const timeline = normalizeChapterTimeline(timelinePayload());
    expect(timeline).not.toBeNull();
    expect(timeline!.settledThrough).toBe(3);
    expect(timeline!.chapters.map((chapter) => chapter.number)).toEqual([1, 2, 3, 4]);
    expect(timeline!.chapters[1]!.summary).toBeNull();
    expect(timeline!.chapters[2]!.summaryStale).toBe(true);
    expect(timeline!.chapters[2]!.cast[0]).toEqual({ name: "薛行之" });
    expect(timeline!.chapters[0]!.cast[1]).toEqual({ name: "陈默", entryId: "e-2" });
  });

  it("容忍包一层 ok / 章乱序 / 非法行，结构整体不符返回 null", () => {
    const wrapped = normalizeChapterTimeline({ ok: true, ...timelinePayload(), chapters: [...timelinePayload().chapters].reverse() });
    expect(wrapped!.chapters[0]!.number).toBe(1);

    expect(normalizeChapterTimeline(null)).toBeNull();
    expect(normalizeChapterTimeline("not an object")).toBeNull();
    expect(normalizeChapterTimeline({ settledThrough: 2 })).toBeNull();

    const withJunk = normalizeChapterTimeline({
      settledThrough: -3,
      chapters: [{ number: "x", title: "坏行" }, { number: 5, chars: -2, eventCount: Number.NaN, cast: [{ name: "" }, "junk"] }],
    });
    expect(withJunk!.settledThrough).toBeNull();
    expect(withJunk!.chapters).toHaveLength(1);
    expect(withJunk!.chapters[0]!.chars).toBe(0);
    expect(withJunk!.chapters[0]!.cast).toHaveLength(0);
  });
});

describe("isChapterSettled / timelineAnchorChapter", () => {
  it("settledThrough 以内的章结算，以外（含更新章）未结算", () => {
    const timeline = normalizeChapterTimeline(timelinePayload())!;
    expect(isChapterSettled(timeline, 1)).toBe(true);
    expect(isChapterSettled(timeline, 3)).toBe(true);
    expect(isChapterSettled(timeline, 4)).toBe(false);
  });

  it("settledThrough 为 null 时没有任何章算已结算；锚点落在最后一章", () => {
    const timeline = normalizeChapterTimeline({ settledThrough: null, chapters: [{ number: 7 }] })!;
    expect(isChapterSettled(timeline, 7)).toBe(false);
    expect(timelineAnchorChapter(timeline)).toBe(7);
    expect(timelineAnchorChapter(normalizeChapterTimeline(timelinePayload())!)).toBe(3);
    expect(timelineAnchorChapter(normalizeChapterTimeline({ settledThrough: null, chapters: [] })!)).toBeNull();
  });
});

describe("useChapterTimeline", () => {
  function stubTimelineFetch(body: unknown, status = 200) {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchImpl);
    return fetchImpl;
  }

  it("ready：拉 chapter-timeline 并解析", async () => {
    const fetchImpl = stubTimelineFetch(timelinePayload());
    const { result } = renderHook(() => useChapterTimeline("book-1"));

    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    expect(fetchImpl.mock.calls[0]![0]).toContain("/api/books/book-1/narrative-memory/chapter-timeline");
    if (result.current.state.status === "ready") {
      expect(result.current.state.data.settledThrough).toBe(3);
      expect(result.current.state.data.chapters).toHaveLength(4);
    }
  });

  it("接口挂不上 → error；结构不符也 error，不留半成品数据", async () => {
    stubTimelineFetch({ error: "not found" }, 404);
    const first = renderHook(() => useChapterTimeline("book-1"));
    await waitFor(() => expect(first.result.current.state.status).toBe("error"));

    stubTimelineFetch({ somethingElse: true }, 200);
    const second = renderHook(() => useChapterTimeline("book-2"));
    await waitFor(() => expect(second.result.current.state.status).toBe("error"));
  });

  it("reload 触发重新拉取", async () => {
    const fetchImpl = stubTimelineFetch(timelinePayload());
    const { result } = renderHook(() => useChapterTimeline("book-1"));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    result.current.reload();
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
  });
});

describe("useChapterEvents", () => {
  it("用 narrative-memory/list 按章过滤已应用事件", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      entries: [
        { id: "ev-1", eventType: "conflict", subject: "林晚", predicate: "识破", object: "暗算", chapterNumber: 3 },
        { id: "ev-2", eventType: "reveal", subject: "锈剑", chapterNumber: 3 },
      ],
    }), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchImpl);
    const { result } = renderHook(() => useChapterEvents("book-1", 3));

    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    const url = String(fetchImpl.mock.calls[0]![0]);
    expect(url).toContain("kind=event");
    expect(url).toContain("status=applied");
    expect(url).toContain("chapterFrom=3");
    expect(url).toContain("chapterTo=3");
    if (result.current.state.status === "ready") {
      expect(result.current.state.events).toHaveLength(2);
      expect(result.current.state.events[0]!.object).toBe("暗算");
      expect(result.current.state.events[1]!.predicate).toBe("");
    }
  });

  it("chapterNumber 为 null 不发请求；失败 → error", async () => {
    const fetchImpl = vi.fn(async () => new Response("boom", { status: 500 }));
    vi.stubGlobal("fetch", fetchImpl);
    const first = renderHook(() => useChapterEvents("book-1", null));
    expect(fetchImpl).not.toHaveBeenCalled();

    const second = renderHook(() => useChapterEvents("book-1", 2));
    await waitFor(() => expect(second.result.current.state.status).toBe("error"));
    expect(first.result.current.state.status).toBe("loading");
  });
});
