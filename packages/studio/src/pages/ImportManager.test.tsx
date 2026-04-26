import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ImportManager } from "./ImportManager";

const { useApiMock, fetchJsonMock, postApiMock } = vi.hoisted(() => ({
  useApiMock: vi.fn(),
  fetchJsonMock: vi.fn(),
  postApiMock: vi.fn(),
}));

vi.mock("../hooks/use-api", () => ({
  useApi: (...args: unknown[]) => useApiMock(...args),
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
  postApi: (...args: unknown[]) => postApiMock(...args),
}));

vi.mock("../hooks/use-i18n", () => ({
  useI18n: () => ({ lang: "zh" }),
}));

const t = (key: string) => {
  const map: Record<string, string> = {
    "import.title": "导入工具",
    "import.chapters": "导入章节",
    "import.canon": "导入母本",
    "import.fanfic": "同人创作",
    "import.selectTarget": "选择目标书籍",
    "import.selectSource": "选择源书籍",
    "import.selectDerivative": "选择衍生书籍",
    "import.splitRegex": "分章正则",
    "import.pasteChapters": "粘贴章节",
    "import.pasteMaterial": "粘贴素材",
    "import.importing": "导入中",
    "import.creating": "创建中",
    "import.fanficTitle": "标题",
  };
  return map[key] ?? key;
};

describe("ImportManager", () => {
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

  it("uses author-facing web capture instead of exposing a browser entrance", () => {
    render(
      <ImportManager nav={{ toDashboard: vi.fn() }} theme="light" t={t} />,
    );

    expect(screen.getByText(/不会把 Browser 作为默认一等入口/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "网页素材" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Browser" })).toBeNull();
  });

  it("captures web material into the book review area", async () => {
    fetchJsonMock.mockResolvedValue({
      capture: {
        title: "题材拆解样文",
        excerpt: "这是一篇可用于题材分析的网页素材摘要。",
        content: "正文摘录",
        sourceUrl: "https://example.com/topic",
        perspective: "genre",
        capturedAt: "2026-04-25T00:00:00.000Z",
      },
      persisted: {
        bookId: "book-1",
        file: "web_materials.md",
        path: "books/book-1/story/web_materials.md",
        savedAt: "2026-04-25T00:00:00.000Z",
      },
    });

    const toTruth = vi.fn();
    render(
      <ImportManager nav={{ toDashboard: vi.fn(), toTruth }} theme="light" t={t} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "网页素材" }));
    fireEvent.change(screen.getAllByRole("combobox")[0]!, { target: { value: "book-1" } });
    fireEvent.change(screen.getByPlaceholderText("https://example.com/article"), {
      target: { value: "https://example.com/topic" },
    });
    fireEvent.change(screen.getByPlaceholderText("给这份素材起一个作者标签（可选）"), {
      target: { value: "灵感采风" },
    });

    fireEvent.click(screen.getByRole("button", { name: "抓取并收口到素材区" }));

    await waitFor(() => {
      expect(fetchJsonMock).toHaveBeenCalledWith(
        "/books/book-1/materials/web-capture",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            url: "https://example.com/topic",
            label: "灵感采风",
            notes: undefined,
            perspective: "genre",
          }),
        }),
      );
    });

    expect(await screen.findByText("素材已进入作者审阅区")).toBeTruthy();
    expect(screen.getByText("books/book-1/story/web_materials.md")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "打开作者审阅区" }));
    expect(toTruth).toHaveBeenCalledWith("book-1");
  });
});
