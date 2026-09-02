import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./StoryProgressBoard", () => ({
  StoryProgressBoard: ({
    bookId,
    currentChapter,
    onOpenChapter,
  }: {
    bookId: string;
    currentChapter?: number;
    onOpenChapter?: (chapterNumber: number) => void;
  }) => (
    <div data-testid="mock-progress-board" data-book={bookId} data-chapter={currentChapter ?? ""}>
      <button type="button" onClick={() => onOpenChapter?.(30)}>去写第 30 章</button>
    </div>
  ),
}));

vi.mock("./CanonicalTreesPanel", () => ({
  CanonicalTreesPanel: ({
    bookId,
    initialKind,
    showSwitcher,
    onOpenEntry,
  }: {
    bookId: string;
    initialKind?: string;
    showSwitcher?: boolean;
    onOpenEntry?: (entryId: string, label: string) => void;
  }) => (
    <div
      data-testid={
        initialKind === "chronicle" ? "mock-chronicle"
          : initialKind === "relations" ? "mock-network"
            : initialKind === "timeline" ? "mock-timeline"
              : "mock-story-tree"
      }
      data-book={bookId}
      data-kind={initialKind ?? "worldview"}
      data-switcher={showSwitcher === false ? "off" : "on"}
    >
      <button type="button" onClick={() => onOpenEntry?.("entry-9", "薛行之")}>打开条目</button>
      <button type="button" onClick={() => onOpenEntry?.("entry-1", "薛行之")}>打开实体</button>
    </div>
  ),
}));

