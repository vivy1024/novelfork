import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../BookHealthSummary", () => ({
  BookHealthSummary: ({ bookId }: { bookId: string }) => <div data-testid="mock-book-health">{bookId}</div>,
}));
vi.mock("../NarrativeConsistencyPanel", () => ({
  NarrativeConsistencyPanel: ({
    bookId,
    currentChapter,
    onJumpToChapter,
    onOpenJingweiEntry,
  }: {
    bookId: string;
    currentChapter?: number;
    onJumpToChapter?: (chapterNumber: number) => void;
    onOpenJingweiEntry?: (entryId: string) => boolean;
  }) => (
    <div
      data-testid="mock-consistency"
      data-current={currentChapter ?? ""}
      onClick={() => {
        onJumpToChapter?.(7);
        onOpenJingweiEntry?.("entry-1");
      }}
    >
      {bookId}
    </div>
  ),
}));

import { QualityCenterPanel } from "./QualityCenterPanel";

afterEach(() => {
  cleanup();
});

describe("QualityCenterPanel 质量中心（F2 收敛）", () => {
  const props = {
    bookId: "book-1",
    currentChapter: 12,
    onJumpToChapter: vi.fn(),
    onOpenJingweiEntry: vi.fn(() => true),
  };

  it("默认显示趋势分区（原质量监控图表）", () => {
    render(<QualityCenterPanel {...props} />);
    expect(screen.getByTestId("quality-center-panel")).toBeTruthy();
    expect(screen.getByTestId("quality-center-trend")).toBeTruthy();
    expect(screen.queryByTestId("quality-center-metrics")).toBeNull();
  });

  it("其余分区可切换，指标/一致性各自渲染对应子面板", () => {
    render(<QualityCenterPanel {...props} />);

    fireEvent.click(screen.getByRole("tab", { name: /指标/ }));
    expect(screen.getByTestId("quality-center-metrics")).toBeTruthy();
    expect(screen.getByTestId("mock-book-health").textContent).toBe("book-1");

    fireEvent.click(screen.getByRole("tab", { name: /一致性体检/ }));
    const consistency = screen.getByTestId("mock-consistency");
    expect(consistency.textContent).toBe("book-1");
    // 一致性分区透传章节锚点与跳转回调
    expect(consistency.getAttribute("data-current")).toBe("12");
    fireEvent.click(consistency);
    expect(props.onJumpToChapter).toHaveBeenCalledWith(7);
    expect(props.onOpenJingweiEntry).toHaveBeenCalledWith("entry-1");
  });

  it("「文风检测」分区已下线：没有真实正文源时展示的是伪造对比，不再出现", () => {
    render(<QualityCenterPanel {...props} />);
    expect(screen.queryByRole("tab", { name: /文风检测/ })).toBeNull();
    expect(screen.queryByTestId("quality-center-style")).toBeNull();
  });

  it("tab 具备 aria-selected 状态供无障碍与测试定位", () => {
    render(<QualityCenterPanel {...props} />);
    const trendTab = screen.getByRole("tab", { name: /趋势/ });
    expect(trendTab.getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: /指标/ }));
    expect(trendTab.getAttribute("aria-selected")).toBe("false");
  });
});
