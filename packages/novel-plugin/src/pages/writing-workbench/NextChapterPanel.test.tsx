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
      { id: "f1", entryId: "f1", title: "锈剑来历", status: "planted", plantedChapter: 1, chaptersPending: 11, urgency: "overdue", reason: "已悬置 11 章" },
      { id: "f2", entryId: "f2", title: "幕后主使", status: "planted", plantedChapter: 10, chaptersPending: 2, urgency: "watch", reason: "已悬置 2 章" },
    ],
    foreshadowThresholds: { watchChapters: 5, overdueChapters: 12 },
    entities: [],
    explanation: "",
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
    if (url.includes("category=current-focus")) {
      return reply({ entries: [{ fields: { goal: "让主线退一档", why: "拍卖前压住张力" } }] });
    }
    if (url.includes("category=foreshadowing")) {
      return reply({ entries: [{ id: "f1", fields: { status: "planted", plantedChapter: 1 } }, { id: "f2", fields: { status: "planted", plantedChapter: 10 } }] });
    }
    if (url.includes("/jingwei/entries/f1") && init?.method === "PUT") {
      return reply({ entry: { id: "f1" } });
    }
    if (url.endsWith("/jingwei/entries") && init?.method === "POST") {
      return reply({ entry: { id: "new-x" } });
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

describe("下一章整合页", () => {
  it("渲染焦点、建议、情节板与伏笔账本；建议含焦点点名线与停滞线", async () => {
    installFetch();
    render(<NextChapterPanel bookId={BOOK.id} />);

    await waitFor(() => expect(screen.getByTestId("next-focus-goal").textContent).toContain("让主线退一档"));
    expect(screen.getByTestId("next-suggestion-line").textContent).toContain("第 13 章");
    expect(screen.getByTestId("next-suggestion-line").textContent).toContain("主线「夺回师门」");
    expect(screen.getByTestId("next-suggestion-line").textContent).toContain("感情线「与沈遥」（已 10 章未推进）");
    // 情节板：两条剧情线的行 + 建议列
    const table = screen.getByTestId("next-board-table");
    expect(table.textContent).toContain("夺回师门");
    expect(table.textContent).toContain("与沈遥");
    expect(table.textContent).toContain("第 13 章（建议）");
    expect(table.textContent).toContain("守门人试炼");
    // 伏笔账本四段
    expect(screen.getByTestId("next-hook-overdue-f1").textContent).toContain("锈剑来历");
    expect(screen.getByTestId("next-hook-watch-f2").textContent).toContain("幕后主使");
  });

  it("「把建议发给叙述者」把后的章号与两条建议合成消息", async () => {
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

  it("没有剧情线：引导建线，按钮与建议不出现", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const emptyFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({ url, init });
      const reply = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
      if (url.includes("/narrative-structure")) return reply({ ok: true, ...structurePayload(), storylines: [], mounts: [], bookId: "book-1" });
      if (url.includes("category=current-focus")) return reply({ entries: [] });
      if (url.includes("category=foreshadowing")) return reply({ entries: [] });
      return reply({ ok: true });
    });
    vi.stubGlobal("fetch", emptyFetch);
    render(<NextChapterPanel bookId={BOOK.id} />);

    await waitFor(() => expect(screen.getByTestId("next-suggestion-empty").textContent).toContain("还没有剧情线"));
    expect(screen.queryByTestId("next-send-suggestion")).toBeNull();
  });
});
