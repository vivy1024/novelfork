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
  it("并行展示书籍会话关系、worktree 分支和仓库提交，并可刷新", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/sessions?status=active&projectId=book-1") return new Response(JSON.stringify(sessions));
      if (url === "/api/git/worktrees") return new Response(JSON.stringify({ worktrees: [
        { path: "D:/repo", branch: "main", status: { modified: 0, added: 0, deleted: 0, untracked: 0 } },
        { path: "D:/repo-wt/review", branch: "review", status: { modified: 1, added: 0, deleted: 0, untracked: 2 } },
      ] }));
      if (url === "/api/git/log?path=D%3A%2Frepo&limit=30") return new Response(JSON.stringify({ commits: [
        { hash: "abcdef123", short: "abcdef1", message: "feat: add chapter", author: "薛小川", date: "2 hours ago" },
      ] }));
      throw new Error(`unexpected request: ${url}`);
    });

    render(<CollaborationVersionPanel bookId="book-1" repositoryPath="D:/repo" />);

    expect(screen.getByText("正在加载协作与版本信息…")).toBeTruthy();
    expect(await screen.findByText("主写作会话")).toBeTruthy();
    expect(screen.getByText("审校分支")).toBeTruthy();
    expect(screen.getByText("reviewer")).toBeTruthy();
    expect(screen.getByText("review")).toBeTruthy();
    expect(screen.getByText("有改动 · 3")).toBeTruthy();
    expect(screen.getByText("feat: add chapter")).toBeTruthy();
    expect(screen.getByText("abcdef1")).toBeTruthy();

    const sessionSection = screen.getByRole("region", { name: "会话协作关系" });
    expect(within(sessionSection).getByTestId("session-edge-child")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "刷新协作与版本" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(6));
  });

  it("repositoryPath 缺失时跳过提交请求，且单个请求失败不影响其他区域", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("/api/sessions?")) return new Response("boom", { status: 500 });
      if (url === "/api/git/worktrees") return new Response(JSON.stringify({ worktrees: [{ path: "D:/repo", branch: "main", status: { modified: 0, added: 0, deleted: 0, untracked: 0 } }] }));
      throw new Error(`unexpected request: ${url}`);
    });

    render(<CollaborationVersionPanel bookId="book-1" />);

    expect(await screen.findByText("会话协作关系加载失败")).toBeTruthy();
    expect(screen.getByText("main")).toBeTruthy();
    expect(screen.getByText("未绑定 repositoryPath，无法读取提交历史。")) .toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/api/git/log"));
  });
});
