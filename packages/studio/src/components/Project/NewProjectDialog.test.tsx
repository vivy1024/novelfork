import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { NewProjectDialog } from "./NewProjectDialog";

describe("NewProjectDialog", () => {
  it("defaults to the formal project-create entry", () => {
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <NewProjectDialog open onOpenChange={onOpenChange} onSelect={onSelect} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "进入所选入口" }));

    expect(onSelect).toHaveBeenCalledWith("project-create");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("allows falling back to the legacy book-create entry", () => {
    const onSelect = vi.fn();

    render(
      <NewProjectDialog open onOpenChange={() => {}} onSelect={onSelect} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /兼容直接建书/ }));
    fireEvent.click(screen.getByRole("button", { name: "进入所选入口" }));

    expect(onSelect).toHaveBeenCalledWith("book-create");
  });
});
