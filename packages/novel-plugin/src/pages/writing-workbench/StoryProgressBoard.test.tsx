import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchJson = vi.fn();

vi.mock("@/hooks/use-api", () => ({
  fetchJson: (...args: unknown[]) => fetchJson(...args),
  ApiRequestError: class ApiRequestError extends Error {
    status?: number;
    constructor(message: string, status?: number) {
      super(message);
      this.status = status;
    }
  },
}));

import { StoryProgressBoard } from "./StoryProgressBoard";

interface RouteFixture {
  readonly summaries?: unknown[];
  readonly foreshadowing?: unknown[];
  readonly conflicts?: unknown[];
  readonly events?: unknown[];
  readonly failCategories?: readonly string[];
  readonly failGraph?: boolean;
}

function mockRoutes(fixture: RouteFixture) {
  fetchJson.mockImplementation(async (url: string) => {
    if (url.includes("narrative-memory/graph")) {
      if (fixture.failGraph) throw new Error("graph down");
      return { events: fixture.events ?? [] };
    }
    if (url.includes("narrative-memory/structure-score")) {
      return { scores: [] };
    }
    const match = /category=([^&]+)/.exec(url);
    const category = match ? decodeURIComponent(match[1]!) : "";
    if (fixture.failCategories?.includes(category)) throw new Error(`${category} down`);
    if (category === "chapter-summaries") return { entries: fixture.summaries ?? [] };
    if (category === "foreshadowing") return { entries: fixture.foreshadowing ?? [] };
    if (category === "conflicts") return { entries: fixture.conflicts ?? [] };
    return { entries: [] };
  });
}

const summaries = [
  { id: "s1", category: "chapter-summaries", title: "第 1 章 归档", contentMd: "薛行之接手异常波形，把卷宗压进抽屉。", fields: { chapterNumber: 1, tension_score: 6 } },
  { id: "s2", category: "chapter-summaries", title: "第 2 章 追查", contentMd: "方工夜里来访，要求复查西京分院。", fields: { chapterNumber: 2, tension_score: 9 } },
];

