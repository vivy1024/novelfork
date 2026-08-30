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
      data: { snapshots: [], analysis: { platform: "qidian", generated_at: "", summary: { total_books: 0, total_snapshots: 0, top_categories: [] }, markdown: "" } },
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
  },
}));

vi.mock("@/lib/api-client", () => ({
  fetchJson: vi.fn(async () => ({ ok: true, summary: "已扫描 1 个榜单快照，并写入 ~/.novelfork/market/snapshots/。" })),
}));

afterEach(() => {
  cleanup();
});

describe("MarketResearchPage", () => {
  it("lets the user scan without an agent", async () => {
    render(<MarketResearchPage />);
    expect(screen.getByTestId("market-research-page")).toBeTruthy();
    expect(screen.getByText("还没有快照")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "扫一次并留存" }));
    await waitFor(() => {
      expect(screen.getByText("已留存")).toBeTruthy();
    });
  });
});
