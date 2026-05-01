import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchJsonMock = vi.hoisted(() => vi.fn());

vi.mock("../../hooks/use-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../hooks/use-api")>();
  return { ...actual, fetchJson: fetchJsonMock };
});

import type { StudioResourceNode } from "./resource-adapter";
import { WorkspaceFileViewer } from "./WorkspaceFileViewer";

function node(
  kind: "story-file" | "truth-file" | "material",
  title: string,
  metadata: Record<string, unknown> = {},
): StudioResourceNode {
  return {
    id: `${kind}:${title}`,
    kind,
    title,
    metadata: {
      bookId: "book-1",
      path: `story/${title}`,
      ...metadata,
    },
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  fetchJsonMock.mockReset();
});

describe("WorkspaceFileViewer", () => {
  it("loads and renders story/truth file content", async () => {
    fetchJsonMock.mockResolvedValueOnce({ file: "pending_hooks.md", content: "# hooks\n\n待处理伏笔" });
    render(<WorkspaceFileViewer node={node("story-file", "pending_hooks.md")} />);

    expect(screen.getByText("加载中…")).toBeTruthy();
    await waitFor(() => expect(fetchJsonMock).toHaveBeenCalledWith("/books/book-1/story-files/pending_hooks.md"));
    expect(await screen.findByText(/待处理伏笔/)).toBeTruthy();
  });

  it("shows an explicit empty state when the file exists but has no content", async () => {
    fetchJsonMock.mockResolvedValueOnce({ file: "chapter_summaries.md", content: null });
    render(<WorkspaceFileViewer node={node("truth-file", "chapter_summaries.md")} />);

    expect(await screen.findByText("文件为空")) .toBeTruthy();
    expect(screen.getByText(/当前文件已存在，但还没有可显示的正文/)).toBeTruthy();
  });

  it("shows a retryable error when the file load fails", async () => {
    fetchJsonMock.mockRejectedValueOnce(new Error("404 not found"));
    render(<WorkspaceFileViewer node={node("story-file", "missing.md")} />);

    expect(await screen.findByText("404 not found")).toBeTruthy();
  });

  it("renders readonly material text content without fetching", async () => {
    render(<WorkspaceFileViewer node={node("material", "城门设定摘录", { content: "# 城门\n\n青铜兽首门环。", source: "web-capture" })} />);

    expect(fetchJsonMock).not.toHaveBeenCalled();
    expect(screen.getByText("素材文件 · 素材")).toBeTruthy();
    expect(screen.queryByText(/TextViewer|MarkdownViewer/)).toBeNull();
    expect(screen.getByText(/青铜兽首门环/)).toBeTruthy();
  });
});
