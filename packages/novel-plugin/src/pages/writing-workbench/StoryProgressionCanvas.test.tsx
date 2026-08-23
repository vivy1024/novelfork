import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-api", () => ({
  fetchJson: vi.fn(),
}));

vi.mock("./JingweiEntryEditor", () => ({
  JingweiEntryEditor: ({ entry }: { entry: { id: string; title: string } }) => (
    <div data-testid="mock-jingwei-editor">编辑器:{entry.title}</div>
  ),
}));

vi.mock("./StoryMapCanvas", () => ({
  StoryMapCanvas: ({ bookId }: { bookId: string }) => (
    <div data-testid="mock-story-map">{bookId}</div>
  ),
}));

vi.mock("./development-timeline", () => ({
  DevelopmentTimelineView: ({
    bookId,
    currentChapter,
    frameClassName,
    initialFocusEntity,
  }: {
    bookId: string;
    currentChapter?: number;
    frameClassName?: string;
    initialFocusEntity?: string;
  }) => (
    <div
      data-testid="mock-development-timeline"
      data-book={bookId}
      data-chapter={currentChapter ?? ""}
      data-frame={frameClassName ?? ""}
      data-focus={initialFocusEntity ?? ""}
    />
  ),
}));

import { fetchJson } from "@/hooks/use-api";
import { StoryProgressionCanvas } from "./StoryProgressionCanvas";

const fetchJsonMock = vi.mocked(fetchJson);

function outlineRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "o1",
    title: "第一卷 灵潮初起",
    content_md: "主角在边城觉醒。",
    category: "outline",
    fields: { volumeNumber: 1, goal: "主角觉醒" },
    ...overrides,
  };
}

