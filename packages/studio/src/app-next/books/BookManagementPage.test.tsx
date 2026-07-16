import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BookManagementPage } from "./BookManagementPage";
import type { RuntimeBookProvisionOperation } from "../runtime/product-contract";

afterEach(cleanup);

function operation(bookId: string): RuntimeBookProvisionOperation {
  return { id: `operation-${bookId}`, bookId, state: "ready" };
}

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
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "修复绑定" }));

    await waitFor(() => expect(onRepairBook).toHaveBeenCalledWith("book-1"));
    expect(await screen.findByText(/Runtime 绑定已校验/)).not.toBeNull();
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
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "接管旧作品" })[0]);
    fireEvent.change(screen.getByLabelText("Book ID"), { target: { value: "legacy-book" } });
    fireEvent.click(screen.getByRole("button", { name: "确认接管" }));

    await waitFor(() => expect(onClaimLegacyBook).toHaveBeenCalledWith("legacy-book"));
    expect(await screen.findByText(/旧作品 legacy-book 已接管/)).not.toBeNull();
  });
});
