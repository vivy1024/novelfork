import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({
  fetchJsonImpl: undefined as undefined | ((path: string) => Promise<unknown>),
}));

vi.mock("@/hooks/use-api", () => ({
  ApiRequestError: class ApiRequestError extends Error {
    readonly status?: number;
    constructor(message: string, options?: { status?: number }) {
      super(message);
      this.name = "ApiRequestError";
      this.status = options?.status;
    }
  },
  fetchJson: (path: string) => {
    if (!apiMock.fetchJsonImpl) return Promise.reject(new Error(`unexpected fetchJson: ${path}`));
    return apiMock.fetchJsonImpl(path);
  },
}));

import { NarrativeMemorySummary } from "./NarrativeMemoryPanel";

beforeEach(() => {
  apiMock.fetchJsonImpl = (path) => {
    if (path.includes("/stats")) return Promise.resolve({ stats: { total: 42 } });
    if (path.includes("/events/pending")) {
      return Promise.resolve({
        events: [
          { id: "e-1", risk: "high" },
          { id: "e-2", risk: "low" },
        ],
      });
    }
    return Promise.reject(new Error(`unexpected fetchJson: ${path}`));
  };
});

afterEach(() => {
  cleanup();
});

describe("NarrativeMemorySummary 侧栏摘要卡", () => {
  it("展示待审计数、高风险标记与已结算总数，并提供中央面板入口", async () => {
    const onOpenCenter = vi.fn();
    render(<NarrativeMemorySummary bookId="book-1" onOpenCenter={onOpenCenter} />);

    await waitFor(() => expect(screen.getByText("2 条")).toBeTruthy());
    expect(screen.getByText(/高风险 1/)).toBeTruthy();
    expect(screen.getByText("42 条")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "在中央打开章后事实" }));
    expect(onOpenCenter).toHaveBeenCalledTimes(1);
  });

  it("没有待审事件时给出免处理提示", async () => {
    apiMock.fetchJsonImpl = (path) => {
      if (path.includes("/stats")) return Promise.resolve({ stats: { total: 7 } });
      if (path.includes("/events/pending")) return Promise.resolve({ events: [] });
      return Promise.reject(new Error(`unexpected fetchJson: ${path}`));
    };

    render(<NarrativeMemorySummary bookId="book-1" />);
    await waitFor(() => expect(screen.getByText(/当前没有需要你处理的事项/)).toBeTruthy());
  });

  it("加载失败显示错误并支持刷新重试", async () => {
    apiMock.fetchJsonImpl = () => Promise.reject(new Error("网络中断"));
    render(<NarrativeMemorySummary bookId="book-1" />);
    expect(await screen.findByText(/网络中断/)).toBeTruthy();

    apiMock.fetchJsonImpl = (path) => {
      if (path.includes("/stats")) return Promise.resolve({ stats: { total: 1 } });
      if (path.includes("/events/pending")) return Promise.resolve({ events: [] });
      return Promise.reject(new Error(`unexpected fetchJson: ${path}`));
    };
    fireEvent.click(screen.getByRole("button", { name: "刷新章后事实摘要" }));
    await waitFor(() => expect(screen.getByText(/当前没有需要你处理的事项/)).toBeTruthy());
  });
});
