import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const fetchJson = vi.fn();

vi.mock("@/hooks/use-api", () => ({
  fetchJson: (...args: unknown[]) => fetchJson(...args),
}));

vi.mock("./NarrativeMemorySettingsPanel", () => ({
  NarrativeMemorySettingsSection: () => null,
}));

import { BookSettingsPanel } from "./BookSettingsPanel";

function mockBook(defaultWorkflow: unknown, recipes: unknown[] = []) {
  fetchJson.mockReset().mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/workflow-default")) {
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body ?? "{}")) as { recipeId?: string | null };
        const matched = recipes.find((item) => (item as { id?: string }).id === body.recipeId) as
          | { id: string; name: string }
          | undefined;
        return {
          recipeId: body.recipeId ?? null,
          recipeName: matched?.name ?? null,
          storedRecipeId: body.recipeId ?? null,
        };
      }
      return defaultWorkflow;
    }
    if (url.endsWith("/workflow-recipes")) return { recipes };
    if (url.includes("/writing-layers")) return {};
    return { book: { title: "测试书", genre: "玄幻", platform: "other", language: "zh", targetChapters: 100, chapterWordCount: 2000 } };
  });
}

afterEach(() => cleanup());

describe("本书设置：默认工作流", () => {
  it("显示当前默认并支持就地切换保存，也可跳到「套路 › 工作流」", async () => {
    mockBook(
      { recipeId: "zhihu-short-story", recipeName: "知乎短篇流", storedRecipeId: "zhihu-short-story" },
      [
        { id: "zhihu-short-story", name: "知乎短篇流", status: "published" },
        { id: "qidian-fast", name: "起点快节奏", status: "published" },
        { id: "draft-flow", name: "草稿流程", status: "draft" },
      ],
    );
    const onOpenWorkflows = vi.fn();
    render(<BookSettingsPanel bookId="book-1" onBack={vi.fn()} onOpenWorkflows={onOpenWorkflows} />);
    const box = await screen.findByTestId("book-settings-default-workflow");
    await waitFor(() => expect(box.textContent).toContain("知乎短篇流"));

    fireEvent.click(screen.getByRole("combobox", { name: "默认工作流" }));
    fireEvent.click(await screen.findByRole("option", { name: "起点快节奏" }));

    await waitFor(() => {
      expect(fetchJson).toHaveBeenCalledWith(
        "/api/books/book-1/workflow-default",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ recipeId: "qidian-fast" }),
        }),
      );
    });
    expect(screen.queryByRole("option", { name: "草稿流程" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "编辑/管理工作流" }));
    expect(onOpenWorkflows).toHaveBeenCalledTimes(1);
    expect(fetchJson).toHaveBeenCalledWith("/api/books/book-1/workflow-default");
  });

  it("没设置时说明写章时自己选；失效时显示原因", async () => {
    mockBook({ recipeId: null, recipeName: "旧方案", storedRecipeId: "old", notice: { what: "默认工作流「旧方案」现在是草稿" } });
    render(<BookSettingsPanel bookId="book-1" onBack={vi.fn()} />);
    const box = await screen.findByTestId("book-settings-default-workflow");
    await waitFor(() => expect(box.textContent).toContain("未设置（写章时自己选）"));
    expect(box.textContent).toContain("现在是草稿");
    expect(box.textContent).toContain("在「套路 › 工作流」里修改");
  });
});
