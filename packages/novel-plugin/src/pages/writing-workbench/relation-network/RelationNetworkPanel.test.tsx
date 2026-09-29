// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchJson = vi.fn();

vi.mock("@/hooks/use-api", () => ({
  fetchJson: (...args: unknown[]) => fetchJson(...args),
}));

import { layoutEgoNetwork } from "./relation-network-layout";
import { RelationNetworkPanel } from "./RelationNetworkPanel";

const XUE = "ent:book-1:c1";
const FANG = "ent:book-1:c2";
const SHEN = "ent:book-1:c3";

const entitiesOk = {
  ok: true,
  status: "ok",
  stats: { entities: 3, relations: 2, participations: 4, latestChapter: 15 },
  defaultFocusId: XUE,
  entities: [
    { id: XUE, entryId: "c1", name: "薛行之", type: "character", relationCount: 2 },
    { id: FANG, entryId: "c2", name: "方工", type: "character", relationCount: 1 },
    { id: SHEN, entryId: "c3", name: "沈遥", type: "character", relationCount: 1 },
  ],
};

function node(id: string, name: string, hop: 0 | 1 | 2, via: string | null = null) {
  return { id, entryId: id.split(":").pop(), name, type: "character", hop, via, degree: 1 };
}

function edge(source: string, target: string, predicate: string, label = "友好") {
  return {
    id: `edge:${source}->${target}`, source, target, predicates: [predicate], relationCount: 1, latestPredicate: predicate,
    latestPolarity: { score: 1, label, keyword: null }, sharedEvents: 2, trend: "insufficient",
  };
}

function networkFor(focus: string) {
  return {
    ok: true,
    status: "ok",
    network: {
      focusId: focus,
      hops: 1,
      chapter: null,
      nodes: focus === XUE
        ? [node(XUE, "薛行之", 0), node(FANG, "方工", 1), node(SHEN, "沈遥", 1)]
        : [node(FANG, "方工", 0), node(XUE, "薛行之", 1)],
      edges: focus === XUE
        ? [edge(XUE, FANG, "作保与连带同盟关系", "紧密"), edge(XUE, SHEN, "安全判断共识")]
        : [edge(FANG, XUE, "作保与连带同盟关系", "紧密")],
      omitted: 0,
    },
  };
}

const pairBody = {
  ok: true,
  status: "ok",
  history: [
    { relationId: "r1", subjectId: XUE, objectId: FANG, predicate: "事故复核协作关系", validFrom: 12, validTo: null, active: true, evidence: "先做七天事故复核协作", polarity: { score: 1, label: "友好", keyword: "协作" } },
    { relationId: "r2", subjectId: FANG, objectId: XUE, predicate: "作保与连带同盟关系", validFrom: 15, validTo: null, active: true, evidence: "改一个字，我都保不住你", polarity: { score: 2, label: "紧密", keyword: "同盟" } },
  ],
  trend: { kind: "warming", label: "升温", explanation: "亲疏一路走近：第 12 章「事故复核协作关系」(友好) → 第 15 章「作保与连带同盟关系」(紧密)。" },
  sharedEvents: 2,
  common: [],
};

function routeWith(overrides: { entities?: unknown } = {}) {
  fetchJson.mockImplementation(async (url: string) => {
    if (url.includes("/entity-graph/entities")) return overrides.entities ?? entitiesOk;
    if (url.includes("/entity-graph/network")) {
      const focus = new URL(url, "http://x").searchParams.get("focus") ?? XUE;
      return networkFor(focus);
    }
    if (url.includes("/entity-graph/pair")) return pairBody;
    if (url.includes("/entity-index/rebuild")) return { ok: true, summary: "实体 3 个，关系边 2 条。" };
    throw new Error(`unexpected ${url}`);
  });
}

