import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GitChangesView, type FileChange } from "./GitChangesView";

afterEach(() => { cleanup(); });

const changes: FileChange[] = [
  { path: "chapters/ch1.md", status: "M", additions: 50, deletions: 10 },
  { path: "bible/characters.json", status: "A", additions: 30 },
  { path: "outline.md", status: "D", deletions: 100 },
];

const staged: FileChange[] = [
  { path: "chapters/ch2.md", status: "M", additions: 20, deletions: 5 },
];

describe("GitChangesView", () => {
  it("renders changes tab with file list", () => {
    render(<GitChangesView changes={changes} staged={staged} />);

    expect(screen.getByText("变更 (3)")).toBeTruthy();
    expect(screen.getByText("chapters/ch1.md")).toBeTruthy();
    expect(screen.getByText("bible/characters.json")).toBeTruthy();
    expect(screen.getByText("outline.md")).toBeTruthy();
  });

  it("shows diff stats for files", () => {
    render(<GitChangesView changes={changes} staged={staged} />);

    expect(screen.getByText("+50")).toBeTruthy();
    expect(screen.getByText("-10")).toBeTruthy();
  });

  it("switches to staged tab", () => {
    render(<GitChangesView changes={changes} staged={staged} />);

    fireEvent.click(screen.getByText("暂存 (1)"));
    expect(screen.getByText("chapters/ch2.md")).toBeTruthy();
    expect(screen.queryByText("chapters/ch1.md")).toBeNull();
  });

  it("switches to commit tab and submits", () => {
    const onCommit = vi.fn();
    render(<GitChangesView changes={changes} staged={staged} onCommit={onCommit} />);

    fireEvent.click(screen.getByText("提交"));
    const textarea = screen.getByLabelText("提交消息") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "feat: 完成第一章" } });
    fireEvent.click(screen.getByText("提交 (1 个文件)"));

    expect(onCommit).toHaveBeenCalledWith("feat: 完成第一章");
  });

  it("disables commit when no message or no staged files", () => {
    render(<GitChangesView changes={changes} staged={[]} />);

    fireEvent.click(screen.getByText("提交"));
    expect(screen.getByText("提交 (0 个文件)").closest("button")?.disabled).toBe(true);
  });

  it("calls onStageAll and onDiscardAll", () => {
    const onStageAll = vi.fn();
    const onDiscardAll = vi.fn();
    render(<GitChangesView changes={changes} staged={staged} onStageAll={onStageAll} onDiscardAll={onDiscardAll} />);

    fireEvent.click(screen.getByText("全部暂存"));
    expect(onStageAll).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByText("丢弃全部"));
    expect(onDiscardAll).toHaveBeenCalledOnce();
  });

  it("shows empty state when no changes", () => {
    render(<GitChangesView changes={[]} staged={[]} />);
    expect(screen.getByText("无文件")).toBeTruthy();
  });
});
