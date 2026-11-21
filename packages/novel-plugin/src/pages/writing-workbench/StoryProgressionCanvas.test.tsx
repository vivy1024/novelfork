import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./StoryProgressBoard", () => ({
  StoryProgressBoard: ({
    bookId,
    currentChapter,
    hideNextChapterCard,
    onOpenChapter,
  }: {
    bookId: string;
    currentChapter?: number;
    hideNextChapterCard?: boolean;
    onOpenChapter?: (chapterNumber: number) => void;
  }) => (
    <div
      data-testid="mock-progress-board"
      data-book={bookId}
      data-chapter={currentChapter ?? ""}
      data-hide-next={hideNextChapterCard ? "true" : "false"}
    >
      <button type="button" onClick={() => onOpenChapter?.(30)}>打开第 30 章</button>
    </div>
  ),
}));

vi.mock("./OutlineOverviewPanel", () => ({
  OutlineOverviewPanel: ({
    bookId,
    currentChapter,
    onOpenBoardProgress,
    onOpenStoryTree,
  }: {
    bookId: string;
    currentChapter?: number;
    onOpenBoardProgress?: () => void;
    onOpenStoryTree?: () => void;
  }) => (
    <div data-testid="mock-outline-overview" data-book={bookId} data-chapter={String(currentChapter ?? "")}>
      <button type="button" onClick={() => onOpenBoardProgress?.()}>看推进网格</button>
      <button type="button" onClick={() => onOpenStoryTree?.()}>看故事树</button>
    </div>
  ),
}));

