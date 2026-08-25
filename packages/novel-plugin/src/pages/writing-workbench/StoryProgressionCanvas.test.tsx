import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { StoryProgressionCanvas } from "./StoryProgressionCanvas";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("StoryProgressionCanvas 故事推进大屏画布", () => {
  it("默认打开发展历程（IA 收敛后大纲不再是画布视图）", () => {
    render(<StoryProgressionCanvas bookId="book-1" currentChapter={7} />);

    // 顶层导航与章节上下文徽标
    expect(screen.getByTestId("story-progression-canvas")).toBeTruthy();
    expect(screen.getByText("故事画布")).toBeTruthy();
    expect(screen.getByTestId("story-progression-chapter-badge").textContent).toContain("第 7 章");

    // 默认视图 = 发展历程；视图切换器只有三个空间视图，没有「大纲总览」。
    expect(screen.getByTestId("story-progression-evolution")).toBeTruthy();
    expect(screen.queryByRole("tab", { name: /大纲总览/ })).toBeNull();
    expect(screen.getByRole("tab", { name: /发展历程/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /双螺旋编年史/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /故事地图/ })).toBeTruthy();
  });

  it("三个视图可切换：map 走故事地图 DAG，evolution 走发展历程融合图谱并透传章节号", async () => {
    render(<StoryProgressionCanvas bookId="book-1" currentChapter={3} />);

    fireEvent.click(screen.getByRole("tab", { name: /故事地图/ }));
    // StoryMapCanvas 是 lazy chunk：直接等 mock 内容出现，避免 Suspense fallback 竞态。
    await waitFor(() => expect(screen.getByTestId("mock-story-map")).toBeTruthy());
    expect(screen.getByTestId("story-progression-map")).toBeTruthy();
    expect(screen.getByTestId("mock-story-map").textContent).toContain("book-1");

    fireEvent.click(screen.getByRole("tab", { name: /发展历程/ }));
    const timeline = screen.getByTestId("mock-development-timeline");
    expect(timeline).toBeTruthy();
    // 流视图高度标准：frameClassName 铺满 + 80vh 下限；章节锚点透传
    expect(timeline.getAttribute("data-frame")).toContain("min-h-[80vh]");
    expect(timeline.getAttribute("data-chapter")).toBe("3");
  });

  it("initialView 指定初始视图；外部再次变更时内部视图同步跟随", () => {
    const { rerender } = render(<StoryProgressionCanvas bookId="book-1" initialView="map" />);
    expect(screen.getByTestId("story-progression-map")).toBeTruthy();

    rerender(<StoryProgressionCanvas bookId="book-1" initialView="evolution" />);
    expect(screen.getByTestId("story-progression-evolution")).toBeTruthy();

    rerender(<StoryProgressionCanvas bookId="book-1" initialView="map" />);
    expect(screen.getByTestId("story-progression-map")).toBeTruthy();
  });

  it("聚焦实体输入作用于发展历程图谱聚焦，可清除恢复全量", async () => {
    render(<StoryProgressionCanvas bookId="book-1" />);

    // 初始无聚焦
    expect(screen.getByTestId("mock-development-timeline").getAttribute("data-focus")).toBe("");

    fireEvent.change(screen.getByLabelText("聚焦实体"), { target: { value: "宗门" } });
    fireEvent.click(screen.getByRole("button", { name: /聚焦/ }));
    await waitFor(() =>
      expect(screen.getByTestId("mock-development-timeline").getAttribute("data-focus")).toBe("宗门"),
    );

    // 清除聚焦 → 工作区以空聚焦重建
    fireEvent.click(screen.getByRole("button", { name: /清除/ }));
    await waitFor(() =>
      expect(screen.getByTestId("mock-development-timeline").getAttribute("data-focus")).toBe(""),
    );
  });

  it("未绑定书籍时展示明确 fallback", () => {
    render(<StoryProgressionCanvas bookId="" />);
    expect(screen.getByText(/尚未绑定书籍/)).toBeTruthy();
  });
});
