import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CollaborationVersionPanel, buildSessionForest } from "./CollaborationVersionPanel";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const sessions = [
  { id: "root", title: "主写作会话", status: "active", agentId: "writer", lastModified: "2026-07-12T10:00:00.000Z" },
  { id: "child", parentSessionId: "root", title: "审校分支", status: "active", agentId: "reviewer", lastModified: "2026-07-12T11:00:00.000Z" },
];

describe("buildSessionForest", () => {
  it("使用 parentSessionId 形成父子关系，并保留孤儿会话", () => {
    const forest = buildSessionForest([...sessions, { ...sessions[1], id: "orphan", parentSessionId: "missing", title: "孤立分支" }]);

    expect(forest.map((item) => item.session.id)).toEqual(["root", "orphan"]);
    expect(forest[0].children.map((item) => item.session.id)).toEqual(["child"]);
  });

  it("将循环父子关系降级为根节点，避免递归渲染崩溃", () => {
    const forest = buildSessionForest([
      { ...sessions[0], id: "a", parentSessionId: "b" },
      { ...sessions[1], id: "b", parentSessionId: "a" },
    ]);

    expect(forest.map((item) => item.session.id)).toEqual(["a", "b"]);
    expect(forest.every((item) => item.children.length === 0)).toBe(true);
  });
});

describe("CollaborationVersionPanel", () => {
  it("通过产品 narrators 网关展示会话，并解析 collaboration-context", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/books/book-1/narrators") {
        return new Response(JSON.stringify({
          narrators: [
            { id: "root", title: "主写作会话", status: "active", model: "writer", updatedAt: "2026-07-12T10:00:00.000Z" },
            { id: "child", title: "审校分支", status: "active", model: "reviewer", updatedAt: "2026-07-12T11:00:00.000Z" },
          ],
        }));
      }
      // when repositoryPath is provided, collaboration-context is not fetched
      throw new Error(`unexpected request: ${url}`);
    });

    render(<CollaborationVersionPanel bookId="book-1" repositoryPath="D:/repo" />);

    expect(screen.getByText("正在加载协作与版本信息…")).toBeTruthy();
    expect(await screen.findByText("主写作会话")).toBeTruthy();
    expect(screen.getByText("审校分支")).toBeTruthy();
    expect(screen.getByText("reviewer")).toBeTruthy();
    expect(screen.getByText(/仓库路径已绑定/)).toBeTruthy();
    expect(screen.getByText(/D:\/repo/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "刷新协作与版本" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("repositoryPath 缺失时从 collaboration-context 取路径；narrators 失败不影响其它区", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/books/book-1/narrators") return new Response("boom", { status: 500 });
      if (url === "/api/books/book-1/collaboration-context") {
        return new Response(JSON.stringify({
          repositoryPath: "D:/bound-repo",
          worktreeRoot: "D:/bound-repo/.narrafork-worktrees",
        }));
      }
      throw new Error(`unexpected request: ${url}`);
    });

    render(<CollaborationVersionPanel bookId="book-1" />);

    expect(await screen.findByText("会话协作关系加载失败")).toBeTruthy();
    expect(screen.getByText("D:/bound-repo/.narrafork-worktrees")).toBeTruthy();
    expect(screen.getByText(/仓库路径已绑定/)).toBeTruthy();
    expect(screen.getByText(/D:\/bound-repo/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/api/books/book-1/collaboration-context");
  });
});
