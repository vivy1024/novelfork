import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BookManagementPage, bookShelfStatusLabel } from "./BookManagementPage";
import type { RuntimeBookProvisionOperation } from "../runtime/product-contract";

afterEach(cleanup);

function operation(bookId: string): RuntimeBookProvisionOperation {
  return { id: `operation-${bookId}`, bookId, state: "ready" };
}

describe("书架状态标签", () => {
  it("可写的书不挂英文状态徽标，其他阶段显示中文", () => {
    expect(bookShelfStatusLabel("ready")).toBeNull();
    expect(bookShelfStatusLabel(undefined)).toBeNull();
    expect(bookShelfStatusLabel("runtime-bound")).toBe("准备中");
    expect(bookShelfStatusLabel("failed")).toBe("创建失败");
    expect(bookShelfStatusLabel("compensation-required")).toBe("需要修复");
    expect(bookShelfStatusLabel("something-new")).toBe("状态异常");
  });

  it("书架卡片上不出现原始状态值 ready", () => {
    render(
      <BookManagementPage
        books={[{ id: "book-1", title: "长夜", status: "ready" }, { id: "book-2", title: "旧梦", status: "failed" }]}
        loading={false}
        error={null}
        onNavigateToBook={vi.fn()}
        onCreateBook={vi.fn()}
        onClaimLegacyBook={vi.fn()}
        onRepairBook={vi.fn()}
        onRebindBookWorkspace={vi.fn()}
        onDeleteBook={vi.fn()}
      />,
    );
    expect(screen.queryByText("ready")).toBeNull();
    expect(screen.queryByText("failed")).toBeNull();
    expect(screen.getAllByTestId("book-shelf-status").map((node) => node.textContent)).toEqual(["创建失败"]);
  });
});

describe("BookManagementPage Runtime maintenance actions", () => {
  it("repairs a listed book through the Runtime product callback", async () => {
    const onRepairBook = vi.fn(async (bookId: string) => operation(bookId));
    render(
      <BookManagementPage
        books={[{ id: "book-1", title: "长夜" }]}
        loading={false}
        error={null}
        onNavigateToBook={vi.fn()}
        onCreateBook={vi.fn()}
        onClaimLegacyBook={vi.fn()}
        onRepairBook={onRepairBook}
        onRebindBookWorkspace={vi.fn()}
        onDeleteBook={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "修复绑定" }));

    await waitFor(() => expect(onRepairBook).toHaveBeenCalledWith("book-1"));
    expect(await screen.findByText(/Runtime 绑定已校验/)).not.toBeNull();
  });

  it("rebinds a listed book workspace through the product callback", async () => {
    const onRebindBookWorkspace = vi.fn(async (bookId: string, workspaceRoot: string) => ({
      bookId,
      bookRoot: workspaceRoot,
      runtimeProjectId: "project-1",
    }));
    render(
      <BookManagementPage
        books={[{ id: "book-1", title: "长夜" }]}
        loading={false}
        error={null}
        onNavigateToBook={vi.fn()}
        onCreateBook={vi.fn()}
        onClaimLegacyBook={vi.fn()}
        onRepairBook={vi.fn()}
        onRebindBookWorkspace={onRebindBookWorkspace}
        onDeleteBook={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "修正目录" }));
    fireEvent.change(screen.getByLabelText("正确目录"), {
      target: { value: "D:\\\\Books\\\\changye" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认修正" }));

    await waitFor(() =>
      expect(onRebindBookWorkspace).toHaveBeenCalledWith(
        "book-1",
        "D:\\\\Books\\\\changye",
      ),
    );
    expect(await screen.findByText(/工作目录已修正/)).not.toBeNull();
  });

  it("claims a legacy book by bookId without accepting a browser path", async () => {
    const onClaimLegacyBook = vi.fn(async (bookId: string) => operation(bookId));
    render(
      <BookManagementPage
        books={[]}
        loading={false}
        error={null}
        onNavigateToBook={vi.fn()}
        onCreateBook={vi.fn()}
        onClaimLegacyBook={onClaimLegacyBook}
        onRepairBook={vi.fn()}
        onRebindBookWorkspace={vi.fn()}
        onDeleteBook={vi.fn()}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "接管旧作品" })[0]);
    fireEvent.change(screen.getByLabelText("Book ID"), { target: { value: "legacy-book" } });
    fireEvent.click(screen.getByRole("button", { name: "确认接管" }));

    await waitFor(() => expect(onClaimLegacyBook).toHaveBeenCalledWith("legacy-book"));
    expect(await screen.findByText(/旧作品 legacy-book 已接管/)).not.toBeNull();
  });

  it("删除确认与成功提示说明外部目录不会被删除，不再声称删除作品文件", async () => {
    const onDeleteBook = vi.fn(async () => undefined);
    render(
      <BookManagementPage
        books={[{ id: "book-1", title: "长夜" }]}
        loading={false}
        error={null}
        onNavigateToBook={vi.fn()}
        onCreateBook={vi.fn()}
        onClaimLegacyBook={vi.fn()}
        onRepairBook={vi.fn()}
        onRebindBookWorkspace={vi.fn()}
        onDeleteBook={onDeleteBook}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("外部目录不会被删除");
    expect(dialog.textContent).toContain("NovelFork 管理的作品目录");
    expect(dialog.textContent).not.toContain("会删除作品文件");

    fireEvent.change(screen.getByLabelText("作品名"), { target: { value: "长夜" } });
    fireEvent.click(screen.getByRole("button", { name: "永久删除" }));

    await waitFor(() => expect(onDeleteBook).toHaveBeenCalledWith("book-1"));
    expect(await screen.findByText(/作品 长夜 已删除.*外部目录不会被删除/)).not.toBeNull();
  });
});
