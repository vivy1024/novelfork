import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NextChapterPanel } from "./NextChapterPanel";

function structurePayload() {
  return {
    bookId: "book-1",
    volumes: [],
    chapters: [
      { number: 10, title: "比试", status: "accepted", wordCount: 2100 },
      { number: 11, title: "识破暗算", status: "accepted", wordCount: 2300 },
      { number: 12, title: "旧站", status: "accepted", wordCount: 2400 },
    ],
    scenes: [
      { id: "s10", bookId: "book-1", chapterNumber: 10, ordinal: 1, title: "守门人试炼", summary: "", locationText: null, status: "confirmed", layer: "canon", source: "manual", canonStatus: "confirmed", canonSourceRef: null, conflictWith: [], provenance: {}, createdAt: "", updatedAt: "" },
      { id: "s2", bookId: "book-1", chapterNumber: 2, ordinal: 1, title: "雨夜初遇", summary: "", locationText: null, status: "confirmed", layer: "canon", source: "manual", canonStatus: "confirmed", canonSourceRef: null, conflictWith: [], provenance: {}, createdAt: "", updatedAt: "" },
    ],
    storylines: [
      { id: "main", bookId: "book-1", name: "夺回师门", kind: "main", lifecycle: "active", createdAt: "", updatedAt: "" },
      { id: "rom", bookId: "book-1", name: "与沈遥", kind: "romance", lifecycle: "active", createdAt: "", updatedAt: "" },
    ],
    mounts: [
      { id: "m1", sceneId: "s10", storylineId: "main", role: "primary", createdAt: "" },
      { id: "m2", sceneId: "s2", storylineId: "rom", role: "primary", createdAt: "" },
    ],
    foreshadows: [
      { id: "f1", entryId: "f1", title: "锈剑来历", status: "planted", plantedChapter: 1, chaptersPending: 11, urgency: "overdue", reason: "已悬置 11 章，作者曾承诺在拍卖会回收" },
      { id: "f2", entryId: "f2", title: "幕后主使", status: "planted", plantedChapter: 3, chaptersPending: 9, urgency: "overdue", reason: "已悬置 9 章" },
      { id: "f3", entryId: "f3", title: "丹方的下半页", status: "planted", plantedChapter: 5, chaptersPending: 7, urgency: "watch", reason: "已悬置 7 章" },
      { id: "f4", entryId: "f4", title: "不重要的支线悬念", status: "planted", plantedChapter: 9, chaptersPending: 3, urgency: "watch", reason: "已悬置 3 章" },
    ],
    foreshadowThresholds: { watchChapters: 5, overdueChapters: 12 },
    entities: [],
    explanation: "",
  };
}

function timelinePayload() {
  return {
    settledThrough: 12,
    chapters: [
      { number: 11, title: "识破暗算", chars: 2300, summary: "林晚识破拍卖会的暗算", summaryStale: false, eventCount: 2, plantedHooks: 0, recoveredHooks: 1, cast: [{ name: "林晚" }], moreCast: 0 },
      { number: 12, title: "旧站", chars: 2400, summary: "旧站夜谈", summaryStale: true, eventCount: 1, plantedHooks: 1, recoveredHooks: 0, cast: [{ name: "林晚" }], moreCast: 0 },
    ],
  };
}

function installFetch() {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.includes("/narrative-structure")) {
      return reply({ ok: true, ...structurePayload(), bookId: "book-1" });
    }
    if (url.includes("/narrative-memory/chapter-timeline")) {
      return reply(timelinePayload());
    }
    if (url.includes("category=current-focus")) {
      return reply({ entries: [{ fields: { goal: "让主线退一档", why: "拍卖前压住张力" } }] });
    }
    if (url.includes("category=foreshadowing")) {
      return reply({ entries: ["f1", "f2", "f3", "f4"].map((id) => ({ id, fields: { status: "planted" } })) });
    }
    if (url.includes("/jingwei/entries/f1") && init?.method === "PUT") {
      return reply({ entry: { id: "f1" } });
    }
    if (url.endsWith("/jingwei/entries") && init?.method === "POST") {
      return reply({ entry: { id: "new-x" } });
    }
    if (url.includes("/narrative-memory/list")) {
      return reply({ entries: [] });
    }
    return reply({ ok: true });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