beforeEach(() => {
  fetchJson.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("人物关系网", () => {
  it("默认以关系最多的人为焦点，画出一跳关系人", async () => {
    routeWith();
    render(<RelationNetworkPanel bookId="book-1" />);
    await waitFor(() => expect(screen.getByTestId(`relation-node-${XUE}`)).toBeTruthy());
    expect(screen.getByTestId(`relation-node-${XUE}`).getAttribute("data-hop")).toBe("0");
    expect(screen.getByTestId(`relation-node-${FANG}`).textContent).toContain("方工");
    expect(screen.getByTestId(`relation-node-${SHEN}`)).toBeTruthy();
    const networkCall = fetchJson.mock.calls.map(([url]) => String(url)).find((url) => url.includes("/network?"))!;
    expect(networkCall).toContain(`focus=${encodeURIComponent(XUE)}`);
    expect(networkCall).toContain("hops=1");
  });

  it("切 2 跳、选截至第 N 章都带进查询", async () => {
    routeWith();
    render(<RelationNetworkPanel bookId="book-1" />);
    await waitFor(() => expect(screen.getByTestId(`relation-node-${XUE}`)).toBeTruthy());
    fireEvent.click(screen.getByTestId("relation-network-hops-2"));
    await waitFor(() => expect(fetchJson.mock.calls.some(([url]) => String(url).includes("hops=2"))).toBe(true));
    fireEvent.change(screen.getByTestId("relation-network-chapter"), { target: { value: "12" } });
    await waitFor(() => expect(fetchJson.mock.calls.some(([url]) => String(url).includes("/network?") && String(url).includes("chapter=12"))).toBe(true));
    expect(fetchJson.mock.calls.some(([url]) => String(url).includes("/entities?chapter=12"))).toBe(true);
  });

  it("点人物看资料，可设为焦点、打开资料卡与经纬条目", async () => {
    routeWith();
    const onOpenEntity = vi.fn();
    const onOpenEntry = vi.fn();
    render(<RelationNetworkPanel bookId="book-1" onOpenEntity={onOpenEntity} onOpenEntry={onOpenEntry} />);
    await waitFor(() => expect(screen.getByTestId(`relation-node-${FANG}`)).toBeTruthy());
    fireEvent.click(screen.getByTestId(`relation-node-${FANG}`));
    const inspector = await waitFor(() => screen.getByTestId("relation-node-inspector"));
    fireEvent.click(within(inspector).getByTestId("relation-node-open-entity"));
    expect(onOpenEntity).toHaveBeenCalledWith("方工", "c2");
    fireEvent.click(within(inspector).getByTestId("relation-node-open-entry"));
    expect(onOpenEntry).toHaveBeenCalledWith("c2", "方工");

    fireEvent.click(within(inspector).getByTestId("relation-node-set-focus"));
    await waitFor(() => expect(screen.getByTestId(`relation-node-${FANG}`).getAttribute("data-hop")).toBe("0"));
    expect((screen.getByTestId("relation-network-focus") as HTMLSelectElement).value).toBe(FANG);
  });

  it("双击人物直接换焦点", async () => {
    routeWith();
    render(<RelationNetworkPanel bookId="book-1" />);
    await waitFor(() => expect(screen.getByTestId(`relation-node-${FANG}`)).toBeTruthy());
    fireEvent.click(screen.getByTestId(`relation-node-${FANG}`));
    fireEvent.click(screen.getByTestId(`relation-node-${FANG}`));
    await waitFor(() => expect(screen.getByTestId(`relation-node-${FANG}`).getAttribute("data-hop")).toBe("0"));
  });

  it("选一条关系看关系史、证据、走向；证据章节可打开", async () => {
    routeWith();
    const onOpenChapter = vi.fn();
    render(<RelationNetworkPanel bookId="book-1" onOpenChapter={onOpenChapter} />);
    await waitFor(() => expect(screen.getByTestId(`relation-node-${XUE}`)).toBeTruthy());
    fireEvent.click(screen.getByTestId(`relation-node-${XUE}`));
    fireEvent.click(await waitFor(() => screen.getByTestId(`relation-node-edge-${FANG}`)));
    const inspector = await waitFor(() => screen.getByTestId("relation-edge-inspector"));
    await waitFor(() => expect(within(inspector).getAllByTestId("relation-history-item")).toHaveLength(2));
    expect(within(inspector).getByTestId("relation-trend").textContent).toContain("升温");
    expect(inspector.textContent).toContain("改一个字，我都保不住你");
    const pairCall = fetchJson.mock.calls.map(([url]) => String(url)).find((url) => url.includes("/pair?"))!;
    expect(pairCall).toContain(`a=${encodeURIComponent(XUE)}`);
    expect(pairCall).toContain(`b=${encodeURIComponent(FANG)}`);
    fireEvent.click(within(inspector).getByText(/第 12 章起/));
    expect(onOpenChapter).toHaveBeenCalledWith(12);
  });

  it("实体索引为空时给带说明的空状态，并能重建索引", async () => {
    let built = false;
    fetchJson.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/entity-index/rebuild")) {
        expect(init?.method).toBe("POST");
        built = true;
        return { ok: true, summary: "实体 3 个，关系边 2 条。" };
      }
      if (url.includes("/entity-graph/entities")) {
        return built ? entitiesOk : {
          ok: true,
          status: "empty",
          reason: "index-empty",
          explanation: { whatHappened: "这本书的实体索引还是空的。", whyItMatters: "关系图只认经纬条目。", suggestedAction: "先结算章节，或点「重建索引」。" },
          stats: { entities: 0, relations: 0, participations: 0, latestChapter: null },
          defaultFocusId: null,
          entities: [],
        };
      }
      if (url.includes("/entity-graph/network")) return networkFor(XUE);
      throw new Error(`unexpected ${url}`);
    });
    render(<RelationNetworkPanel bookId="book-1" />);
    const empty = await waitFor(() => screen.getByTestId("relation-network-empty"));
    expect(within(empty).getByTestId("relation-network-empty-explanation").textContent).toContain("实体索引还是空的");
    fireEvent.click(within(empty).getByTestId("relation-network-rebuild"));
    await waitFor(() => expect(screen.getByTestId(`relation-node-${XUE}`)).toBeTruthy());
    expect(screen.getByTestId("relation-network-rebuild-message").textContent).toContain("关系边 2 条");
  });

  it("焦点孤立时在画布上说明原因", async () => {
    routeWith();
    fetchJson.mockImplementation(async (url: string) => {
      if (url.includes("/entity-graph/entities")) return entitiesOk;
      return {
        ok: true,
        status: "ok",
        network: { focusId: XUE, hops: 1, chapter: null, nodes: [node(XUE, "薛行之", 0)], edges: [], omitted: 0 },
        notice: { whatHappened: "「薛行之」目前没有成立的关系。", whyItMatters: "同场出现不算关系。", suggestedAction: "换一个焦点人物。" },
      };
    });
    render(<RelationNetworkPanel bookId="book-1" />);
    await waitFor(() => expect(screen.getByTestId("relation-network-notice").textContent).toContain("目前没有成立的关系"));
  });
});

