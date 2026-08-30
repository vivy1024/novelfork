import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@/hooks/use-api", () => ({
  fetchJson: vi.fn(),
}));

import { ChronicleHelixCanvas } from "./ChronicleHelixCanvas";

const { fetchJson } = await import("@/hooks/use-api") as { fetchJson: ReturnType<typeof vi.fn> };

function mockResponses(summaries: unknown, graph: unknown) {
  fetchJson.mockImplementation((url: string) => {
    if (String(url).includes("chapter-summaries")) return Promise.resolve(summaries);
    if (String(url).includes("narrative-memory/graph")) return Promise.resolve(graph);
    return Promise.reject(new Error(`unexpected url ${url}`));
  });
}

const HTMLCanvasElementPrototype = HTMLCanvasElement.prototype as unknown as {
  getContext: (contextId: string) => Record<string, never> | null;
};

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom 无 2d context：用 Proxy 返回任意方法的 no-op，属性赋值静默通过。
  const noopContext = new Proxy({}, {
    get: () => () => undefined,
    set: () => true,
  }) as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElementPrototype, "getContext").mockReturnValue(noopContext);
});

// 本包 vitest 未开 globals，RTL 自动清理不生效，需手动 cleanup 防跨测试残留。
afterEach(() => {
  cleanup();
});

describe("ChronicleHelixCanvas", () => {
  it("shows the no-book hint when bookId is missing", async () => {
    render(<ChronicleHelixCanvas />);
    expect(await screen.findByTestId("chronicle-helix-empty")).toBeTruthy();
  });

  it("renders loading state while data is in flight", async () => {
    fetchJson.mockImplementation(() => new Promise(() => undefined));
    render(<ChronicleHelixCanvas bookId="book-1" />);
    expect(await screen.findByTestId("chronicle-helix-loading")).toBeTruthy();
  });

  it("renders empty-data honest state and legend after successful fetch", async () => {
    mockResponses({ entries: [] }, {});
    render(<ChronicleHelixCanvas bookId="book-1" />);
    expect(await screen.findByTestId("chronicle-helix-canvas")).toBeTruthy();
    expect(await screen.findByText(/还没有可编织的章节摘要或事件/)).toBeTruthy();
    expect(screen.getByText("表世界（章面）")).toBeTruthy();
    expect(screen.getByText("里世界（角色内在）")).toBeTruthy();
  });

  it("requests the graph via event_chain view so arc events are not filtered out", async () => {
    mockResponses({ entries: [] }, { events: [] });
    render(<ChronicleHelixCanvas bookId="book-1" />);
    await screen.findByTestId("chronicle-helix-canvas");
    const graphCall = fetchJson.mock.calls.find(([url]) => String(url).includes("narrative-memory/graph"));
    expect(graphCall).toBeTruthy();
    expect(String(graphCall?.[0])).toContain("view=event_chain");
    expect(String(graphCall?.[0])).not.toContain("view=timeline");
  });

  it("surfaces error with retry on fetch failure", async () => {
    fetchJson.mockRejectedValue(new Error("network down"));
    render(<ChronicleHelixCanvas bookId="book-1" />);
    expect(await screen.findByTestId("chronicle-helix-error")).toBeTruthy();
    // 每轮加载并发两条链（摘要+事件流），重试后再发两请求 → 共 4 次。
    fireEvent.click(screen.getByRole("button", { name: /重试/ }));
    await waitFor(() => expect(fetchJson).toHaveBeenCalledTimes(4));
  });

  it("shows ready canvas with data and inspector guidance", async () => {
    mockResponses(
      { entries: [{ fields: { chapterNumber: 1, summary: "开局", tension_score: 9 }, contentMd: "开局正文" }] },
      { events: [{ subject: "薛行之", eventType: "character_state_changed", chapterNumber: 1, subjectEntryId: "entry-x", evidenceText: "初次觉醒" }] },
    );
    render(<ChronicleHelixCanvas bookId="book-1" currentChapter={1} onOpenEntityDetail={vi.fn()} />);

    const scroll = await screen.findByTestId("chronicle-helix-scroll");
    // 容器作用域查询，避免跨测试残留节点干扰。
    expect(within(scroll).getAllByRole("img", { name: /里世界与表世界对照条/ }).length).toBeGreaterThan(0);
    // 检查器默认是阅读指南
    expect(await screen.findByText(/如何阅读这张图/)).toBeTruthy();
    // B 链必须走 event_chain 视图（timeline 视图不含角色状态/关系变化事件）。
    expect(fetchJson).toHaveBeenCalledWith(expect.stringContaining("narrative-memory/graph?view=event_chain"));
  });

  it("F1 图例聚焦：点击角色徽标进入单角色聚焦，再点取消", async () => {
    mockResponses(
      { entries: [{ fields: { chapterNumber: 1, summary: "开局" }, contentMd: "开局正文" }] },
      {
        events: [
          { subject: "薛行之", eventType: "character_state_changed", chapterNumber: 1, evidenceText: "觉醒" },
          { subject: "方工", eventType: "character_state_changed", chapterNumber: 1, evidenceText: "盯上波形" },
        ],
      },
    );
    render(<ChronicleHelixCanvas bookId="book-1" />);

    const xue = await screen.findByTestId("chronicle-focus-薛行之");
    const fang = screen.getByTestId("chronicle-focus-方工");
    expect(screen.queryByTestId("chronicle-focus-active")).toBeNull();

    // 点击进入聚焦
    fireEvent.click(xue);
    expect(xue.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("chronicle-focus-active").textContent).toContain("薛行之");

    // 切换聚焦到另一角色
    fireEvent.click(fang);
    expect(fang.getAttribute("aria-pressed")).toBe("true");
    expect(xue.getAttribute("aria-pressed")).toBe("false");

    // 再点取消
    fireEvent.click(fang);
    expect(fang.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByTestId("chronicle-focus-active")).toBeNull();
  });
});