vi.mock("./CanonicalTreesPanel", () => ({
  CanonicalTreesPanel: ({
    bookId,
    initialKind,
    kinds,
    showSwitcher,
    onOpenEntry,
  }: {
    bookId: string;
    initialKind?: string;
    kinds?: readonly string[];
    showSwitcher?: boolean;
    onOpenEntry?: (entryId: string, label: string) => void;
  }) => (
    <div
      data-testid={
        initialKind === "chronicle" ? "mock-chronicle"
          : initialKind === "causal" || initialKind === "relations" ? "mock-network"
            : initialKind === "timeline" ? "mock-timeline"
              : "mock-story-tree"
      }
      data-book={bookId}
      data-kind={initialKind ?? "worldview"}
      data-kinds={kinds?.join(",") ?? ""}
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

describe("StoryProgressionCanvas 故事画布外壳", () => {
  it("默认打开「大纲总览」，已移除与写作台重复的「下一章」页签", async () => {
    render(<StoryProgressionCanvas bookId="book-1" currentChapter={29} />);

    expect(screen.getByTestId("story-progression-canvas")).toBeTruthy();
    expect(screen.getByText("故事画布")).toBeTruthy();
    expect(screen.getByTestId("story-progression-chapter-badge").textContent).toContain("第 29 章");

    await waitFor(() => expect(screen.getByTestId("mock-outline-overview")).toBeTruthy());
    expect(screen.getByRole("tab", { name: /大纲总览/ }).getAttribute("aria-selected")).toBe("true");

    expect(screen.queryByRole("tab", { name: /下一章/ })).toBeNull();
    expect(screen.queryByRole("tab", { name: /故事地图/ })).toBeNull();
    expect(screen.queryByRole("tab", { name: /双螺旋/ })).toBeNull();

    expect(screen.getByRole("tab", { name: /推进网格/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /故事树/ })).toBeTruthy();
  });

  it("可切到推进网格并透传章节号且隐藏重复的下一章焦点卡", async () => {
    render(<StoryProgressionCanvas bookId="book-1" currentChapter={29} />);
    fireEvent.click(screen.getByRole("tab", { name: /推进网格/ }));
    await waitFor(() => expect(screen.getByTestId("mock-progress-board")).toBeTruthy());
    expect(screen.getByTestId("mock-progress-board").getAttribute("data-chapter")).toBe("29");
    expect(screen.getByTestId("mock-progress-board").getAttribute("data-hide-next")).toBe("true");
  });

  it("画布只提供大纲总览 / 推进网格 / 故事树；旧的 next/workflow 取值平滑落到大纲总览不白屏", async () => {
    render(<StoryProgressionCanvas bookId="book-1" currentChapter={12} initialView="next" />);
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent?.trim())).toEqual(["大纲总览", "推进网格", "故事树"]);
    expect(screen.queryByRole("tab", { name: /执行/ })).toBeNull();
    expect(screen.queryByRole("tab", { name: /下一章/ })).toBeNull();
    await waitFor(() => expect(screen.getByTestId("mock-outline-overview")).toBeTruthy());
    expect(screen.getByRole("tab", { name: /大纲总览/ }).getAttribute("aria-selected")).toBe("true");
    expect(normalizeStoryProgressionView("workflow")).toBe("overview");
    expect(normalizeStoryProgressionView("next")).toBe("overview");
  });

  it("故事树只保留发展历程与因果脉络", async () => {
    render(<StoryProgressionCanvas bookId="book-1" initialView="tree" />);
    await waitFor(() => expect(screen.getByTestId("mock-chronicle")).toBeTruthy());
    const kinds = screen.getByTestId("mock-chronicle").getAttribute("data-kinds") ?? "";
    expect(kinds.split(",")).toEqual(["chronicle", "causal"]);
    expect(kinds).not.toContain("chapters");
    expect(screen.getByTestId("mock-chronicle").getAttribute("data-kind")).toBe("chronicle");
  });

  it("故事树里打开条目转成实体详情回调", async () => {
    const onOpenEntityDetail = vi.fn();
    render(<StoryProgressionCanvas bookId="book-1" initialView="tree" onOpenEntityDetail={onOpenEntityDetail} />);
    fireEvent.click(await waitFor(() => screen.getByRole("button", { name: "打开条目" })));
    expect(onOpenEntityDetail).toHaveBeenCalledWith("薛行之", "entry-9");
  });

  it("全景模式接管整屏并可退出", async () => {
    render(<StoryProgressionCanvas bookId="book-1" currentChapter={29} />);

    const canvas = screen.getByTestId("story-progression-canvas");
    expect(canvas.getAttribute("data-fullscreen")).toBe("false");

    fireEvent.click(screen.getByTestId("story-progression-fullscreen"));
    expect(screen.getByTestId("story-progression-canvas").getAttribute("data-fullscreen")).toBe("true");
    expect(screen.getByText("退出全景")).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => {
      expect(screen.getByTestId("story-progression-canvas").getAttribute("data-fullscreen")).toBe("false");
    });

    fireEvent.click(screen.getByTestId("story-progression-fullscreen"));
    fireEvent.click(screen.getByText("退出全景"));
    await waitFor(() => {
      expect(screen.getByTestId("story-progression-canvas").getAttribute("data-fullscreen")).toBe("false");
    });
  });

  it("大纲总览内的视图切换入口可切到推进网格与故事树", async () => {
    render(<StoryProgressionCanvas bookId="book-1" />);
    await waitFor(() => expect(screen.getByTestId("mock-outline-overview")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "看推进网格" }));
    await waitFor(() => {
      expect(screen.getByTestId("mock-progress-board")).toBeTruthy();
      expect(screen.getByRole("tab", { name: /推进网格/ }).getAttribute("aria-selected")).toBe("true");
    });

    fireEvent.click(screen.getByRole("tab", { name: /大纲总览/ }));
    await waitFor(() => screen.getByTestId("mock-outline-overview"));
    fireEvent.click(screen.getByRole("button", { name: "看故事树" }));
    await waitFor(() => {
      expect(screen.getByTestId("mock-chronicle")).toBeTruthy();
      expect(screen.getByRole("tab", { name: /故事树/ }).getAttribute("aria-selected")).toBe("true");
    });
  });

  it("旧 initialView 别名正确映射到故事树的对应子树", async () => {
    const { rerender } = render(<StoryProgressionCanvas bookId="book-1" initialView="map" />);
    await waitFor(() => expect(screen.getByTestId("mock-network")).toBeTruthy());
    expect(screen.getByTestId("mock-network").getAttribute("data-kind")).toBe("causal");

    rerender(<StoryProgressionCanvas bookId="book-1" initialView="evolution" />);
    await waitFor(() => expect(screen.getByTestId("mock-chronicle")).toBeTruthy());
    expect(screen.getByTestId("mock-chronicle").getAttribute("data-kind")).toBe("chronicle");

    rerender(<StoryProgressionCanvas bookId="book-1" initialView="chronicle" />);
    await waitFor(() => expect(screen.getByTestId("mock-chronicle")).toBeTruthy());
    expect(screen.getByTestId("mock-chronicle").getAttribute("data-kind")).toBe("chronicle");

    rerender(<StoryProgressionCanvas bookId="book-1" initialView="outline" />);
    await waitFor(() => expect(screen.getByTestId("mock-chronicle")).toBeTruthy());
    expect(screen.getByTestId("mock-chronicle").getAttribute("data-kind")).toBe("chronicle");
  });

  it("章节跳转回调透传给推进网格", async () => {
    const onOpenChapter = vi.fn();
    render(<StoryProgressionCanvas bookId="book-1" onOpenChapter={onOpenChapter} />);
    fireEvent.click(screen.getByRole("tab", { name: /推进网格/ }));
    fireEvent.click(await waitFor(() => screen.getByRole("button", { name: "打开第 30 章" })));
    expect(onOpenChapter).toHaveBeenCalledWith(30);
  });

  it("实体详情回调在故事树内可透传", async () => {
    const onOpenEntityDetail = vi.fn();
    render(<StoryProgressionCanvas bookId="book-1" initialView="network" onOpenEntityDetail={onOpenEntityDetail} />);

    fireEvent.click(await waitFor(() => screen.getByRole("button", { name: "打开实体" })));
    expect(onOpenEntityDetail).toHaveBeenCalledWith("薛行之", "entry-1");
  });

  it("未绑定书籍时展示明确 fallback", () => {
    render(<StoryProgressionCanvas bookId="" />);
    expect(screen.getByText(/尚未绑定书籍/)).toBeTruthy();
  });
});

describe("normalizeStoryProgressionView 与 resolveInitialTreeKind", () => {
  it("保留合法主视图取值", () => {
    expect(normalizeStoryProgressionView("overview")).toBe("overview");
    expect(normalizeStoryProgressionView("tree")).toBe("tree");
    expect(normalizeStoryProgressionView("board")).toBe("board");
  });

  it("旧取值映射到对应视图，非法值回落到大纲总览", () => {
    expect(normalizeStoryProgressionView("next")).toBe("overview");
    expect(normalizeStoryProgressionView("workflow")).toBe("overview");
    expect(normalizeStoryProgressionView("chronicle")).toBe("tree");
    expect(normalizeStoryProgressionView("network")).toBe("tree");
    expect(normalizeStoryProgressionView("timeline")).toBe("tree");
    expect(normalizeStoryProgressionView("map")).toBe("tree");
    expect(normalizeStoryProgressionView("evolution")).toBe("tree");
    expect(normalizeStoryProgressionView("outline")).toBe("tree");
    expect(normalizeStoryProgressionView(undefined)).toBe("overview");
    expect(normalizeStoryProgressionView(42)).toBe("overview");
  });
});
