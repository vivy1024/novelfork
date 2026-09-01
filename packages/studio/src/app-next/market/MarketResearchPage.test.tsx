import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MarketResearchPage } from "./MarketResearchPage";

vi.mock("@/hooks/use-api", () => ({
  useApi: (path: string) => {
    if (path.startsWith("/market/ranks")) {
      return {
        data: {
          qidian: [{ key: "newbook", name: "新书榜" }],
          fanqie: [{ key: "male_read", name: "男频阅读榜" }],
        },
        loading: false,
        error: null,
        refetch: vi.fn(),
      };
    }
    return {
      data: {
        snapshots: [],
        latest: [],
        ranks: [{
          platform: "qidian",
          rankType: "newbook",
          source: "起点 · 新书榜",
          observedAt: "2026-06-22",
          health: "parse_fail",
          bookCount: 0,
          reason: "起点 · 新书榜 页面拿到了，但榜单结构对不上，这次没有记成有效榜。",
        }],
        analysis: { platform: "qidian", generated_at: "", summary: { total_books: 0, total_snapshots: 0, top_categories: [] }, markdown: "" },
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
  },
}));

vi.mock("@/lib/api-client", () => ({
  fetchJson: vi.fn(async () => ({ ok: true, summary: "扫到 1 个有效榜，共 1 本。榜单数据只留在本机快照，没有写入经纬。" })),
}));

afterEach(() => {
  cleanup();
});

describe("MarketResearchPage", () => {
  it("lets the user scan without an agent", async () => {
    render(<MarketResearchPage />);
    expect(screen.getByTestId("market-research-page")).toBeTruthy();
    expect(screen.getByText("来源与时效")).toBeTruthy();
    expect(screen.getByText(/起点 · 新书榜/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "扫一次并留存" }));
    await waitFor(() => {
      expect(screen.getByText("已留存")).toBeTruthy();
    });
  });
});
