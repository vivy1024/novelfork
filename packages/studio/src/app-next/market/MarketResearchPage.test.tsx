import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchJson } from "@/lib/api-client";
import { MarketResearchPage } from "./MarketResearchPage";

const fetchJsonMock = vi.mocked(fetchJson);
const ranksRefetch = vi.fn();
const snapshotsRefetch = vi.fn();
const lexiconRefetch = vi.fn();

vi.mock("@/hooks/use-api", () => ({
  useApi: (path: string) => {
    if (path.startsWith("/market/ranks")) {
      return {
        data: {
          qidian: [{ key: "newbook", name: "新书榜" }],
          fanqie: [{ key: "male_read", name: "男频阅读榜" }],
          custom: [{ key: "male_collect", name: "男频收藏榜", platform: "fanqie", url: "https://fanqienovel.com/rank/male_collect" }],
        },
        loading: false,
        error: null,
        refetch: ranksRefetch,
      };
    }
    if (path.startsWith("/market/scan-prefs")) {
      return {
        data: { ok: true, prefs: null },
        loading: false,
        error: null,
        refetch: vi.fn(),
      };
    }
    if (path.startsWith("/market/lexicon")) {
      return {
        data: { ok: true, lexicon: { aliases: { 玄幻: ["玄幻", "东方玄幻"], 诸天: ["诸天", "无限"] } } },
        loading: false,
        error: null,
        refetch: lexiconRefetch,
      };
    }
    return {
      data: {
        snapshots: [],
        latest: [{
          snapshot_id: "qidian-newbook-2026-06-22",
          platform: "qidian",
          rank_type: "newbook",
          observed_at: "2026-06-22",
          records: [{
            platform: "qidian",
            book_id: "1001",
            rank_type: "newbook",
            category: "玄幻",
            rank: 1,
            title: "剑来",
            author: "烽火戏诸侯",
            observed_at: "2026-06-22",
            source_status: "ok",
            intro: "一剑开天门",
          }],
        }],
        ranks: [{
          platform: "qidian",
          rankType: "newbook",
          source: "起点 · 新书榜",
          observedAt: "2026-06-22",
          health: "ok",
          bookCount: 1,
          reason: "起点 · 新书榜 2026-06-22 扫到 1 本。",
        }, {
          platform: "fanqie",
          rankType: "male_read",
          source: "番茄 · 男频阅读榜",
          observedAt: "2026-06-22",
          health: "parse_fail",
          bookCount: 0,
          reason: "番茄 · 男频阅读榜 页面拿到了，但榜单结构对不上，这次没有记成有效榜。",
        }],
        analysis: { platform: "qidian", generated_at: "", summary: { total_books: 1, total_snapshots: 1, top_categories: ["玄幻"] }, markdown: "" },
      },
      loading: false,
      error: null,
      refetch: snapshotsRefetch,
    };
  },
}));

vi.mock("@/lib/api-client", () => ({
  fetchJson: vi.fn(async (path: string) => {
    if (String(path).includes("/api/market/scan-prefs")) return { ok: true, prefs: {} };
    if (String(path).includes("/api/market/ranks/custom")) return { ok: true };
    if (String(path).includes("/api/market/lexicon")) return { ok: true, lexicon: { aliases: {} } };
    return { ok: true, summary: "扫到 1 个有效榜，共 1 本。榜单数据只留在本机快照，没有写入经纬。" };
  }),
}));

vi.mock("@/lib/notify", () => ({
  notify: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() },
}));

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: new MemoryStorage() });
  Object.defineProperty(window, "localStorage", { configurable: true, value: globalThis.localStorage });
});

describe("MarketResearchPage", () => {
  it("lets the user scan without an agent", async () => {
    render(<MarketResearchPage />);
    expect(screen.getByTestId("market-research-page")).toBeTruthy();
    expect(screen.getByText(/来源与时效/)).toBeTruthy();
    expect(screen.getAllByText(/番茄 · 男频阅读榜/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "扫一次并留存" }));
    await waitFor(() => {
      expect(screen.getByText("扫榜已完成")).toBeTruthy();
    });
  });

  it("keeps book blurbs and lets the user choose genre plus count before scanning", async () => {
    render(<MarketResearchPage />);
    expect(screen.getByText("一剑开天门")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "玄幻" }));
    fireEvent.change(screen.getByLabelText("每个榜保留多少本"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "扫一次并留存" }));

    await waitFor(() => expect(fetchJsonMock).toHaveBeenCalled());
    const scanCall = fetchJsonMock.mock.calls.find((call) => String(call[0]).includes("/api/market/scan") && !String(call[0]).includes("scan-prefs"));
    expect(scanCall).toBeTruthy();
    const [, init] = scanCall as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      platform: "qidian",
      rankTypes: ["newbook"],
      maxPages: 1,
      categories: ["玄幻"],
      limit: 12,
    });
  });

  it("lets the user add a custom rank and a lexicon alias", async () => {
    render(<MarketResearchPage />);
    expect(screen.getByTestId("market-rank-manager")).toBeTruthy();
    expect(screen.getAllByText("男频收藏榜").length).toBeGreaterThan(0);
    expect(screen.getByTestId("market-lexicon-manager")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("自定义榜 key"), { target: { value: "hotsales_extra" } });
    fireEvent.change(screen.getByLabelText("自定义榜名称"), { target: { value: "额外畅销" } });
    fireEvent.change(screen.getByLabelText("自定义榜 URL"), { target: { value: "https://www.qidian.com/rank/hotsales/" } });
    fireEvent.click(screen.getByRole("button", { name: "添加榜" }));

    await waitFor(() => {
      expect(fetchJsonMock.mock.calls.some((call) => String(call[0]).includes("/api/market/ranks/custom") && (call[1] as RequestInit | undefined)?.method === "POST")).toBe(true);
    });

    fireEvent.change(screen.getByLabelText("词库标准类目"), { target: { value: "诸天" } });
    fireEvent.change(screen.getByLabelText("词库别名"), { target: { value: "无限流" } });
    fireEvent.click(screen.getByRole("button", { name: "添加别名" }));

    await waitFor(() => {
      expect(fetchJsonMock.mock.calls.some((call) => String(call[0]).includes("/api/market/lexicon"))).toBe(true);
    });
  });

  it("renders splitter container, official link, and quantity presets", async () => {
    render(<MarketResearchPage />);
    expect(screen.getByTestId("market-splitter-container")).toBeTruthy();
    expect(screen.getByTestId("market-analysis-panel")).toBeTruthy();

    const bookLink = screen.getByRole("link", { name: /剑来/i });
    expect(bookLink.getAttribute("href")).toBe("https://www.qidian.com/info/1001");
    expect(bookLink.getAttribute("target")).toBe("_blank");

    fireEvent.click(screen.getByRole("button", { name: "50 本" }));
    const input = screen.getByLabelText("每个榜保留多少本") as HTMLInputElement;
    expect(Number(input.value)).toBe(50);

    fireEvent.click(screen.getByRole("button", { name: "清空" }));
    expect(screen.getByText(/已选中 0 个/)).toBeTruthy();
  });
});