import { StoryProgressionCanvas, normalizeStoryProgressionView } from "./StoryProgressionCanvas";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("StoryProgressionCanvas 故事推进外壳", () => {
  it("默认打开故事树（看世界观/角色/设定层级）", async () => {
    render(<StoryProgressionCanvas bookId="book-1" currentChapter={29} />);

    expect(screen.getByTestId("story-progression-canvas")).toBeTruthy();
    expect(screen.getByText("故事推进")).toBeTruthy();
    expect(screen.getByTestId("story-progression-chapter-badge").textContent).toContain("第 29 章");

    // 默认视图 = 故事树
    await waitFor(() => expect(screen.getByTestId("mock-story-tree")).toBeTruthy());
    expect(screen.getByTestId("story-progression-tree")).toBeTruthy();

    expect(screen.queryByRole("tab", { name: /故事地图/ })).toBeNull();
    expect(screen.queryByRole("tab", { name: /双螺旋/ })).toBeNull();

    expect(screen.getByRole("tab", { name: /故事树/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /推进/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /发展历程/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /章节脉络/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /关系网/ })).toBeTruthy();
  });

  it("可切到推进网格并透传章节号", async () => {
    render(<StoryProgressionCanvas bookId="book-1" currentChapter={29} />);
    fireEvent.click(screen.getByRole("tab", { name: /推进/ }));
    await waitFor(() => expect(screen.getByTestId("mock-progress-board")).toBeTruthy());
    expect(screen.getByTestId("mock-progress-board").getAttribute("data-chapter")).toBe("29");
  });

  it("故事树里打开条目转成实体详情回调", async () => {
    const onOpenEntityDetail = vi.fn();
    render(<StoryProgressionCanvas bookId="book-1" onOpenEntityDetail={onOpenEntityDetail} />);
    fireEvent.click(await waitFor(() => screen.getByRole("button", { name: "打开条目" })));
    expect(onOpenEntityDetail).toHaveBeenCalledWith("薛行之", "entry-9");
  });

  it("可切到参考区：章节脉络与关系网", async () => {
    render(<StoryProgressionCanvas bookId="book-1" currentChapter={3} />);

    fireEvent.click(screen.getByRole("tab", { name: /章节脉络/ }));
    await waitFor(() => expect(screen.getByTestId("mock-chronicle")).toBeTruthy());
    expect(screen.getByTestId("story-progression-chronicle")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /关系网/ }));
    await waitFor(() => expect(screen.getByTestId("mock-network")).toBeTruthy());
    expect(screen.getByTestId("story-progression-network")).toBeTruthy();
  });

  it("参考视图带说明与「回到故事树」，避免被当成主视觉", async () => {
    render(<StoryProgressionCanvas bookId="book-1" />);

    // 主视觉（树）下没有该页脚
    expect(screen.queryByTestId("story-progression-back-to-board")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: /关系网/ }));
    await waitFor(() => expect(screen.getByTestId("story-progression-back-to-board")).toBeTruthy());

    fireEvent.click(screen.getByTestId("story-progression-back-to-board"));
    await waitFor(() => expect(screen.getByTestId("story-progression-tree")).toBeTruthy());
  });

  it("推进网格是主视觉之一，不带参考区页脚", async () => {
    render(<StoryProgressionCanvas bookId="book-1" />);
    fireEvent.click(screen.getByRole("tab", { name: /推进/ }));
    await waitFor(() => expect(screen.getByTestId("mock-progress-board")).toBeTruthy());
    expect(screen.queryByTestId("story-progression-back-to-board")).toBeNull();
  });

  it("旧 initialView 取值落到对应树，不再打开点云或对照条", async () => {
    const { rerender } = render(<StoryProgressionCanvas bookId="book-1" initialView="map" />);
    await waitFor(() => expect(screen.getByTestId("story-progression-network")).toBeTruthy());
    expect(screen.getByTestId("mock-network").getAttribute("data-kind")).toBe("relations");

    rerender(<StoryProgressionCanvas bookId="book-1" initialView="evolution" />);
    await waitFor(() => expect(screen.getByTestId("story-progression-timeline")).toBeTruthy());
    expect(screen.getByTestId("mock-timeline").getAttribute("data-kind")).toBe("timeline");
  });

  it("initialView 指定参考视图；外部再次变更时内部视图同步跟随", async () => {
    const { rerender } = render(<StoryProgressionCanvas bookId="book-1" initialView="chronicle" />);
    await waitFor(() => expect(screen.getByTestId("story-progression-chronicle")).toBeTruthy());

    rerender(<StoryProgressionCanvas bookId="book-1" initialView="tree" />);
    await waitFor(() => expect(screen.getByTestId("story-progression-tree")).toBeTruthy());
  });

  it("章节跳转回调透传给推进网格", async () => {
    const onOpenChapter = vi.fn();
    render(<StoryProgressionCanvas bookId="book-1" onOpenChapter={onOpenChapter} />);
    fireEvent.click(screen.getByRole("tab", { name: /推进/ }));
    fireEvent.click(await waitFor(() => screen.getByRole("button", { name: "去写第 30 章" })));
    expect(onOpenChapter).toHaveBeenCalledWith(30);
  });

  it("实体详情回调透传给关系网", async () => {
    const onOpenEntityDetail = vi.fn();
    render(<StoryProgressionCanvas bookId="book-1" onOpenEntityDetail={onOpenEntityDetail} />);

    fireEvent.click(screen.getByRole("tab", { name: /关系网/ }));
    fireEvent.click(await waitFor(() => screen.getByRole("button", { name: "打开实体" })));
    expect(onOpenEntityDetail).toHaveBeenCalledWith("薛行之", "entry-1");
  });

  it("未绑定书籍时展示明确 fallback", () => {
    render(<StoryProgressionCanvas bookId="" />);
    expect(screen.getByText(/尚未绑定书籍/)).toBeTruthy();
  });
});

describe("normalizeStoryProgressionView", () => {
  it("保留合法取值", () => {
    expect(normalizeStoryProgressionView("tree")).toBe("tree");
    expect(normalizeStoryProgressionView("board")).toBe("board");
    expect(normalizeStoryProgressionView("chronicle")).toBe("chronicle");
    expect(normalizeStoryProgressionView("network")).toBe("network");
    expect(normalizeStoryProgressionView("timeline")).toBe("timeline");
  });

  it("旧取值落到对应树，非法值回落到故事树", () => {
    expect(normalizeStoryProgressionView("map")).toBe("network");
    expect(normalizeStoryProgressionView("evolution")).toBe("timeline");
    expect(normalizeStoryProgressionView("outline")).toBe("tree");
    expect(normalizeStoryProgressionView(undefined)).toBe("tree");
    expect(normalizeStoryProgressionView(42)).toBe("tree");
  });
});
