import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentShell } from "./AgentShell";
import type { ShellRoute } from "./shell-route";

const books = [{ id: "b1", title: "第一本书" }];
const sessions = [{ id: "s1", title: "主叙述者", status: "active" as const, projectId: "b1", projectName: "第一本书" }];

afterEach(() => cleanup());

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
    expect(screen.getByTestId("shell-sidebar").textContent).toContain("主叙述者");
    expect(screen.getByRole("button", { name: "第一本书" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("画布挂载点")).toBeTruthy();
  });

  it("routes sidebar clicks through the shell owner", () => {
    const onNavigate = vi.fn<(route: ShellRoute) => void>();
    render(
      <AgentShell route={{ kind: "home" }} books={books} sessions={sessions} onNavigate={onNavigate}>
        <div>占位</div>
      </AgentShell>,
    );

    fireEvent.click(screen.getByRole("button", { name: "主叙述者" }));
    expect(onNavigate).toHaveBeenCalledWith({ kind: "narrator", sessionId: "s1" });

    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    expect(onNavigate).toHaveBeenCalledWith({ kind: "search" });
  });
});