beforeEach(() => {
  fetchJson.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("StoryProgressBoard 故事推进章节网格", () => {
  it("渲染网格、章节列与剧情线行头", async () => {
    mockRoutes({ summaries, currentChapter: 2 } as RouteFixture);
    render(<StoryProgressBoard bookId="book-1" currentChapter={2} />);

    await waitFor(() => expect(screen.getByTestId("story-progress-board")).toBeTruthy());
    expect(screen.getByTestId("story-progress-chapter-1")).toBeTruthy();
    expect(screen.getByTestId("story-progress-lane-lane:main")).toBeTruthy();
    expect(screen.getByTestId("story-progress-cell-summary-main:s1").textContent).toContain("薛行之接手异常波形");
    // 未来列存在且标为待写
    expect(screen.getByTestId("story-progress-chapter-3").textContent).toContain("待写");
  });

  it("焦点列指向下一章，并列出该收的债与断档线", async () => {
    mockRoutes({
      summaries,
      foreshadowing: [
        { id: "f1", category: "foreshadowing", lifecycle: "active", title: "B-17异常波形", fields: { status: "planted", plantedChapter: 1 } },
      ],
      events: [{ chapterNumber: 1, eventType: "character_state_changed", subject: "薛行之", evidenceText: "接手异常" }],
    });
    render(<StoryProgressBoard bookId="book-1" currentChapter={20} />);

    const focus = await waitFor(() => screen.getByTestId("story-progress-focus"));
    expect(focus.textContent).toContain("第 21 章");
    expect(focus.textContent).toContain("B-17异常波形");
    expect(focus.textContent).toContain("已悬 19 章未回收");
    // 薛行之最后一次推进在第 1 章，距今 19 章 → 断档
    expect(focus.textContent).toContain("薛行之");
  });

  it("「去写」跳转下一章；「让叙述者规划」把上下文交给叙述者", async () => {
    const onOpenChapter = vi.fn();
    const onSendToNarrator = vi.fn();
    mockRoutes({
      summaries,
      foreshadowing: [
        { id: "f1", category: "foreshadowing", lifecycle: "active", title: "旧账", fields: { status: "planted", plantedChapter: 1 } },
      ],
    });
    render(
      <StoryProgressBoard
        bookId="book-1"
        currentChapter={10}
        onOpenChapter={onOpenChapter}
        onSendToNarrator={onSendToNarrator}
      />,
    );

    fireEvent.click(await waitFor(() => screen.getByTestId("story-progress-focus-open")));
    expect(onOpenChapter).toHaveBeenCalledWith(11);

    fireEvent.click(screen.getByTestId("story-progress-focus-plan"));
    expect(onSendToNarrator).toHaveBeenCalledTimes(1);
    const prompt = String(onSendToNarrator.mock.calls[0]![0]);
    expect(prompt).toContain("第 11 章");
    expect(prompt).toContain("旧账");
  });

  it("伏笔债务行按超期排序并可展开全部", async () => {
    const many = Array.from({ length: 9 }, (_, index) => ({
      id: `f${index}`,
      category: "foreshadowing",
      lifecycle: "active",
      title: `伏笔${index}`,
      fields: { status: "planted", plantedChapter: index + 1 },
    }));
    mockRoutes({ summaries, foreshadowing: many });
    render(<StoryProgressBoard bookId="book-1" currentChapter={30} />);

    const ledger = await waitFor(() => screen.getByTestId("story-progress-debts"));
    expect(ledger.textContent).toContain("未回收 9");
    // 默认只显示前 6 条
    expect(screen.getByTestId("story-progress-debt-f0")).toBeTruthy();
    expect(screen.queryByTestId("story-progress-debt-f8")).toBeNull();

    fireEvent.click(screen.getByTestId("story-progress-debts-toggle"));
    expect(screen.getByTestId("story-progress-debt-f8")).toBeTruthy();
  });

  it("点击债务的查看按钮打开经纬条目", async () => {
    const onOpenEntityDetail = vi.fn();
    mockRoutes({
      summaries,
      foreshadowing: [
        { id: "f1", category: "foreshadowing", lifecycle: "active", title: "旧账", fields: { status: "planted", plantedChapter: 1 } },
      ],
    });
    render(<StoryProgressBoard bookId="book-1" currentChapter={20} onOpenEntityDetail={onOpenEntityDetail} />);

    fireEvent.click(await waitFor(() => screen.getByTestId("story-progress-debt-open-f1")));
    expect(onOpenEntityDetail).toHaveBeenCalledWith("旧账", "f1");
  });

  it("完全没有章节数据时空态说明要先写/结算，不错误归因到拆书", async () => {
    mockRoutes({});
    render(<StoryProgressBoard bookId="book-1" />);

    const empty = await waitFor(() => screen.getByTestId("story-progress-empty"));
    expect(empty.textContent).toContain("还没有章节数据");
    expect(empty.textContent).toContain("章后结算");
  });

  it("有章摘要但缺伏笔/冲突时，空态点名缺哪一类", async () => {
    mockRoutes({ summaries });
    render(<StoryProgressBoard bookId="book-1" currentChapter={2} />);

    // 只有主线有节拍时仍算有内容，网格照画；这里验证退化提示走的是网格而非空态
    await waitFor(() => expect(screen.getByTestId("story-progress-board")).toBeTruthy());
    expect(screen.queryByTestId("story-progress-empty")).toBeNull();
  });

  it("单条链路失败只降级提示，不整页报错", async () => {
    mockRoutes({ summaries, failCategories: ["foreshadowing"] });
    render(<StoryProgressBoard bookId="book-1" currentChapter={2} />);

    const notice = await waitFor(() => screen.getByTestId("story-progress-degraded"));
    expect(notice.textContent).toContain("伏笔");
    expect(screen.getByTestId("story-progress-board")).toBeTruthy();
  });

  it("四条链路全失败才进错误态并给重试", async () => {
    mockRoutes({
      failCategories: ["chapter-summaries", "foreshadowing", "conflicts"],
      failGraph: true,
    });
    render(<StoryProgressBoard bookId="book-1" />);

    const error = await waitFor(() => screen.getByTestId("story-progress-error"));
    expect(error.textContent).toContain("读取失败");
  });

  it("张力分缺失时曲线诚实说明，不画假曲线", async () => {
    mockRoutes({
      summaries: [{ id: "s1", category: "chapter-summaries", title: "第 1 章", fields: { chapterNumber: 1 } }],
    });
    render(<StoryProgressBoard bookId="book-1" currentChapter={1} />);

    const strip = await waitFor(() => screen.getByTestId("tension-curve-strip"));
    expect(strip.textContent).toContain("还没有章节评过张力");
    expect(screen.getByTestId("tension-curve-strip-empty")).toBeTruthy();
  });

  it("有张力分时画出曲线与当前章标记", async () => {
    mockRoutes({ summaries });
    render(<StoryProgressBoard bookId="book-1" currentChapter={2} />);

    await waitFor(() => expect(screen.getByTestId("tension-curve-strip")).toBeTruthy());
    expect(screen.getByTestId("tension-curve-strip-current")).toBeTruthy();
    expect(screen.queryByTestId("tension-curve-strip-empty")).toBeNull();
  });

  it("优先走 /narrative-structure 单次快照：仅发起 1 次请求，渲染真剧情线网格", async () => {
    fetchJson.mockImplementation(async (url: string) => {
      if (url.includes("/narrative-structure")) {
        return {
          ok: true,
          bookId: "book-single",
          currentChapter: 2,
          volumes: [],
          chapters: [
            { number: 1, title: "雨夜", status: "accepted", wordCount: 2000 },
            { number: 2, title: "旧站台", status: "accepted", wordCount: 3000 },
          ],
          scenes: [
            { id: "sc-1", bookId: "book-single", chapterNumber: 1, ordinal: 1, title: "夜宴", summary: "首战", function: "advance", status: "confirmed" },
          ],
          storylines: [
            { id: "line-1", bookId: "book-single", name: "主线：崛起", kind: "main", lifecycle: "active", goal: "", status: "confirmed" },
          ],
          mounts: [
            { sceneId: "sc-1", storylineId: "line-1", role: "primary", createdAt: 1000 },
          ],
          foreshadows: [
            { id: "debt:fs-1", title: "停摆的钟", entryId: "fs-1", plantedChapter: 1, status: "planted", chaptersPending: 1, urgency: "watch", reason: "埋于第 1 章，已悬 1 章未回收" },
          ],
          entities: [],
        };
      }
      throw new Error("unexpected legacy call");
    });

    render(<StoryProgressBoard bookId="book-single" currentChapter={2} />);

    await waitFor(() => expect(screen.getByTestId("story-progress-board")).toBeTruthy());
    expect(screen.getByTestId("story-progress-lane-line-1")).toBeTruthy();
    expect(screen.getByText("主线：崛起")).toBeTruthy();
    // 回归：快照里的章名与伏笔债务此前被丢掉——列头成了「第 1 章 / 第 1 章」，账本显示没有伏笔。
    expect(screen.getByTestId("story-progress-chapter-1").textContent).toContain("雨夜");
    expect(screen.getByTestId("story-progress-debt-fs-1")).toBeTruthy();
    expect(screen.queryByTestId("story-progress-debts-empty")).toBeNull();
    // 有真剧情线、又没有任何章摘要时，不画一行空壳「章节摘要 (自动归类)」
    expect(screen.queryByText("章节摘要 (自动归类)")).toBeNull();
    // 验证确实只发起了对 /narrative-structure 的 1 次请求，未发起任何分路请求
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(fetchJson.mock.calls[0][0]).toContain("/api/books/book-single/narrative-structure");
  });

  it("行头点击新建剧情线，提交后发起 POST 并触发刷新 (Task A7)", async () => {
    mockRoutes({ summaries });
    render(<StoryProgressBoard bookId="book-1" currentChapter={2} />);

    await waitFor(() => expect(screen.getByTestId("story-progress-board")).toBeTruthy());
    const addBtn = screen.getByTestId("story-progress-add-storyline-btn");
    expect(addBtn).toBeTruthy();

    // 点击打开表单
    fireEvent.click(addBtn);
    expect(screen.getByTestId("story-progress-create-storyline-form")).toBeTruthy();

    const input = screen.getByTestId("story-progress-storyline-name-input");
    fireEvent.change(input, { target: { value: "宗门暗斗线" } });

    fetchJson.mockImplementation(async (url: string, opts?: any) => {
      if (url.includes("/narrative-memory/storylines") && opts?.method === "POST") {
        return { ok: true, data: { id: "line-new" } };
      }
      return { entries: [] };
    });

    const submitBtn = screen.getByTestId("story-progress-storyline-submit-btn");
    fireEvent.click(submitBtn);

    await waitFor(() => {
      const calls = fetchJson.mock.calls;
      const postCall = calls.find((c: any) => c[0].includes("/narrative-memory/storylines"));
      expect(postCall).toBeTruthy();
      expect(JSON.parse(postCall[1].body)).toMatchObject({ name: "宗门暗斗线", kind: "main" });
    });
  });
});
