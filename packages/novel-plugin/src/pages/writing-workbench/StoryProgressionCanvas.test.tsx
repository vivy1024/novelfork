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

vi.mock("./NextChapterPanel", () => ({
  NextChapterPanel: ({
    bookId,
    currentChapter,
    onOpenBoardProgress,
    onOpenCausalTree,
  }: {
    bookId: string;
    currentChapter?: number;
    onOpenBoardProgress?: () => void;
    onOpenCausalTree?: () => void;
  }) => (
    <div data-testid="mock-next-chapter" data-book={bookId} data-chapter={String(currentChapter ?? "")}>
      <button type="button" onClick={() => onOpenBoardProgress?.()}>看推进板</button>
      <button type="button" onClick={() => onOpenCausalTree?.()}>看因果树</button>
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
  it("默认打开「下一章」整合页；故事树等仍在顶部页签", async () => {
    render(<StoryProgressionCanvas bookId="book-1" currentChapter={29} />);

    expect(screen.getByTestId("story-progression-canvas")).toBeTruthy();
    expect(screen.getByText("故事推进")).toBeTruthy();
    expect(screen.getByTestId("story-progression-chapter-badge").textContent).toContain("第 29 章");

    // 默认视图 = 下一章（回归：此前组件默认值仍是故事树，「下一章」从没当过落点）
    await waitFor(() => expect(screen.getByTestId("mock-next-chapter")).toBeTruthy());
    expect(screen.getByRole("tab", { name: /下一章/ }).getAttribute("aria-selected")).toBe("true");

    expect(screen.queryByRole("tab", { name: /故事地图/ })).toBeNull();
    expect(screen.queryByRole("tab", { name: /双螺旋/ })).toBeNull();

    expect(screen.getByRole("tab", { name: /故事树/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /推进/ })).toBeTruthy();
    // 顶层旧重复入口已下线
    expect(screen.queryByRole("tab", { name: /发展历程/ })).toBeNull();
    expect(screen.queryByRole("tab", { name: /章节脉络/ })).toBeNull();
    expect(screen.queryByRole("tab", { name: /关系网/ })).toBeNull();
  });

  it("可切到推进网格并透传章节号", async () => {
    render(<StoryProgressionCanvas bookId="book-1" currentChapter={29} />);
    fireEvent.click(screen.getByRole("tab", { name: /推进/ }));
    await waitFor(() => expect(screen.getByTestId("mock-progress-board")).toBeTruthy());
    expect(screen.getByTestId("mock-progress-board").getAttribute("data-chapter")).toBe("29");
  });

  it("画布只剩下一章 / 推进 / 故事树；「执行」已迁到写作视图，旧取值落到「下一章」不白屏", async () => {
    render(<StoryProgressionCanvas bookId="book-1" currentChapter={12} initialView="workflow" />);
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent?.trim())).toEqual(["下一章", "推进", "故事树"]);
    expect(screen.queryByRole("tab", { name: /执行/ })).toBeNull();
    // 旧的 workflow 取值（历史节点 / 外部传参）落到「下一章」，画布照常有内容
    await waitFor(() => expect(screen.getByTestId("mock-next-chapter")).toBeTruthy());
    expect(screen.getByRole("tab", { name: /下一章/ }).getAttribute("aria-selected")).toBe("true");
    expect(normalizeStoryProgressionView("workflow")).toBe("next");
  });

  it("推进页的正图只含结构类的树，世界观与关系树不在这里", async () => {
    render(<StoryProgressionCanvas bookId="book-1" initialView="tree" />);
    await waitFor(() => expect(screen.getByTestId("mock-story-tree")).toBeTruthy());
    const kinds = screen.getByTestId("mock-story-tree").getAttribute("data-kinds") ?? "";
    expect(kinds.split(",")).toEqual(["chapters", "causal", "chronicle", "timeline"]);
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

  it("「下一章」页的视图入口：推进板切到 board，因果树切到 tree 的 causal 子树", async () => {
    render(<StoryProgressionCanvas bookId="book-1" />);
    await waitFor(() => expect(screen.getByTestId("mock-next-chapter")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "看推进板" }));
    await waitFor(() => {
      expect(screen.getByTestId("mock-progress-board")).toBeTruthy();
      expect(screen.getByRole("tab", { name: /推进/ }).getAttribute("aria-selected")).toBe("true");
    });

    // 回到「下一章」再从因果树入口进：树应定位到 causal 子树
    fireEvent.click(screen.getByRole("tab", { name: /下一章/ }));
    await waitFor(() => screen.getByTestId("mock-next-chapter"));
    fireEvent.click(screen.getByRole("button", { name: "看因果树" }));
    await waitFor(() => {
      const tree = screen.getByTestId("mock-network");
      expect(tree).toBeTruthy();
      expect(tree.getAttribute("data-kind")).toBe("causal");
      expect(screen.getByRole("tab", { name: /故事树/ }).getAttribute("aria-selected")).toBe("true");
    });
  });

  it("旧 initialView 别名正确映射到故事树的对应子树", async () => {
    const { rerender } = render(<StoryProgressionCanvas bookId="book-1" initialView="map" />);
    await waitFor(() => expect(screen.getByTestId("mock-network")).toBeTruthy());
    expect(screen.getByTestId("mock-network").getAttribute("data-kind")).toBe("causal");

    rerender(<StoryProgressionCanvas bookId="book-1" initialView="evolution" />);
    await waitFor(() => expect(screen.getByTestId("mock-timeline")).toBeTruthy());
    expect(screen.getByTestId("mock-timeline").getAttribute("data-kind")).toBe("timeline");

    rerender(<StoryProgressionCanvas bookId="book-1" initialView="chronicle" />);
    await waitFor(() => expect(screen.getByTestId("mock-chronicle")).toBeTruthy());
    expect(screen.getByTestId("mock-chronicle").getAttribute("data-kind")).toBe("chronicle");
  });

  it("章节跳转回调透传给推进网格", async () => {
    const onOpenChapter = vi.fn();
    render(<StoryProgressionCanvas bookId="book-1" onOpenChapter={onOpenChapter} />);
    fireEvent.click(screen.getByRole("tab", { name: /推进/ }));
    fireEvent.click(await waitFor(() => screen.getByRole("button", { name: "去写第 30 章" })));
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
    expect(normalizeStoryProgressionView("next")).toBe("next");
    expect(normalizeStoryProgressionView("tree")).toBe("tree");
    expect(normalizeStoryProgressionView("board")).toBe("board");
  });

  it("旧取值落到故事树主视图并解析出对应子树 kind，非法值回落到「下一章」整合页", () => {
    expect(normalizeStoryProgressionView("chronicle")).toBe("tree");
    expect(normalizeStoryProgressionView("network")).toBe("tree");
    expect(normalizeStoryProgressionView("timeline")).toBe("tree");
    expect(normalizeStoryProgressionView("map")).toBe("tree");
    expect(normalizeStoryProgressionView("evolution")).toBe("tree");
    expect(normalizeStoryProgressionView("outline")).toBe("tree");
    expect(normalizeStoryProgressionView(undefined)).toBe("next");
    expect(normalizeStoryProgressionView(42)).toBe("next");
  });
});
