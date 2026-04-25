import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const useApiMock = vi.fn();
const postApiMock = vi.fn();

vi.mock("../hooks/use-api", () => ({
  useApi: (...args: unknown[]) => useApiMock(...args),
  postApi: (...args: unknown[]) => postApiMock(...args),
}));

import { DetectView } from "./DetectView";

describe("DetectView AI gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useApiMock.mockImplementation((path: string) => {
      if (path === "/books/book-1/detect/stats") {
        return {
          data: { totalChapters: 12, averageScore: 55, highRiskCount: 2 },
          loading: false,
          error: null,
          refetch: vi.fn(),
        };
      }
      if (path === "/providers/status") {
        return {
          data: { status: { hasUsableModel: false } },
          loading: false,
          error: null,
          refetch: vi.fn(),
        };
      }
      return { data: null, loading: false, error: null, refetch: vi.fn() };
    });
  });

  afterEach(() => cleanup());

  it("blocks deep scan when no model is configured", async () => {
    render(
      <DetectView
        bookId="book-1"
        nav={{ toBook: vi.fn(), toDashboard: vi.fn(), toAdmin: vi.fn() }}
        theme="light"
        t={((key: string) => key) as never}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "全书扫描" }));

    expect(await screen.findByText("此功能需要配置 AI 模型")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(postApiMock).not.toHaveBeenCalledWith("/books/book-1/detect-all", undefined);
  });
});
