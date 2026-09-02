import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StoryTreeView } from "./StoryTreeView";
import type { TreeEntryInput } from "../../engine/narrative-taxonomy/story-tree";

const entries: TreeEntryInput[] = [
  { id: "c1", category: "characters", title: "薛行之", fields: { name: "薛行之", roleType: "主角" }, contentMd: "灵科院外包数据岗，感气成功后未登记。" },
  { id: "c2", category: "characters", title: "方工", fields: { name: "方工", roleType: "对手" } },
  { id: "l1", category: "locations", title: "灵科院西京分院" },
  { id: "f1", category: "foreshadowing", title: "B-17异常波形", fields: { status: "planted", plantedChapter: 1 } },
  { id: "p1", category: "power-system", title: "功法体系" },
];

afterEach(() => {
  cleanup();
});

describe("StoryTreeView 故事树", () => {
  it("渲染 NarraBench 层级：维度 → 特征 → 分类", () => {
    render(<StoryTreeView entries={entries} />);

    expect(screen.getByTestId("story-tree-view")).toBeTruthy();
    // 维度层与特征层默认展开
    expect(screen.getByTestId("story-tree-row-dimension:story")).toBeTruthy();
    expect(screen.getByTestId("story-tree-row-feature:agent")).toBeTruthy();
    expect(screen.getByTestId("story-tree-row-category:characters")).toBeTruthy();
    // 伏笔归 discourse 而非 story
    expect(screen.getByTestId("story-tree-row-dimension:discourse")).toBeTruthy();
  });

  it("分类层默认折叠，条目不一次全画（渐进展开）", () => {
    render(<StoryTreeView entries={entries} />);
    expect(screen.queryByTestId("story-tree-row-entry:c1")).toBeNull();

    fireEvent.click(screen.getByTestId("story-tree-toggle-category:characters"));
    expect(screen.getByTestId("story-tree-row-entry:c1")).toBeTruthy();
  });

  it("展开后再点可折叠回去", () => {
    render(<StoryTreeView entries={entries} />);
    const toggle = screen.getByTestId("story-tree-toggle-category:characters");
    fireEvent.click(toggle);
    expect(screen.getByTestId("story-tree-row-entry:c1")).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.queryByTestId("story-tree-row-entry:c1")).toBeNull();
  });

  it("全部展开按钮一次打开所有层级", () => {
    render(<StoryTreeView entries={entries} />);
    fireEvent.click(screen.getByTestId("story-tree-expand-all"));
    expect(screen.getByTestId("story-tree-row-entry:c1")).toBeTruthy();
    expect(screen.getByTestId("story-tree-row-entry:f1")).toBeTruthy();
  });

  it("点条目回调 entryId，可跳经纬条目卡", () => {
    const onOpenEntry = vi.fn();
    render(<StoryTreeView entries={entries} onOpenEntry={onOpenEntry} />);
    fireEvent.click(screen.getByTestId("story-tree-toggle-category:characters"));
    fireEvent.click(screen.getByTestId("story-tree-node-entry:c1"));
    expect(onOpenEntry).toHaveBeenCalledWith("c1", "薛行之");
  });

  it("选中节点后详情面板展示正文（details-on-demand）", () => {
    render(<StoryTreeView entries={entries} />);
    expect(screen.getByTestId("story-tree-inspector-empty")).toBeTruthy();

    fireEvent.click(screen.getByTestId("story-tree-toggle-category:characters"));
    fireEvent.click(screen.getByTestId("story-tree-node-entry:c1"));
    const inspector = screen.getByTestId("story-tree-inspector");
    expect(inspector.textContent).toContain("薛行之");
    expect(inspector.textContent).toContain("灵科院外包数据岗");
  });

  it("选中节点回调宿主，可联动关系网", () => {
    const onSelectNode = vi.fn();
    render(<StoryTreeView entries={entries} onSelectNode={onSelectNode} />);
    fireEvent.click(screen.getByTestId("story-tree-node-dimension:story"));
    expect(onSelectNode).toHaveBeenCalledTimes(1);
    expect(onSelectNode.mock.calls[0]![0].id).toBe("dimension:story");
  });

  it("搜索自动展开命中路径", () => {
    render(<StoryTreeView entries={entries} />);
    // 未搜索时条目是折叠的
    expect(screen.queryByTestId("story-tree-row-entry:c1")).toBeNull();

    fireEvent.change(screen.getByLabelText("搜索故事树"), { target: { value: "薛行之" } });
    expect(screen.getByTestId("story-tree-row-entry:c1")).toBeTruthy();
    // 未命中的条目不被展开
    expect(screen.queryByTestId("story-tree-row-entry:p1")).toBeNull();
  });

  it("搜索无结果时明确告知", () => {
    render(<StoryTreeView entries={entries} />);
    fireEvent.change(screen.getByLabelText("搜索故事树"), { target: { value: "不存在的东西" } });
    expect(screen.getByTestId("story-tree-no-match")).toBeTruthy();
  });

  it("网文特有类目带标记，不冒充学术分类", () => {
    render(<StoryTreeView entries={entries} />);
    const row = screen.getByTestId("story-tree-row-category:power-system");
    expect(row.textContent).toContain("网文");
  });

  it("关系度数显示在条目上，供识别枢纽", () => {
    render(
      <StoryTreeView
        entries={entries}
        relations={[
          { sourceName: "方工", targetName: "沈遥" },
          { sourceName: "方工", targetName: "李文彬" },
        ]}
      />,
    );
    fireEvent.click(screen.getByTestId("story-tree-toggle-category:characters"));
    expect(screen.getByTestId("story-tree-row-entry:c2").textContent).toContain("2 关系");
  });

  it("诚实显示没有内容的叙事维度，并可交给叙述者补", () => {
    const onSendToNarrator = vi.fn();
    render(<StoryTreeView entries={entries} onSendToNarrator={onSendToNarrator} />);

    const gaps = screen.getByTestId("story-tree-gaps");
    // 视角与文风整层缺失
    expect(gaps.textContent).toContain("视角");
    expect(gaps.textContent).toContain("文风");

    fireEvent.click(screen.getByTestId("story-tree-fill-gap"));
    expect(onSendToNarrator).toHaveBeenCalledTimes(1);
    expect(String(onSendToNarrator.mock.calls[0]![0])).toContain("视角");
  });

  it("compact 模式（工具卡内）不并排详情栏", () => {
    render(<StoryTreeView entries={entries} mode="compact" />);
    expect(screen.getByTestId("story-tree-view").getAttribute("data-mode")).toBe("compact");
    // compact 下未选中时不渲染详情栏
    expect(screen.queryByTestId("story-tree-inspector-empty")).toBeNull();
    // 也不提供「全部展开」（对话里空间有限）
    expect(screen.queryByTestId("story-tree-expand-all")).toBeNull();
  });

  it("compact 模式选中后详情显示在下方", () => {
    render(<StoryTreeView entries={entries} mode="compact" />);
    fireEvent.click(screen.getByTestId("story-tree-toggle-category:characters"));
    fireEvent.click(screen.getByTestId("story-tree-node-entry:c1"));
    expect(screen.getByTestId("story-tree-inspector")).toBeTruthy();
  });

  it("可按维度裁剪（工具卡只显示相关维度）", () => {
    render(<StoryTreeView entries={entries} dimensions={["discourse"]} />);
    expect(screen.getByTestId("story-tree-row-dimension:discourse")).toBeTruthy();
    expect(screen.queryByTestId("story-tree-row-dimension:story")).toBeNull();
  });

  it("无条目时给出可执行的空态，不是白板", () => {
    render(<StoryTreeView entries={[]} />);
    const empty = screen.getByTestId("story-tree-empty");
    expect(empty.textContent).toContain("还没有条目");
    expect(empty.textContent).toContain("拆书");
  });
});
