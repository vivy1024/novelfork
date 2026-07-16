import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentShell } from "./AgentShell";
import type { ShellRoute } from "./shell-route";

const books = [{ id: "b1", title: "第一本书" }];
const sessions = [{ id: "s1", title: "主叙述者", status: "active" as const, projectId: "b1", projectName: "第一本书" }];
const standaloneSessions = [{ id: "s2", title: "独立叙述者", status: "active" as const }];

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("AgentShell", () => {
  it("renders global shell navigation and marks active book", () => {
    render(
      <AgentShell
        route={{ kind: "book", bookId: "b1" }}
        books={books}
        sessions={sessions}
        onNavigate={vi.fn()}
      >
        <div>画布挂载点</div>
      </AgentShell>,
    );

    expect(screen.getByTestId("agent-shell")).toBeTruthy();
    expect(screen.getByTestId("shell-sidebar").textContent).toContain("第一本书");
    expect(screen.getByTestId("shell-sidebar").textContent).not.toContain("主叙述者");
    expect(screen.getByRole("button", { name: "第一本书" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("画布挂载点")).toBeTruthy();
  });

  it("routes sidebar clicks through the shell owner", () => {
    const onNavigate = vi.fn<(route: ShellRoute) => void>();
    render(
      <AgentShell route={{ kind: "book", bookId: "b1" }} books={books} sessions={[...sessions, ...standaloneSessions]} onNavigate={onNavigate}>
        <div>占位</div>
      </AgentShell>,
    );

    // Only standalone sessions appear in the narrator rail
    fireEvent.click(screen.getByRole("button", { name: "独立叙述者" }));
    expect(onNavigate).toHaveBeenCalledWith({ kind: "narrator", sessionId: "s2" });
    expect(screen.queryByRole("button", { name: "主叙述者" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    expect(onNavigate).toHaveBeenCalledWith({ kind: "search" });
  });

  it("RED: keeps the narrator rail focused on recent sessions and links to the full session center", () => {
    const onNavigate = vi.fn<(route: ShellRoute) => void>();
    const manySessions = Array.from({ length: 8 }, (_, index) => ({
      id: `session-${index + 1}`,
      title: index < 5 ? `最近会话 ${index + 1}` : `历史会话 ${index + 1}`,
      status: "active" as const,
      lastModified: `2026-05-0${Math.min(index + 1, 9)}T00:00:00.000Z`,
    }));

    render(
      <AgentShell route={{ kind: "home" }} books={books} sessions={manySessions} onNavigate={onNavigate}>
        <div>占位</div>
      </AgentShell>,
    );

    const sidebar = screen.getByTestId("shell-sidebar");
    expect(sidebar.textContent).toContain("最近会话 1");
    expect(sidebar.textContent).toContain("最近会话 5");
    expect(sidebar.textContent).not.toContain("历史会话 6");
    expect(sidebar.textContent).toContain("还有 3 个会话");

    fireEvent.click(screen.getByRole("button", { name: "查看全部叙述者" }));
    expect(onNavigate).toHaveBeenCalledWith({ kind: "sessions" });
  });

  it("renders Runtime recent tabs, opens the desktop drawer, and closes stale entries", () => {
    const onNavigate = vi.fn<(route: ShellRoute) => void>();
    const onRemoveRecentTab = vi.fn();
    render(
      <AgentShell
        route={{ kind: "narrator", sessionId: "s2" }}
        books={books}
        sessions={[...sessions, ...standaloneSessions]}
        recentTabs={[
          { type: "narrator", id: "s2", narratorId: "s2", title: "独立叙述者", lastVisitedAt: 30 },
          { type: "chapter", id: "chapter-1", narratorId: "s1", title: "书籍主叙述者", lastVisitedAt: 20 },
          { type: "narrator", id: "gone", title: "失效会话", lastVisitedAt: 10 },
        ]}
        onNavigate={onNavigate}
        onRemoveRecentTab={onRemoveRecentTab}
        onClearInactiveRecentTabs={vi.fn()}
      >
        <div>正文</div>
      </AgentShell>,
    );

    expect(screen.getByTestId("shell-sidebar").textContent).toContain("独立叙述者");
    expect(screen.getByTestId("shell-sidebar").textContent).toContain("书籍主叙述者");
    fireEvent.click(screen.getAllByRole("button", { name: "打开会话抽屉" })[0]);

    const drawer = screen.getByRole("dialog", { name: "会话工作区" });
    expect(drawer.textContent).toContain("失效会话");
    expect(drawer.textContent).toContain("会话已失效");
    fireEvent.click(within(drawer).getByRole("button", { name: "关闭最近项 失效会话" }));
    expect(onRemoveRecentTab).toHaveBeenCalledWith(expect.objectContaining({ id: "gone" }));

    const bookRecentButton = within(drawer).getAllByRole("button")
      .find((button) => button.textContent?.includes("书籍主叙述者") && !button.getAttribute("aria-label"));
    expect(bookRecentButton).toBeTruthy();
    fireEvent.click(bookRecentButton as HTMLButtonElement);
    expect(onNavigate).toHaveBeenCalledWith({ kind: "narrator", sessionId: "s1" });
    expect(screen.queryByRole("dialog", { name: "会话工作区" })).toBeNull();
  });

  it("pins and reorders recent tabs and navigates with Ctrl+Arrow keys", () => {
    vi.useFakeTimers();
    const onNavigate = vi.fn<(route: ShellRoute) => void>();
    const onPinRecentTab = vi.fn();
    const onMoveRecentTab = vi.fn();
    const recentTabs = [
      { type: "narrator" as const, id: "s2", narratorId: "s2", title: "独立叙述者", lastVisitedAt: 30 },
      { type: "narrator" as const, id: "s3", narratorId: "s3", title: "第二叙述者", lastVisitedAt: 20 },
    ];

    render(
      <AgentShell
        route={{ kind: "home" }}
        books={books}
        sessions={[...sessions, ...standaloneSessions, { id: "s3", title: "第二叙述者", status: "active" as const }]}
        recentTabs={recentTabs}
        onNavigate={onNavigate}
        onPinRecentTab={onPinRecentTab}
        onMoveRecentTab={onMoveRecentTab}
      >
        <div>正文</div>
      </AgentShell>,
    );

    fireEvent.click(screen.getByRole("button", { name: "置顶最近项 独立叙述者" }));
    expect(onPinRecentTab).toHaveBeenCalledWith(recentTabs[0], true);

    const source = screen.getByText("独立叙述者").closest("[draggable=\"true\"]") as HTMLElement;
    const target = screen.getByText("第二叙述者").closest("[draggable=\"true\"]") as HTMLElement;
    const dataTransfer = { effectAllowed: "", dropEffect: "", setData: vi.fn() };
    fireEvent.dragStart(source, { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });
    expect(onMoveRecentTab).toHaveBeenCalledWith(recentTabs[0], recentTabs[1]);

    const input = document.createElement("input");
    const select = document.createElement("select");
    document.body.append(input, select);
    fireEvent.keyDown(input, { key: "ArrowDown", ctrlKey: true });
    fireEvent.keyDown(select, { key: "ArrowDown", ctrlKey: true });
    vi.advanceTimersByTime(400);
    expect(onNavigate).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "ArrowDown", ctrlKey: true });
    vi.advanceTimersByTime(400);
    expect(onNavigate).toHaveBeenCalledWith({ kind: "narrator", sessionId: "s2" });
    input.remove();
    select.remove();
  });

  it("switches sessions from the mobile overlay without replacing the content pane", () => {
    const onNavigate = vi.fn<(route: ShellRoute) => void>();
    render(
      <AgentShell
        route={{ kind: "narrator", sessionId: "s2" }}
        books={books}
        sessions={[...sessions, ...standaloneSessions]}
        recentTabs={[
          { type: "chapter", id: "chapter-1", narratorId: "s1", title: "书籍主叙述者", lastVisitedAt: 20 },
        ]}
        onNavigate={onNavigate}
      >
        <div data-testid="mobile-conversation-body">会话正文</div>
      </AgentShell>,
    );

    const mobileHeader = document.querySelector('[data-slot="mobile-shell-header"]');
    expect(mobileHeader).toBeTruthy();
    fireEvent.click(within(mobileHeader as HTMLElement).getByRole("button", { name: "打开会话抽屉" }));
    expect(screen.getByTestId("mobile-conversation-body")).toBeTruthy();

    const drawer = screen.getByRole("dialog", { name: "会话工作区" });
    fireEvent.click(within(drawer).getByRole("button", { name: /书籍主叙述者/ }));
    expect(onNavigate).toHaveBeenCalledWith({ kind: "narrator", sessionId: "s1" });
    expect(screen.getByTestId("mobile-conversation-body")).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "会话工作区" })).toBeNull();
  });

  it("opens the mobile shell as a labelled sheet and closes it after navigation", () => {
    const onNavigate = vi.fn<(route: ShellRoute) => void>();
    render(
      <AgentShell route={{ kind: "settings" }} books={books} sessions={sessions} onNavigate={onNavigate}>
        <div>设置画布</div>
      </AgentShell>,
    );

    const trigger = screen.getByRole("button", { name: "打开主导航" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);

    const sheet = screen.getByRole("dialog", { name: "NovelFork 主导航" });
    expect(within(sheet).getByRole("button", { name: "关闭主导航" })).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("button", { name: "搜索" }));

    expect(onNavigate).toHaveBeenCalledWith({ kind: "search" });
    expect(screen.queryByRole("dialog", { name: "NovelFork 主导航" })).toBeNull();
  });
});
