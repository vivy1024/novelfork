import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const useApiMock = vi.fn();
const useNovelForkMock = vi.fn();
const useProjectSortMock = vi.fn();

vi.mock("../hooks/use-api", () => ({
  useApi: (...args: unknown[]) => useApiMock(...args),
}));

vi.mock("../providers/novelfork-context", () => ({
  useNovelFork: () => useNovelForkMock(),
}));

vi.mock("../hooks/use-project-sort", () => ({
  useProjectSort: (...args: unknown[]) => useProjectSortMock(...args),
}));

vi.mock("./Project/SortableProjectCard", () => ({
  SortableProjectCard: ({ book }: { book: { title: string } }) => <div>{book.title}</div>,
}));

import { Sidebar } from "./Sidebar";

describe("Sidebar workbench mode", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    useNovelForkMock.mockReturnValue({ mode: "standalone" });
    useProjectSortMock.mockImplementation((items: unknown[]) => ({ sortedItems: items, handleDragEnd: vi.fn() }));
    useApiMock.mockImplementation((path: string) => {
      if (path === "/books") return { data: { books: [] }, refetch: vi.fn() };
      if (path === "/daemon") return { data: { running: false }, refetch: vi.fn() };
      if (path === "/settings/user") return { data: { preferences: { workbenchMode: false } }, refetch: vi.fn() };
      return { data: null, refetch: vi.fn() };
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    cleanup();
  });

  it("hides workflow and worktree first-class entries in author mode", () => {
    render(
      <Sidebar
        nav={{
          toDashboard: vi.fn(),
          toWorkflow: vi.fn(),
          toSessions: vi.fn(),
          toBook: vi.fn(),
          toBible: vi.fn(),
          toBookCreate: vi.fn(),
          toChapter: vi.fn(),
          toTruth: vi.fn(),
          toDaemon: vi.fn(),
          toLogs: vi.fn(),
          toGenres: vi.fn(),
          toStyle: vi.fn(),
          toImport: vi.fn(),
          toRadar: vi.fn(),
          toDoctor: vi.fn(),
          toSearch: vi.fn(),
          toBackup: vi.fn(),
          toState: vi.fn(),
          toPipeline: vi.fn(),
          toAdmin: vi.fn(),
          toSettings: vi.fn(),
          toWorktree: vi.fn(),
        }}
        activePage="dashboard"
        sse={{ messages: [] }}
        t={(key: string) => key}
      />,
    );

    expect(screen.queryByText("工作流配置")).toBeNull();
    expect(screen.queryByText("管理中心")).toBeNull();
    expect(screen.queryByText("Worktree")).toBeNull();
    expect(screen.getByText("项目总览")).toBeTruthy();
    expect(screen.getByText("设置")).toBeTruthy();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});
