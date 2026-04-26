import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RadarView } from "./RadarView";

const { useApiMock, fetchJsonMock } = vi.hoisted(() => ({
  useApiMock: vi.fn(),
  fetchJsonMock: vi.fn(),
}));

vi.mock("../hooks/use-api", () => ({
  useApi: (...args: unknown[]) => useApiMock(...args),
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

const t = (key: string) => {
  const map: Record<string, string> = {
    "radar.title": "市场雷达",
    "radar.scanning": "扫描中...",
    "radar.scan": "扫描市场",
    "radar.summary": "市场概要",
    "radar.emptyHint": "点击扫描",
  };
  return map[key] ?? key;
};

describe("RadarView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useApiMock.mockImplementation((path: string) => {
      if (path === "/books") {
        return {
          data: { books: [{ id: "book-1", title: "长夜书" }] },
          loading: false,
          error: null,
          refetch: vi.fn(),
        };
      }
      return { data: null, loading: false, error: null, refetch: vi.fn() };
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("persists radar results into the selected book review area", async () => {
    fetchJsonMock.mockResolvedValue({
      marketSummary: "番茄都市强势，轻悬疑有机会。",
      recommendations: [
        {
          confidence: 0.82,
          platform: "番茄",
          genre: "都市悬疑",
          concept: "律师破局流",
          reasoning: "短平快、反转密度高。",
          benchmarkTitles: ["样书 A"],
        },
      ],
      persisted: {
        bookId: "book-1",
        file: "market_radar.md",
        path: "books/book-1/story/market_radar.md",
        savedAt: "2026-04-25T00:00:00.000Z",
      },
    });

    const toTruth = vi.fn();
    render(
      <RadarView
        nav={{ toDashboard: vi.fn(), toImport: vi.fn(), toTruth }}
        theme="light"
        t={t}
      />,
    );

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "book-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "扫描并收口" }));

    await waitFor(() => {
      expect(fetchJsonMock).toHaveBeenCalledWith(
        "/radar/scan",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ bookId: "book-1" }),
        }),
      );
    });

    expect(await screen.findByText("已收口到作者结果区")).toBeTruthy();
    expect(screen.getByText("books/book-1/story/market_radar.md")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: "打开结果文件" })[0]!);
    expect(toTruth).toHaveBeenCalledWith("book-1");
  });

  it("keeps scan ephemeral when no target book is selected", async () => {
    fetchJsonMock.mockResolvedValue({
      marketSummary: "仅即时查看",
      recommendations: [],
    });

    render(
      <RadarView
        nav={{ toDashboard: vi.fn() }}
        theme="light"
        t={t}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "扫描并收口" }));

    await waitFor(() => {
      expect(fetchJsonMock).toHaveBeenCalledWith(
        "/radar/scan",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({}),
        }),
      );
    });

    expect(screen.queryByText("已收口到作者结果区")).toBeNull();
    expect(await screen.findByText("仅即时查看")).toBeTruthy();
  });
});
