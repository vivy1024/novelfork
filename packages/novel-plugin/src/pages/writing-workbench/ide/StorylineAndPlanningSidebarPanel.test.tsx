import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StorylineAndPlanningSidebarPanel } from "./StorylineAndPlanningSidebarPanel";
import type { WorkbenchResourceNode } from "../useWorkbenchResources";

vi.mock("../NarrativeMemoryPanel", () => ({
  NarrativeMemorySummary: ({ onOpenCenter }: { onOpenCenter?: () => void }) => (
    <button type="button" data-testid="mock-memory-summary" onClick={() => onOpenCenter?.()}>
      章后事实摘要
    </button>
  ),
}));

const capabilities = { open: true, readonly: false, unsupported: false, edit: true, delete: true, apply: false };

function node(id: string, title: string, kind: WorkbenchResourceNode["kind"] = "file", children?: WorkbenchResourceNode[]): WorkbenchResourceNode {
  return {
    id,
    kind,
    title,
    capabilities,
    ...(children ? { children } : {}),
  };
}

function renderPanel() {
  const onOpen = vi.fn();
  const onSwitchView = vi.fn();
  const chapter = node("chapter:1", "第 1 章", "chapter");
  const outline = node("outline:1", "第一卷：起点", "jingwei-entry");
  render(
    <StorylineAndPlanningSidebarPanel
      bookId="book-1"
      chapterTreeNodes={[node("chapters", "章节", "group", [chapter])]}
      outlineTreeNodes={[node("outline", "卷纲", "group", [outline])]}
      selectedNodeId={null}
      onOpen={onOpen}
      onSwitchView={onSwitchView}
    />,
  );
  return { onOpen, onSwitchView, chapter, outline };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("StorylineAndPlanningSidebarPanel 故事推进入口（IA 收敛后）", () => {
  it("默认展示章节与大纲 Tab，并点击叶子复用 onOpen", () => {
    const { onOpen, chapter, outline } = renderPanel();

    expect(screen.getByRole("button", { name: "章节与大纲" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "章后事实" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "故事画布" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "伏笔账本" })).toBeTruthy();
    expect(screen.getByText("当前语境")).toBeTruthy();
    expect(screen.getByText("第 1 章")).toBeTruthy();
    expect(screen.getByText("第一卷：起点")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "第 1 章" }));
    fireEvent.click(screen.getByRole("button", { name: "第一卷：起点" }));
    expect(onOpen).toHaveBeenCalledWith(chapter);
    expect(onOpen).toHaveBeenCalledWith(outline);
  });

  it("章后事实 Tab 只渲染轻量摘要卡，点击摘要直达中央面板节点", () => {
    const { onOpen } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "章后事实" }));

    // 摘要卡渲染，且完整面板不在侧栏内嵌
    fireEvent.click(screen.getByTestId("mock-memory-summary"));
    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "memory-center:book-1",
        metadata: expect.objectContaining({ isMemoryCenter: true, bookId: "book-1" }),
      }),
    );
  });

  it("故事画布 Tab 点击即在中央打开画布（默认发展历程），并提供编年史快捷入口；经典图谱入口已移除", () => {
    const { onOpen } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "故事画布" }));

    // 点击 tab 本身即打开 evolution 权威入口
    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "story-progression:book-1",
        metadata: expect.objectContaining({ isStoryProgression: true, preferredView: "evolution" }),
      }),
    );

    // 侧栏只保留两个轻量快捷入口，不再堆叠全部视图按钮与经典图谱折叠区
    expect(screen.queryByTestId("storyline-canvas-entries")).toBeNull();
    expect(screen.queryByRole("button", { name: "关系网络" })).toBeNull();
    expect(screen.queryByRole("button", { name: /独立全屏故事地图/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /大纲总览/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /打开双螺旋编年史/ }));
    expect(onOpen).toHaveBeenLastCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ preferredView: "chronicle" }),
      }),
    );
  });

  it("当前语境切换到写作视图，伏笔账本打开全屏看板工具节点", () => {
    const { onOpen, onSwitchView } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "当前语境" }));
    fireEvent.click(screen.getByRole("button", { name: "伏笔账本" }));

    expect(onSwitchView).toHaveBeenCalledWith("write");
    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "tool:foreshadowing",
        metadata: expect.objectContaining({ toolPanel: "foreshadowing" }),
      }),
    );
  });
});
