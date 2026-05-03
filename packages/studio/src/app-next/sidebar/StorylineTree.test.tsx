import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StorylineTree, type BookListItem } from "./StorylineTree";

afterEach(() => { cleanup(); });

const books: BookListItem[] = [
  { id: "b1", title: "凡人修仙传" },
  { id: "b2", title: "都市之巅" },
];

describe("StorylineTree", () => {
  it("renders book list and highlights active book", () => {
    render(<StorylineTree activeBookId="b1" books={books} onBookChange={vi.fn()} />);

    expect(screen.getByText("凡人修仙传")).toBeTruthy();
    expect(screen.getByText("都市之巅")).toBeTruthy();
    expect(screen.getByText("凡人修仙传").closest("button")?.getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("都市之巅").closest("button")?.getAttribute("aria-current")).toBeNull();
  });

  it("shows empty state when no books", () => {
    render(<StorylineTree activeBookId={null} books={[]} onBookChange={vi.fn()} />);
    expect(screen.getByText(/暂无叙事线/)).toBeTruthy();
  });

  it("calls onBookChange and onBookClick when a book is clicked", () => {
    const onChange = vi.fn();
    const onClick = vi.fn();
    render(<StorylineTree activeBookId="b1" books={books} onBookChange={onChange} onBookClick={onClick} />);

    fireEvent.click(screen.getByText("都市之巅"));
    expect(onChange).toHaveBeenCalledWith("b2");
    expect(onClick).toHaveBeenCalledWith("b2");
  });

  it("renders children when a book is active", () => {
    render(
      <StorylineTree activeBookId="b1" books={books} onBookChange={vi.fn()}>
        <div>资源树内容</div>
      </StorylineTree>,
    );
    expect(screen.getByText("资源树内容")).toBeTruthy();
  });

  it("does not render children when no book is active", () => {
    render(
      <StorylineTree activeBookId={null} books={books} onBookChange={vi.fn()}>
        <div>资源树内容</div>
      </StorylineTree>,
    );
    expect(screen.queryByText("资源树内容")).toBeNull();
  });
});
