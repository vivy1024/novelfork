import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchJson = vi.fn();

vi.mock("@/hooks/use-api", () => ({
  fetchJson: (...args: unknown[]) => fetchJson(...args),
  ApiRequestError: class ApiRequestError extends Error {
    status?: number;
    constructor(message: string, status?: number) {
      super(message);
      this.status = status;
    }
  },
}));

import { CanonicalTreesPanel } from "./CanonicalTreesPanel";

const entries = [
  { id: "c1", category: "characters", title: "薛行之", fields: { name: "薛行之", roleType: "主角" } },
  { id: "c2", category: "characters", title: "方工", fields: { name: "方工", roleType: "对手" } },
  { id: "l1", category: "locations", title: "灵科院西京分院", fields: { name: "灵科院西京分院" } },
  { id: "s1", category: "chapter-summaries", title: "第 1 章 归档", fields: { chapterNumber: 1 } },
  {
    id: "o1",
    category: "outline",
    title: "卷纲",
    fields: { volumes: [{ id: "vol-1", title: "西京篇", chapterRange: { from: 1, to: 2 }, status: "active" }] },
  },
];

const XUE = "ent:book-1:c1";
const FANG = "ent:book-1:c2";

/** 人物关系网的两个接口：实体概况 + 焦点网络（按实体 id）。 */
function entityGraph(url: string): unknown {
  if (url.includes("/entity-graph/entities")) {
    return {
      ok: true,
      status: "ok",
      stats: { entities: 2, relations: 1, participations: 0, latestChapter: 2 },
      defaultFocusId: XUE,
      entities: [
        { id: XUE, entryId: "c1", name: "薛行之", type: "character", relationCount: 1 },
        { id: FANG, entryId: "c2", name: "方工", type: "character", relationCount: 1 },
      ],
    };
  }
  return {
    ok: true,
    status: "ok",
    network: {
      focusId: XUE,
      hops: 1,
      chapter: null,
      nodes: [
        { id: XUE, entryId: "c1", name: "薛行之", type: "character", hop: 0, via: null, degree: 1 },
        { id: FANG, entryId: "c2", name: "方工", type: "character", hop: 1, via: null, degree: 1 },
      ],
      edges: [{
        id: `edge:${XUE}->${FANG}`, source: XUE, target: FANG, predicates: ["协作"], relationCount: 1, latestPredicate: "协作",
        latestPolarity: { score: 1, label: "友好", keyword: "协作" }, sharedEvents: 1, trend: "insufficient",
      }],
      omitted: 0,
    },
  };
}

beforeEach(() => {
  fetchJson.mockReset();
  fetchJson.mockImplementation(async (url: string) => {
    if (url.includes("/entity-graph/")) return entityGraph(url);
    if (url.includes("narrative-memory/graph")) {
      return {
        facts: [],
        events: [
          { id: "e1", chapterNumber: 1, subject: "薛行之", predicate: "接手", object: "异常", eventType: "character_state_changed" },
        ],
        cooccurrence: {
          edges: [
            { source: "薛行之", target: "方工", weight: 0.9, coCount: 4 },
            { source: "薛行之", target: "灵科院西京分院", weight: 0.5, coCount: 2 },
          ],
        },
      };
    }
    return { entries };
  });
});

afterEach(() => {
  cleanup();
});

