import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StorylineAndPlanningSidebarPanel } from "./StorylineAndPlanningSidebarPanel";
import type { WorkbenchResourceNode } from "../useWorkbenchResources";

vi.mock("../NarrativeMemoryPanel", () => ({
  NarrativeMemoryPanel: () => <div data-testid="mock-narrative-memory" />,
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
  const foreshadowingNode = node("tool:foreshadowing", "伏笔看板", "tool");
  const storyMapNode = node("story-map:book-1", "故事主支线", "story-map");
  render(
    <StorylineAndPlanningSidebarPanel
      bookId="book-1"
      chapterTreeNodes={[node("chapters", "章节", "group", [chapter])]}
      outlineTreeNodes={[node("outline", "卷纲", "group", [outline])]}
      memoryNodes={[]}
      foreshadowingNode={foreshadowingNode}
      storyMapNode={storyMapNode}
      selectedNodeId={null}
      onOpen={onOpen}
      onSwitchView={onSwitchView}
    />,
  );
  return { onOpen, onSwitchView, chapter, outline, foreshadowingNode, storyMapNode };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("StorylineAndPlanningSidebarPanel 故事推进入口", () => {
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

  it("切换到故事画布 Tab 展示三个大屏画布主入口，点击打开统一画布 Tab 并携带 preferredView", () => {
    const { onOpen } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "故事画布" }));

    // 三个大屏画布主入口
    expect(screen.getByTestId("storyline-canvas-entries")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /大纲总览画布/ }));
    expect(onOpen).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: "story-progression:book-1",
        kind: "story-progression",
        title: "故事画布",
        metadata: expect.objectContaining({ isStoryProgression: true, bookId: "book-1", preferredView: "outline" }),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /故事地图画布/ }));
    expect(onOpen).toHaveBeenLastCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ preferredView: "map" }),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /发展历程画布/ }));
    expect(onOpen).toHaveBeenLastCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ preferredView: "evolution" }),
      }),
    );
  });

  it("经典独立图谱视图入口保留在高级折叠区，点击打开对应 preferredView", () => {
    const { onOpen, storyMapNode } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "故事画布" }));

    // 经典入口仍在折叠区内
    expect(screen.getByRole("button", { name: "关系网络" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "时间线" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "矛盾冲突" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "故事演进" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "关系网络" }));
    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "narrative-memory-graph",
        metadata: expect.objectContaining({ preferredView: "relationship" }),
      })
    );

    // 独立全屏故事地图 (DAG) 保留
    fireEvent.click(screen.getByRole("button", { name: "独立全屏故事地图 (DAG)" }));
    expect(onOpen).toHaveBeenCalledWith(storyMapNode);
  });

  it("当前语境切换到写作视图，伏笔账本打开已有工具节点", () => {
    const { onOpen, onSwitchView, foreshadowingNode } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "当前语境" }));
    fireEvent.click(screen.getByRole("button", { name: "伏笔账本" }));

    expect(onSwitchView).toHaveBeenCalledWith("write");
    expect(onOpen).toHaveBeenCalledWith(foreshadowingNode);
  });
});