beforeEach(() => {
  fetchJsonMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("StoryProgressionCanvas 故事推进大屏画布", () => {
  it("默认打开大纲总览：加载并过滤出 outline 条目，点击条目挂载全屏编辑器", async () => {
    fetchJsonMock.mockResolvedValue([
      outlineRow(),
      outlineRow({ id: "o2", title: "第二卷 宗门风云", fields: { volumeNumber: 2 }, content_md: "" }),
      outlineRow({ id: "c1", title: "薛行之", category: "character" }),
    ]);
    const onOpenChapter = vi.fn();

    render(<StoryProgressionCanvas bookId="book-1" currentChapter={7} onOpenChapter={onOpenChapter} />);

    // 顶层导航与章节上下文徽标
    expect(screen.getByTestId("story-progression-canvas")).toBeTruthy();
    expect(screen.getByText("故事画布")).toBeTruthy();
    expect(screen.getByTestId("story-progression-chapter-badge").textContent).toContain("第 7 章");

    // 大纲列表只含 outline 分类，按卷号排序（同名文本也会出现在快捷聚焦 chips，列表断言限定在侧栏作用域）
    const listScope = () => within(screen.getByLabelText("大纲条目列表"));
    expect((await listScope().findAllByText("第一卷 灵潮初起")).length).toBeGreaterThan(0);
    expect(listScope().getAllByText("第二卷 宗门风云").length).toBeGreaterThan(0);
    expect(listScope().queryAllByText("薛行之").length).toBe(0);

    // 点击列表条目 → 右侧挂载编辑器（复用 JingweiEntryEditor，不重建）
    fireEvent.click(within(screen.getByLabelText("大纲条目列表")).getByRole("button", { name: /第二卷 宗门风云/ }));
    expect(await screen.findByTestId("mock-jingwei-editor")).toBeTruthy();
    expect(screen.getByTestId("mock-jingwei-editor").textContent).toContain("第二卷 宗门风云");
  });

  it("三个视图可切换：map 走故事地图 DAG，evolution 走发展历程融合图谱并透传章节号", async () => {
    fetchJsonMock.mockResolvedValue([outlineRow()]);
    render(<StoryProgressionCanvas bookId="book-1" currentChapter={3} />);

    fireEvent.click(screen.getByRole("tab", { name: /故事地图/ }));
    await waitFor(() => expect(screen.getByTestId("story-progression-map")).toBeTruthy());
    expect(screen.getByTestId("mock-story-map").textContent).toContain("book-1");

    fireEvent.click(screen.getByRole("tab", { name: /发展历程/ }));
    const timeline = screen.getByTestId("mock-development-timeline");
    expect(timeline).toBeTruthy();
    // 流视图高度标准：frameClassName 铺满 + 80vh 下限；章节锚点透传
    expect(timeline.getAttribute("data-frame")).toContain("min-h-[80vh]");
    expect(timeline.getAttribute("data-chapter")).toBe("3");
  });

  it("initialView 指定初始视图；外部再次变更时内部视图同步跟随", async () => {
    fetchJsonMock.mockResolvedValue([]);
    const { rerender } = render(<StoryProgressionCanvas bookId="book-1" initialView="map" />);
    expect(screen.getByTestId("story-progression-map")).toBeTruthy();

    rerender(<StoryProgressionCanvas bookId="book-1" initialView="evolution" />);
    expect(screen.getByTestId("story-progression-evolution")).toBeTruthy();

    rerender(<StoryProgressionCanvas bookId="book-1" initialView="outline" />);
    expect(screen.getByTestId("story-progression-outline")).toBeTruthy();
  });

  it("聚焦实体标签栏同时作用于大纲过滤与发展历程图谱聚焦", async () => {
    fetchJsonMock.mockResolvedValue([
      outlineRow(),
      outlineRow({ id: "o2", title: "第二卷 宗门风云" }),
    ]);
    render(<StoryProgressionCanvas bookId="book-1" />);

    expect(await screen.findAllByText("第一卷 灵潮初起").then((els) => els.length)).toBeGreaterThan(0);

    // 切到发展历程后设置聚焦 → 图谱以 initialFocusEntity 重建
    fireEvent.click(screen.getByRole("tab", { name: /发展历程/ }));
    expect(screen.getByTestId("mock-development-timeline").getAttribute("data-focus")).toBe("");

    fireEvent.change(screen.getByLabelText("聚焦实体"), { target: { value: "宗门" } });
    fireEvent.click(screen.getByRole("button", { name: /聚焦/ }));
    await waitFor(() =>
      expect(screen.getByTestId("mock-development-timeline").getAttribute("data-focus")).toBe("宗门"),
    );

    // 切回大纲：列表被聚焦词过滤，只剩命中的第二卷（chips 行不受影响，故限定列表作用域断言）
    fireEvent.click(screen.getByRole("tab", { name: /大纲总览/ }));
    const filteredList = within(screen.getByLabelText("大纲条目列表"));
    expect(filteredList.queryAllByText("第一卷 灵潮初起").length).toBe(0);
    expect(filteredList.getAllByText("第二卷 宗门风云").length).toBeGreaterThan(0);

    // 聚焦词无任何命中时给出空态引导
    fireEvent.change(screen.getByLabelText("聚焦实体"), { target: { value: "绝不存在的词" } });
    fireEvent.click(screen.getByRole("button", { name: /聚焦/ }));
    await waitFor(() => expect(screen.getByText(/没有匹配「绝不存在的词」的大纲条目/)).toBeTruthy());

    // 快捷预设 chips 一键聚焦（点击后过滤切到第一卷，列表恢复显示）
    fireEvent.click(within(screen.getByLabelText("快速聚焦预设")).getByRole("button", { name: "第一卷 灵潮初起" }));
    expect(within(screen.getByLabelText("大纲条目列表")).getAllByText("第一卷 灵潮初起").length).toBeGreaterThan(0);

    // 清除聚焦恢复全量
    fireEvent.click(screen.getByRole("button", { name: /清除/ }));
    expect(within(screen.getByLabelText("大纲条目列表")).getAllByText("第一卷 灵潮初起").length).toBeGreaterThan(0);
    expect(within(screen.getByLabelText("大纲条目列表")).getAllByText("第二卷 宗门风云").length).toBeGreaterThan(0);
  });

  it("大纲加载失败展示 fallback 与重试；空列表给出创建引导", async () => {
    fetchJsonMock.mockRejectedValue(new Error("网络中断"));
    render(<StoryProgressionCanvas bookId="book-1" />);
    expect(await screen.findByText(/网络中断/)).toBeTruthy();

    fetchJsonMock.mockResolvedValue([]);
    fireEvent.click(screen.getByRole("button", { name: /重试/ }));
    expect(await screen.findByText(/本书还没有卷纲条目/)).toBeTruthy();
  });

  it("未绑定书籍时展示明确 fallback", () => {
    render(<StoryProgressionCanvas bookId="" />);
    expect(screen.getByText(/尚未绑定书籍/)).toBeTruthy();
  });
});