const BOOK = { id: "book-1" };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("下一章默认页（全书走势 + 下一章双栏）", () => {
  it("双栏：左栏全书走势、右栏下一章（焦点 + 建议 + 伏笔账本）", async () => {
    installFetch();
    render(<NextChapterPanel bookId={BOOK.id} />);

    await waitFor(() => expect(screen.getByTestId("next-focus-goal").textContent).toContain("让主线退一档"));
    // 左栏走势行
    await waitFor(() => expect(screen.getByTestId("chapter-timeline-row-11").textContent).toContain("识破拍卖会的暗算"));
    expect(screen.getByTestId("chapter-timeline-row-12").textContent).toContain("以正文为准");
    // 右栏建议
    expect(screen.getByTestId("next-suggestion-line").textContent).toContain("第 13 章");
    expect(screen.getByTestId("next-suggestion-line").textContent).toContain("主线「夺回师门」");
    expect(screen.getByTestId("next-suggestion-line").textContent).toContain("感情线「与沈遥」（已 10 章未推进）");
  });

  it("「去写」是走势页唯一出口：进写作视图，而不是跳一个不存在的章文件", async () => {
    const onOpenWriteView = vi.fn();
    installFetch();
    render(<NextChapterPanel bookId={BOOK.id} onOpenWriteView={onOpenWriteView} />);

    const button = await waitFor(() => screen.getByTestId("next-open-write-view"));
    fireEvent.click(button);
    expect(onOpenWriteView).toHaveBeenCalledTimes(1);
  });

  it("宿主没接写作视图入口时不显示「去写」（不给死按钮）", async () => {
    installFetch();
    render(<NextChapterPanel bookId={BOOK.id} />);

    await waitFor(() => screen.getByTestId("next-chapter-side"));
    expect(screen.queryByTestId("next-open-write-view")).toBeNull();
  });

  it("伏笔账本：文字标签 + 色点 + 标题，按紧迫度排序，默认只展开最急 3 条", async () => {
    installFetch();
    render(<NextChapterPanel bookId={BOOK.id} />);

    await waitFor(() => screen.getByTestId("next-hook-item-f1"));

    const rendered = screen.getByTestId("next-hook-list").textContent ?? "";
    // 排序：超期按悬置章数降序 f1(11) → f2(9) → 临近 f3(7)；第 4 条 f4 收起
    expect(rendered.indexOf("锈剑来历")).toBeLessThan(rendered.indexOf("幕后主使"));
    expect(rendered.indexOf("幕后主使")).toBeLessThan(rendered.indexOf("丹方的下半页"));
    expect(rendered.indexOf("不重要的支线悬念")).toBe(-1);
    // 标签是文字 + 色点，没有 urgency 态的彩色块
    const item = screen.getByTestId("next-hook-item-f1");
    expect(screen.getByTestId("next-hook-dot-f1")).toBeTruthy();
    expect(item.className).not.toMatch(/bg-red|bg-amber|bg-emerald/);
    expect(item.textContent).toContain("超期");
    expect(item.textContent).toContain("已悬置 11 章");

    // 「展开其余」后第 4 条出现
    fireEvent.click(screen.getByTestId("next-hook-toggle-rest"));
    expect(screen.getByTestId("next-hook-item-f4").textContent).toContain("不重要的支线悬念");
    expect(screen.getByTestId("next-hook-item-f4").textContent).toContain("临近");
  });

  it("「把建议发给叙述者」把章号与两条建议合成消息", async () => {
    installFetch();
    const onSendToNarrator = vi.fn(async () => undefined);
    render(<NextChapterPanel bookId={BOOK.id} onSendToNarrator={onSendToNarrator} />);

    await waitFor(() => screen.getByTestId("next-send-suggestion"));
    fireEvent.click(screen.getByTestId("next-send-suggestion"));

    await waitFor(() => expect(onSendToNarrator).toHaveBeenCalledTimes(1));
    const message = onSendToNarrator.mock.calls[0]![0] as string;
    expect(message).toContain("第 13 章");
    expect(message).toContain("主线「夺回师门」");
    expect(message).toContain("感情线「与沈遥」");
    expect(message).toContain("锈剑来历");
  });

  it("「排进下一章」把伏笔以任务形式发给叙述者", async () => {
    installFetch();
    const onSendToNarrator = vi.fn(async () => undefined);
    render(<NextChapterPanel bookId={BOOK.id} onSendToNarrator={onSendToNarrator} />);

    await waitFor(() => screen.getByTestId("next-hook-schedule-f1"));
    fireEvent.click(screen.getByTestId("next-hook-schedule-f1"));

    await waitFor(() => expect(onSendToNarrator).toHaveBeenCalledTimes(1));
    const message = onSendToNarrator.mock.calls[0]![0] as string;
    expect(message).toContain("锈剑来历");
    expect(message).toContain("第 13 章的写作计划");
    expect(message).toContain("已悬置 11 章");
  });

  it("「标记已回收」走 PUT fieldsPatch，不整包改数据", async () => {
    const { calls } = installFetch();
    render(<NextChapterPanel bookId={BOOK.id} />);

    await waitFor(() => screen.getByTestId("next-hook-paidoff-f1"));
    fireEvent.click(screen.getByTestId("next-hook-paidoff-f1"));

    await waitFor(() => {
      const puts = calls.filter((c) => c.init?.method === "PUT" && c.url.includes("/jingwei/entries/f1"));
      expect(puts).toHaveLength(1);
      const body = JSON.parse(puts[0]!.init!.body as string);
      expect(body).toEqual({ fieldsPatch: { status: "paid_off", payoffChapter: 12 } });
    });
    await waitFor(() => expect(screen.getByTestId("next-hook-note").textContent).toContain("已按第 12 章标记为已回收"));
  });

  it("埋点：POST 新 needs-review 伏笔条目", async () => {
    const { calls } = installFetch();
    render(<NextChapterPanel bookId={BOOK.id} />);

    await waitFor(() => screen.getByTestId("next-hook-plant-toggle"));
    fireEvent.click(screen.getByTestId("next-hook-plant-toggle"));
    fireEvent.change(screen.getByTestId("next-hook-plant-title"), { target: { value: "拍卖会上的科学丹方" } });
    fireEvent.click(screen.getByTestId("next-hook-plant-confirm"));

    await waitFor(() => {
      const posts = calls.filter((c) => c.init?.method === "POST" && c.url.endsWith("/jingwei/entries"));
      expect(posts).toHaveLength(1);
      const body = JSON.parse(posts[0]!.init!.body as string);
      expect(body.category).toBe("foreshadowing");
      expect(body.status).toBe("needs-review");
      expect(body.fields).toMatchObject({ status: "planted", plantedChapter: 13 });
    });
    await waitFor(() => expect(screen.getByTestId("next-hook-note").textContent).toContain("待你确认后开始倒计时"));
  });

  it("有剧情线：给推进板 / 因果树入口，点击透传意图", async () => {
    installFetch();
    const onOpenBoardProgress = vi.fn();
    const onOpenCausalTree = vi.fn();
    render(<NextChapterPanel bookId={BOOK.id} onOpenBoardProgress={onOpenBoardProgress} onOpenCausalTree={onOpenCausalTree} />);

    await waitFor(() => screen.getByTestId("next-view-links"));
    expect(screen.queryByTestId("next-storyline-empty")).toBeNull();
    fireEvent.click(screen.getByTestId("next-link-board"));
    expect(onOpenBoardProgress).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("next-link-causal"));
    expect(onOpenCausalTree).toHaveBeenCalledTimes(1);
  });

  it("剧情线为 0：引导卡取代空建议，按钮把「归纳剧情线」意图发给叙述者，且不给视图死链", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const emptyFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({ url, init });
      const reply = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
      if (url.includes("/narrative-structure")) return reply({ ok: true, ...structurePayload(), storylines: [], mounts: [], foreshadows: [], bookId: "book-1" });
      if (url.includes("/narrative-memory/chapter-timeline")) return reply(timelinePayload());
      if (url.includes("category=current-focus")) return reply({ entries: [] });
      if (url.includes("category=foreshadowing")) return reply({ entries: [] });
      return reply({ ok: true });
    });
    vi.stubGlobal("fetch", emptyFetch);
    const onSendToNarrator = vi.fn(async () => undefined);
    render(<NextChapterPanel bookId={BOOK.id} onSendToNarrator={onSendToNarrator} />);

    await waitFor(() => expect(screen.getByTestId("next-storyline-empty").textContent).toContain("这本书还没有剧情线"));
    // 引导文案说清它会干什么：读已结算事件 → 归纳草稿 → 在待确认里逐条定
    expect(screen.getByTestId("next-storyline-empty").textContent).toContain("归纳剧情线草稿");
    expect(screen.getByTestId("next-storyline-empty").textContent).toContain("待确认");
    // 空壳建议 / 死链均不出现
    expect(screen.queryByTestId("next-suggestion-line")).toBeNull();
    expect(screen.queryByTestId("next-send-suggestion")).toBeNull();
    expect(screen.queryByTestId("next-link-board")).toBeNull();
    expect(screen.queryByTestId("next-link-causal")).toBeNull();

    fireEvent.click(screen.getByTestId("next-storyline-induce"));
    await waitFor(() => expect(onSendToNarrator).toHaveBeenCalledTimes(1));
    const message = onSendToNarrator.mock.calls[0]![0] as string;
    expect(message).toContain("已结算");
    expect(message).toContain("归纳剧情线");
    expect(message).toContain("needs-review");
    expect(message).toContain("待确认");
  });

  it("剧情线为 0 且没接叙述者通道：按钮置灰并说明，不假装能发", async () => {
    const emptyFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : "x";
      const reply = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
      if (url.includes("/narrative-structure")) return reply({ ok: true, ...structurePayload(), storylines: [], mounts: [], foreshadows: [], bookId: "book-1" });
      if (url.includes("/narrative-memory/chapter-timeline")) return reply(timelinePayload());
      if (url.includes("category=")) return reply({ entries: [] });
      return reply({ ok: true });
    });
    vi.stubGlobal("fetch", emptyFetch);
    render(<NextChapterPanel bookId={BOOK.id} />);

    await waitFor(() => screen.getByTestId("next-storyline-induce"));
    expect((screen.getByTestId("next-storyline-induce") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("next-storyline-empty").textContent).toContain("没接叙述者通道");
  });
});
