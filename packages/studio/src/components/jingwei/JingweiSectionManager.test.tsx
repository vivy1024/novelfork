import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const postApiMock = vi.fn();
const fetchJsonMock = vi.fn();

vi.mock("@/hooks/use-api", () => ({
  postApi: (...args: unknown[]) => postApiMock(...args),
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

vi.mock("@/lib/notify", () => ({
  notify: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

import { JingweiSectionManager } from "./JingweiSectionManager";

describe("JingweiSectionManager markdown directory import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    postApiMock.mockResolvedValue({});
    fetchJsonMock.mockResolvedValue({});
  });

  afterEach(() => cleanup());

  it("previews parsed section candidates and creates only checked sections", async () => {
    const onRefresh = vi.fn();

    render(<JingweiSectionManager bookId="book-1" sections={[]} onRefresh={onRefresh} />);

    fireEvent.click(screen.getByRole("button", { name: /管理栏目/ }));
    fireEvent.click(screen.getByRole("button", { name: "导入 Markdown 目录" }));

    fireEvent.change(screen.getByLabelText("Markdown 目录"), {
      target: {
        value: "## 目录\n1. 人物关系\n2. 势力版图\n3. 伏笔总表",
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "识别栏目" }));

    expect(screen.getByLabelText("人物关系")).toBeTruthy();
    expect(screen.getByLabelText("势力版图")).toBeTruthy();
    expect(screen.getByLabelText("伏笔总表")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("势力版图"));
    fireEvent.click(screen.getByRole("button", { name: "创建 2 个栏目" }));

    await waitFor(() => {
      expect(postApiMock).toHaveBeenCalledTimes(2);
    });
    expect(postApiMock).toHaveBeenNthCalledWith(1, "/books/book-1/jingwei/sections", expect.objectContaining({ name: "人物关系" }));
    expect(postApiMock).toHaveBeenNthCalledWith(2, "/books/book-1/jingwei/sections", expect.objectContaining({ name: "伏笔总表" }));
    expect(onRefresh).toHaveBeenCalled();
  });
});
