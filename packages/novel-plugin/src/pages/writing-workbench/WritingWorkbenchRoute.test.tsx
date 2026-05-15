import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WritingWorkbenchRoute } from "./WritingWorkbenchRoute";
import type { WorkbenchResourceNode } from "./useWorkbenchResources";

function resource(overrides: Partial<WorkbenchResourceNode> = {}): WorkbenchResourceNode {
  return {
    id: "chapter:book-1:1",
    kind: "chapter",
    title: "第一章",
    content: "第一章正文",
    path: "chapters/001.md",
    capabilities: { open: true, readonly: false, unsupported: false, edit: true, delete: false, apply: false },
    ...overrides,
  };
}

afterEach(() => cleanup());

describe("WritingWorkbenchRoute", () => {
  it("RED: 发布级作品工作台首屏必须展示作品标题、当前状态和清晰区域", () => {
    const selectedNode = resource();
    const nodes: readonly WorkbenchResourceNode[] = [
      {
        id: "book:book-1",
        kind: "book",
        title: "灵潮纪元",
        capabilities: { open: false, readonly: true, unsupported: false, edit: false, delete: false, apply: false },
        children: [selectedNode],
      },
    ];

    render(
      <WritingWorkbenchRoute
        bookId="book-1"
        nodes={nodes}
        selectedNode={selectedNode}
        onOpen={vi.fn()}
        onSave={vi.fn()}
        writingActions={<div>写作动作占位</div>}
      />,
    );

    const route = screen.getByTestId("writing-workbench-route");
    expect(within(route).getByRole("heading", { name: "灵潮纪元" })).toBeTruthy();
    expect(within(route).getByText("当前状态：资源已加载")).toBeTruthy();
    expect(within(route).getByRole("region", { name: "资源树" })).toBeTruthy();
    expect(within(route).getByRole("region", { name: "当前资源画布" })).toBeTruthy();
    expect(within(route).getByRole("region", { name: "写作动作" })).toBeTruthy();
  });
});
