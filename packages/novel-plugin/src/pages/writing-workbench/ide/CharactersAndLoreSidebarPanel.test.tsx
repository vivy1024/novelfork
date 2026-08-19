import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CharactersAndLoreSidebarPanel } from "./CharactersAndLoreSidebarPanel";
import type { EntityFactLite } from "./CharactersAndLoreSidebarPanel";
import type { WorkbenchResourceNode } from "../useWorkbenchResources";

const capabilities = { open: true, readonly: false, unsupported: false, edit: true, delete: true, apply: false };

function characterNode(title: string, aliases: string[] = []): WorkbenchResourceNode {
  return {
    id: `jingwei-entry:${title}`,
    kind: "jingwei-entry",
    title,
    content: "角色设定正文",
    capabilities,
    metadata: { category: "characters", aliases },
  };
}

function renderPanel(nodes: readonly WorkbenchResourceNode[], facts: readonly EntityFactLite[]) {
  return render(
    <CharactersAndLoreSidebarPanel
      bookId="book-1"
      nodes={nodes}
      facts={facts}
      selectedNodeId={null}
      onOpen={vi.fn()}
    />,
  );
}

afterEach(() => cleanup());

describe("CharactersAndLoreSidebarPanel 时态事实", () => {
  it("按标题匹配事实，优先展示位置/状态类且最多三条", () => {
    renderPanel(
      [characterNode("林舟")],
      [
        { subject: "林舟", predicate: "性格", object: "谨慎" },
        { subject: "林舟", predicate: "位置", object: "青云镇" },
        { subject: "林舟", predicate: "伤势", object: "左臂骨折" },
        { subject: "林舟", predicate: "境界", object: "筑基" },
        { subject: "林舟", predicate: "关系", object: "韩立" },
      ],
    );

    const facts = screen.getByTestId("character-temporal-facts");
    expect(within(facts).getByText("位置: 青云镇")).toBeTruthy();
    expect(within(facts).getByText("伤势: 左臂骨折")).toBeTruthy();
    expect(within(facts).getByText("境界: 筑基")).toBeTruthy();
    expect(within(facts).queryByText("关系: 韩立")).toBeNull();
    expect(within(facts).getAllByTestId("character-temporal-fact")).toHaveLength(3);
  });

  it("标题没有命中时按角色别名匹配", () => {
    renderPanel(
      [characterNode("林舟（化名）", ["林舟"])],
      [{ subject: "林舟", predicate: "状态", object: "潜伏中" }],
    );

    expect(screen.getByText("状态: 潜伏中")).toBeTruthy();
  });

  it("没有匹配事实时不渲染空的时态区域", () => {
    renderPanel([characterNode("无事实角色")], []);

    expect(screen.queryByTestId("character-temporal-facts")).toBeNull();
  });
});
