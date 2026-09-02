import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../character-kernel-client", () => ({
  fetchCharacterKernels: vi.fn(async () => []),
}));

import { CharactersAndLoreSidebarPanel } from "./CharactersAndLoreSidebarPanel";
import type { EntityFactLite } from "./CharactersAndLoreSidebarPanel";
import type { WorkbenchResourceNode } from "../useWorkbenchResources";
const capabilities = { open: true, readonly: false, unsupported: false, edit: true, delete: true, apply: false };

function entryNode(title: string, category: string, content = "条目正文"): WorkbenchResourceNode {
  return {
    id: `jingwei-entry:${title}`,
    kind: "jingwei-entry",
    title,
    content,
    capabilities,
    metadata: { category },
  };
}

function characterNode(title: string, aliases: string[] = []): WorkbenchResourceNode {
  return {
    ...entryNode(title, "characters", "角色设定正文"),
    metadata: { category: "characters", aliases },
  };
}

function renderPanel(nodes: readonly WorkbenchResourceNode[], facts: readonly EntityFactLite[], onOpen = vi.fn()) {
  const utils = render(
    <CharactersAndLoreSidebarPanel
      bookId="book-1"
      nodes={nodes}
      facts={facts}
      selectedNodeId={null}
      onOpen={onOpen}
    />,
  );
  return { ...utils, onOpen };
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

describe("CharactersAndLoreSidebarPanel 作品基础分类", () => {
  it("动态推进条目不进入角色册或世界录，势力归入世界录", () => {
    renderPanel(
      [
        characterNode("主角"),
        entryNode("青云宗", "factions"),
        entryNode("第一章摘要", "chapter-summaries"),
        entryNode("悬念伏笔", "foreshadowing"),
      ],
      [],
    );

    expect(screen.getByText("主角")).toBeTruthy();
    expect(screen.queryByText("青云宗")).toBeNull();
    expect(screen.queryByText("第一章摘要")).toBeNull();
    expect(screen.queryByText("悬念伏笔")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /世界录/ }));
    expect(screen.getByText("青云宗")).toBeTruthy();
    expect(screen.queryByText("第一章摘要")).toBeNull();
    expect(screen.queryByText("悬念伏笔")).toBeNull();
  });

  it("按共享分类元数据显示中文标签并支持筛选", () => {
    renderPanel(
      [entryNode("宗门", "factions"), entryNode("青云山", "locations")],
      [],
    );

    fireEvent.click(screen.getByRole("button", { name: /世界录/ }));
    expect(screen.getByTestId("world-category-filter")).toBeTruthy();
    expect(screen.getByRole("button", { name: /势力/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /地点/ })).toBeTruthy();
    expect(screen.getAllByText("势力").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /地点/ }));
    expect(screen.getByText("青云山")).toBeTruthy();
    expect(screen.queryByText("宗门")).toBeNull();
  });
});

describe("CharactersAndLoreSidebarPanel 点击打开", () => {
  it("点击角色卡时以该节点为参数调用 onOpen（由上层 openTab 打开主区 Tab）", () => {
    const node = characterNode("薛行之");
    const { onOpen } = renderPanel([node], []);

    fireEvent.click(screen.getByText("薛行之"));

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(node);
  });

  it("点击世界录条目时同样调用 onOpen", () => {
    const node = entryNode("青云山", "locations");
    const { onOpen } = renderPanel([node], []);

    fireEvent.click(screen.getByRole("button", { name: /世界录/ }));
    fireEvent.click(screen.getByText("青云山"));

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(node);
  });
});