describe("确定性布局", () => {
  it("焦点居中、一跳在内圈、二跳在外圈且靠近经由的一跳；同样的输入同样的坐标", () => {
    const network = {
      focusId: "f",
      nodes: [
        { id: "f", entryId: null, name: "焦点", type: "character", hop: 0 as const, via: null, degree: 2 },
        { id: "a", entryId: null, name: "甲", type: "character", hop: 1 as const, via: null, degree: 2 },
        { id: "b", entryId: null, name: "乙", type: "character", hop: 1 as const, via: null, degree: 1 },
        { id: "c", entryId: null, name: "丙", type: "character", hop: 2 as const, via: "a", degree: 1 },
      ],
      edges: [],
    };
    const first = layoutEgoNetwork(network);
    expect(first.get("f")).toEqual({ x: 0, y: 0 });
    const radius = (id: string) => Math.hypot(first.get(id)!.x, first.get(id)!.y);
    expect(radius("a")).toBeCloseTo(radius("b"));
    expect(radius("c")).toBeGreaterThan(radius("a"));
    // 甲在 12 点方向，丙也在甲的方向上
    expect(first.get("a")!.y).toBeLessThan(0);
    expect(first.get("c")!.y).toBeLessThan(0);
    expect(layoutEgoNetwork(network)).toEqual(first);
  });
});