describe("CanonicalTreesPanel 四张正图", () => {
  it("默认打开世界观，tidy-tree 画出 NarraBench 层级", async () => {
    render(<CanonicalTreesPanel bookId="book-1" />);
    await waitFor(() => expect(screen.getByTestId("canonical-trees-panel")).toBeTruthy());
    expect(screen.getByTestId("tidy-tree-canvas").getAttribute("data-kind")).toBe("worldview");
    expect(screen.getByTestId("tidy-tree-row-dimension:story")).toBeTruthy();
  });

  it("人物关系页签画按实体 id 连边的焦点网络，不再是共现生成树", async () => {
    render(<CanonicalTreesPanel bookId="book-1" />);
    await waitFor(() => expect(screen.getByTestId("canonical-trees-panel")).toBeTruthy());
    expect(screen.getByTestId("canonical-tree-tab-relations").textContent).toBe("人物关系");
    fireEvent.click(screen.getByTestId("canonical-tree-tab-relations"));
    await waitFor(() => expect(screen.getByTestId(`relation-node-${XUE}`)).toBeTruthy());
    expect(screen.queryByTestId("tidy-tree-canvas")).toBeNull();
    expect(screen.getByTestId(`relation-node-${FANG}`).textContent).toContain("方工");
    // 共现里的事件短语不会出现在关系网里
    expect(screen.queryByText("自费转诊")).toBeNull();
    // 关系网不是树：不显示「N 项」与节点搜索
    expect(screen.queryByLabelText("搜索正图")).toBeNull();
  });

  it("章节图按卷纲分叉，占位章不假装已写", async () => {
    render(<CanonicalTreesPanel bookId="book-1" />);
    await waitFor(() => expect(screen.getByTestId("canonical-trees-panel")).toBeTruthy());
    fireEvent.click(screen.getByTestId("canonical-tree-tab-chapters"));
    expect(screen.getByText("西京篇")).toBeTruthy();
    expect(screen.getByTestId("tidy-tree-row-chapter:1")).toBeTruthy();
    expect(screen.getByTestId("tidy-tree-row-chapter:2")).toBeTruthy();
  });

  it("发展历程按章挂事件", async () => {
    render(<CanonicalTreesPanel bookId="book-1" />);
    await waitFor(() => expect(screen.getByTestId("canonical-trees-panel")).toBeTruthy());
    fireEvent.click(screen.getByTestId("canonical-tree-tab-timeline"));
    expect(screen.getByTestId("tidy-tree-canvas").getAttribute("data-kind")).toBe("timeline");
    expect(screen.getByTestId("tidy-tree-row-chapter:1")).toBeTruthy();
    expect(screen.getByTestId("tidy-tree-row-event:e1")).toBeTruthy();
  });

  it("章节脉络分表世界和里世界两枝", async () => {
    render(<CanonicalTreesPanel bookId="book-1" />);
    await waitFor(() => expect(screen.getByTestId("canonical-trees-panel")).toBeTruthy());
    fireEvent.click(screen.getByTestId("canonical-tree-tab-chronicle"));
    expect(screen.getByTestId("tidy-tree-canvas").getAttribute("data-kind")).toBe("chronicle");
    expect(screen.getByTestId("tidy-tree-row-chronicle:surface")).toBeTruthy();
    expect(screen.getByTestId("tidy-tree-row-chronicle:inner")).toBeTruthy();
  });

  it("独立入口可关掉切换条", async () => {
    render(<CanonicalTreesPanel bookId="book-1" initialKind="timeline" showSwitcher={false} />);
    await waitFor(() => expect(screen.getByTestId("canonical-trees-panel")).toBeTruthy());
    expect(screen.queryByTestId("canonical-tree-tab-worldview")).toBeNull();
    expect(screen.getByTestId("tidy-tree-canvas").getAttribute("data-kind")).toBe("timeline");
  });

  it("总图挂世界观与章节两棵浅层，不再挂共现关系树", async () => {
    render(<CanonicalTreesPanel bookId="book-1" />);
    await waitFor(() => expect(screen.getByTestId("canonical-trees-panel")).toBeTruthy());
    fireEvent.click(screen.getByTestId("canonical-tree-tab-overview"));
    expect(screen.getByTestId("tidy-tree-canvas").getAttribute("data-kind")).toBe("overview");
    expect(screen.queryByTestId("tidy-tree-row-overview:relations")).toBeNull();
    expect(screen.getByTestId("tidy-tree-row-overview:worldview")).toBeTruthy();
    expect(screen.getByTestId("tidy-tree-row-overview:chapters")).toBeTruthy();
  });

  it("关系网里的人物可打开经纬条目或实体资料卡（带条目 id）", async () => {
    const onOpenEntry = vi.fn();
    const onOpenEntity = vi.fn();
    render(<CanonicalTreesPanel bookId="book-1" onOpenEntry={onOpenEntry} onOpenEntity={onOpenEntity} />);
    await waitFor(() => expect(screen.getByTestId("canonical-trees-panel")).toBeTruthy());
    fireEvent.click(screen.getByTestId("canonical-tree-tab-relations"));
    fireEvent.click(await waitFor(() => screen.getByTestId(`relation-node-${XUE}`)));
    fireEvent.click(await waitFor(() => screen.getByTestId("relation-node-open-entry")));
    expect(onOpenEntry).toHaveBeenCalledWith("c1", "薛行之");
    fireEvent.click(screen.getByTestId("relation-node-open-entity"));
    expect(onOpenEntity).toHaveBeenCalledWith("薛行之", "c1");
  });

  it("缩放按钮生效；视口按作品与视图记住，重新打开回到原处", async () => {
    // Node 25 自带的全局 localStorage 在没有 --localstorage-file 时不可用，会盖住 jsdom 的实现。
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    });
    const first = render(<CanonicalTreesPanel bookId="book-1" />);
    const canvas = await waitFor(() => screen.getByTestId("tidy-tree-canvas"));
    await waitFor(() => expect(canvas.getAttribute("data-zoom")).toBe("1.00"));
    fireEvent.click(screen.getByTestId("tidy-tree-zoom-in"));
    await waitFor(() => expect(canvas.getAttribute("data-zoom")).toBe("1.20"));
    expect(screen.getByTestId("tidy-tree-zoom-label").textContent).toBe("120%");
    await waitFor(() => expect(localStorage.getItem("novelfork:canvas-viewport:book-1:worldview")).toContain("\"zoom\":1.2"));
    first.unmount();

    render(<CanonicalTreesPanel bookId="book-1" />);
    const reopened = await waitFor(() => screen.getByTestId("tidy-tree-canvas"));
    await waitFor(() => expect(reopened.getAttribute("data-zoom")).toBe("1.20"));
    // 别的书、别的视图各记各的
    expect(localStorage.getItem("novelfork:canvas-viewport:book-2:worldview")).toBeNull();
    vi.unstubAllGlobals();
  });

  it("共现接口失败时降级提示，不挡世界观", async () => {
    fetchJson.mockImplementation(async (url: string) => {
      if (url.includes("narrative-memory/graph")) throw new Error("graph down");
      return { entries };
    });
    render(<CanonicalTreesPanel bookId="book-1" />);
    await waitFor(() => expect(screen.getByTestId("canonical-trees-degraded")).toBeTruthy());
  });

  it("kinds 属性支持按镜头精确筛选展示的子树集合", async () => {
    // 模拟理镜头：只看世界观与人物关系
    render(<CanonicalTreesPanel bookId="book-1" kinds={["worldview", "relations"]} />);
    await waitFor(() => expect(screen.getByTestId("canonical-trees-panel")).toBeTruthy());

    expect(screen.getByTestId("canonical-tree-tab-worldview")).toBeTruthy();
    expect(screen.getByTestId("canonical-tree-tab-relations")).toBeTruthy();
    expect(screen.queryByTestId("canonical-tree-tab-chapters")).toBeNull();
    expect(screen.queryByTestId("canonical-tree-tab-causal")).toBeNull();
    expect(screen.queryByTestId("canonical-tree-tab-timeline")).toBeNull();
    expect(screen.queryByTestId("canonical-tree-tab-overview")).toBeNull();
  });
});
