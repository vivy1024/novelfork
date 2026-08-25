import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({
  fetchJsonImpl: undefined as undefined | ((path: string) => Promise<unknown>),
}));

vi.mock("@/hooks/use-api", () => ({
  fetchJson: (path: string) => {
    if (!apiMock.fetchJsonImpl) return Promise.reject(new Error(`unexpected fetchJson: ${path}`));
    return apiMock.fetchJsonImpl(path);
  },
}));

import { TensionCurvePanel } from "./TensionCurvePanel";

function summaryFields(fields: Record<string, unknown>): { fields: Record<string, unknown> } {
  return { fields };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("TensionCurvePanel 张力心电图（F1 标准化）", () => {
  it("混合数据：-1 哨兵渲染为未评估计数徽标，不污染均值；连续低张力触发告警", async () => {
    apiMock.fetchJsonImpl = () =>
      Promise.resolve({
        entries: [
          summaryFields({ chapterNumber: 1, tension_score: 8 }),
          summaryFields({ chapterNumber: 2, tension_score: -1 }), // T1 哨兵：评分失败
          summaryFields({ chapterNumber: 3, tension_score: 3 }),
          summaryFields({ chapterNumber: 4, tension_score: 3 }),
          summaryFields({ chapterNumber: 5, tension_score: 3, tension_dims: { plot: 30, emotional: 28, pacing: 32 } }),
        ],
      });

    const onJumpToChapter = vi.fn();
    render(<TensionCurvePanel bookId="book-1" onJumpToChapter={onJumpToChapter} />);

    // 未评估徽标
    expect(await screen.findByTestId("tension-unevaluated-badge")).toBeTruthy();
    expect(screen.getByTestId("tension-unevaluated-badge").textContent).toContain("未评估 1 章");

    // 连续 3 章 <4 告警
    const alert = screen.getByTestId("tension-low-streak-alert");
    expect(alert.textContent).toContain("连续 3 章");
    expect(alert.textContent).toContain("第 3 章起");

    // 未评估章不进均值：mean(8,3,3,3)=4.25 → 显示 4.3
    expect(screen.getByText(/均值/).textContent).toContain("4.3");

    // 虚线灰柱 tooltip 区分评分失败
    expect(screen.getByTitle(/第2章：评分失败/)).toBeTruthy();
    // 实心柱 tooltip 携带三维 dims
    expect(screen.getByTitle(/情节30\/情感28\/节奏32/)).toBeTruthy();

    // 点击柱子跳对应章节
    fireEvent.click(screen.getByRole("button", { name: "第5章张力 3/10" }));
    expect(onJumpToChapter).toHaveBeenCalledWith(5);
  });

  it("空数据给诚实空态与引导文案", async () => {
    apiMock.fetchJsonImpl = () => Promise.resolve({ entries: [] });
    render(<TensionCurvePanel bookId="book-1" />);
    expect(await screen.findByTestId("tension-curve-empty")).toBeTruthy();
    expect(screen.queryByTestId("tension-unevaluated-badge")).toBeNull();
  });

  it("加载失败显示错误与重试；重试成功后恢复曲线", async () => {
    apiMock.fetchJsonImpl = () => Promise.reject(new Error("网络中断"));
    render(<TensionCurvePanel bookId="book-1" />);
    const retry = await screen.findByText("重试");
    expect(screen.getByRole("alert").textContent).toContain("网络中断");

    apiMock.fetchJsonImpl = () =>
      Promise.resolve({
        entries: [summaryFields({ chapterNumber: 1, tension_score: 6 })],
      });
    fireEvent.click(retry);
    expect(await screen.findByTitle(/第1章：6\/10/)).toBeTruthy();
  });
});
