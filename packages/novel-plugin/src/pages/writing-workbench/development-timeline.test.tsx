import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./NarrativeMemoryGraphWorkspace", () => ({
  NarrativeMemoryGraphWorkspace: ({
    bookId,
    initialView,
    mode,
    dataScope,
    currentChapter,
  }: {
    bookId: string;
    initialView?: string;
    mode?: string;
    dataScope?: string;
    currentChapter?: number;
  }) => (
    <div
      data-testid="development-timeline-graph-probe"
      data-book-id={bookId}
      data-initial-view={initialView}
      data-mode={mode}
      data-scope={dataScope}
      data-current-chapter={currentChapter}
    />
  ),
}));

import { DevelopmentTimelineView } from "./development-timeline";

afterEach(cleanup);

describe("DevelopmentTimelineView", () => {
  it("以只读 scope 复用既有图谱数据源，并默认对齐 timeline 与当前章", () => {
    render(<DevelopmentTimelineView bookId="book-1" currentChapter={18} />);

    const view = screen.getByTestId("development-timeline-view");
    expect(view.getAttribute("data-source-scope")).toBe("read");

    const graph = screen.getByTestId("development-timeline-graph-probe");
    expect(graph.getAttribute("data-book-id")).toBe("book-1");
    expect(graph.getAttribute("data-initial-view")).toBe("timeline");
    expect(graph.getAttribute("data-mode")).toBe("development");
    expect(graph.getAttribute("data-scope")).toBe("read");
    expect(graph.getAttribute("data-current-chapter")).toBe("18");
  });
});
