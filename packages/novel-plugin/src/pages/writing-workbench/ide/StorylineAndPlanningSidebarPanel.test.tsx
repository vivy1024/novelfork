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
  it("展示作者任务入口和章节/大纲只读树，并点击叶子复用 onOpen", () => {
    const { onOpen, chapter, outline, storyMapNode } = renderPanel();

    expect(screen.getByRole("button", { name: "故事主支线" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "章节与大纲" })).toBeTruthy();
    expect(screen.getByText("当前语境")).toBeTruthy();
    expect(screen.getByText("故事演进")).toBeTruthy();
    expect(screen.getByText("伏笔账本")).toBeTruthy();
    expect(screen.getByText("章后事实")).toBeTruthy();
    expect(screen.getByText("第 1 章")).toBeTruthy();
    expect(screen.getByText("第一卷：起点")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "故事主支线" }));
    expect(onOpen).toHaveBeenCalledWith(storyMapNode);

    fireEvent.click(screen.getByRole("button", { name: "第 1 章" }));
    fireEvent.click(screen.getByRole("button", { name: "第一卷：起点" }));
    expect(onOpen).toHaveBeenCalledWith(chapter);
    expect(onOpen).toHaveBeenCalledWith(outline);
  });

  it("当前语境切换到写作视图，伏笔账本打开已有工具节点", () => {
    const { onOpen, onSwitchView, foreshadowingNode } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "当前语境" }));
    fireEvent.click(screen.getByRole("button", { name: "伏笔账本" }));

    expect(onSwitchView).toHaveBeenCalledWith("write");
    expect(onOpen).toHaveBeenCalledWith(foreshadowingNode);
  });

  it("图谱入口使用对应 preferredView，章后事实入口滚动到状态区域", () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
    const { onOpen } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "故事演进" }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ preferredView: "event_chain" }),
    }));

    fireEvent.click(screen.getByRole("button", { name: "关系图" }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ preferredView: "relationship" }),
    }));

    fireEvent.click(screen.getByRole("button", { name: "时间线" }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ preferredView: "timeline" }),
    }));

    fireEvent.click(screen.getByRole("button", { name: "冲突地图" }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ preferredView: "conflict" }),
    }));

    fireEvent.click(screen.getByRole("button", { name: "章后事实" }));
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "smooth" });
  });
});
