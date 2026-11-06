import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StoryTimeAxisPanel } from "./StoryTimeAxisPanel";
import { normalizeStoryTimeline } from "./use-story-timeline";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const payload = {
  ok: true,
  points: [
    { anchorId: "a1", chapterNumber: 3, kind: "absolute", expression: "天元三年春", evidenceText: "天元三年春", storyDay: 0, calendarLabel: "天元3年1月1日前后", derivation: "第3章「天元三年春」是全书第一个时间说法，记为起点。", confidence: 0.9 },
    { anchorId: "a2", chapterNumber: 5, kind: "relative", expression: "三天后", evidenceText: "三天后", storyDay: 3, derivation: "第5章「三天后」：起点 + 3 日。", confidence: 0.4 },
  ],
  promises: [{ anchorId: "p1", chapterNumber: 4, event: "决战", expression: "三日后决战", evidenceText: "三日后决战", madeOnDay: 0, dueDay: 3, daysLeft: -2, confidence: 0.9 }],
  conflicts: [{
    kind: "time-age-mismatch", severity: "warning", chapterNumber: 5, entity: "韩立", anchorId: "a3", title: "韩立的年龄对不上", detail: "x", evidenceText: "二十岁的韩立", otherChapter: 3,
    explanation: { whatHappened: "第5章说韩立20岁，和第3章的16岁对不上。", whyItMatters: "年龄是硬数字。", suggestedAction: "核对两处的年龄。" },
  }],
  currentLabel: "天元3年1月4日前后",
  currentChapter: 5,
  summary: "已记下 2 处时间说法。",
};

describe("StoryTimeAxisPanel 故事时间轴", () => {
  it("显示当前时间、矛盾（转述后端解释）、约定与带推算过程的时间点", async () => {
    const fetchMock = stubFetch(payload);
    render(<StoryTimeAxisPanel bookId="book-1" />);
    await waitFor(() => expect(screen.getByTestId("story-time-current").textContent).toContain("天元3年1月4日前后"));
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/books/book-1/narrative-memory/story-timeline");
    const conflict = screen.getByTestId("story-time-conflict");
    expect(within(conflict).getByText("韩立的年龄对不上")).toBeTruthy();
    expect(within(conflict).getByText("核对两处的年龄。")).toBeTruthy();
    expect(within(conflict).getByText("待你确认")).toBeTruthy();
    expect(screen.getByTestId("story-time-promise").textContent).toContain("已过 2 日");
    const points = screen.getAllByTestId("story-time-point");
    expect(points).toHaveLength(2);
    expect(points[1]!.textContent).toContain("故事第 4 日");
    expect(points[1]!.textContent).toContain("起点 + 3 日");
    expect(points[1]!.textContent).toContain("存疑");
  });

  it("没有任何时间说法 → 说明结算后会出现，不补假数据", async () => {
    stubFetch({ ok: true, points: [], promises: [], conflicts: [], summary: "" });
    render(<StoryTimeAxisPanel bookId="book-1" />);
    await waitFor(() => expect(screen.getByTestId("story-time-empty").textContent).toContain("结算章节时会从正文读出"));
  });

  it("接口出错 → 错误态带重试", async () => {
    stubFetch({ error: "boom" }, 500);
    render(<StoryTimeAxisPanel bookId="book-1" />);
    await waitFor(() => expect(screen.getByTestId("story-time-retry")).toBeTruthy());
  });

  it("结构不符返回 null，脏行剔除", () => {
    expect(normalizeStoryTimeline({ points: [] })).toBeNull();
    const view = normalizeStoryTimeline({ points: [{ chapterNumber: "x" }, payload.points[0]], promises: [], conflicts: [{ chapterNumber: 1 }] });
    expect(view?.points).toHaveLength(1);
    expect(view?.conflicts).toHaveLength(0);
  });
});
