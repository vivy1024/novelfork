import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchJson = vi.fn();

vi.mock("@/hooks/use-api", () => ({
  fetchJson: (...args: unknown[]) => fetchJson(...args),
  ApiRequestError: class ApiRequestError extends Error {
    status?: number;
    constructor(message: string, status?: number) {
      super(message);
      this.status = status;
    }
  },
}));

import { DevelopmentTimelineView } from "./development-timeline";

beforeEach(() => {
  fetchJson.mockReset();
  fetchJson.mockImplementation(async (url: string) => {
    if (url.includes("narrative-memory/graph")) {
      return {
        events: [
          { id: "e1", chapterNumber: 12, subject: "薛行之", predicate: "抵达", object: "西京", eventType: "location_changed" },
        ],
      };
    }
    return {
      entries: [
        { id: "s12", category: "chapter-summaries", title: "第 12 章", fields: { chapterNumber: 12 } },
      ],
    };
  });
});

afterEach(cleanup);

describe("DevelopmentTimelineView", () => {
  it("以只读 scope 打开发展历程树，不再走 React Flow 图谱", async () => {
    render(<DevelopmentTimelineView bookId="book-1" currentChapter={18} />);

    const view = screen.getByTestId("development-timeline-view");
    expect(view.getAttribute("data-source-scope")).toBe("read");
    await waitFor(() => expect(screen.getByTestId("tidy-tree-canvas").getAttribute("data-kind")).toBe("timeline"));
    expect(screen.queryByTestId("canonical-tree-tab-worldview")).toBeNull();
    expect(screen.getByTestId("tidy-tree-row-chapter:12")).toBeTruthy();
  });
});
