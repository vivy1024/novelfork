import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./UsersTab", () => ({
  UsersTab: () => <div>UsersTab Mock</div>,
}));

vi.mock("./ProvidersTab", () => ({
  ProvidersTab: () => <div>ProvidersTab Mock</div>,
}));

vi.mock("./ResourcesTab", () => ({
  ResourcesTab: () => <div>ResourcesTab Mock</div>,
}));

vi.mock("./RequestsTab", () => ({
  RequestsTab: () => <div>RequestsTab Mock</div>,
}));

vi.mock("./DaemonTab", () => ({
  DaemonTab: () => <div>DaemonTab Mock</div>,
}));

vi.mock("./LogsTab", () => ({
  LogsTab: () => <div>LogsTab Mock</div>,
}));

vi.mock("./WorktreesTab", () => ({
  WorktreesTab: () => <div>WorktreesTab Mock</div>,
}));

import { Admin } from "./Admin";

describe("Admin", () => {
  it("shows daemon, logs, and worktree entry cards in overview", () => {
    const onNavigateSection = vi.fn();

    render(<Admin section="overview" onNavigateSection={onNavigateSection} />);

    fireEvent.click(screen.getByRole("button", { name: /守护进程/i }));
    fireEvent.click(screen.getByRole("button", { name: /日志/i }));
    fireEvent.click(screen.getByRole("button", { name: /worktree/i }));

    expect(onNavigateSection).toHaveBeenNthCalledWith(1, "daemon");
    expect(onNavigateSection).toHaveBeenNthCalledWith(2, "logs");
    expect(onNavigateSection).toHaveBeenNthCalledWith(3, "worktrees");
  });

  it("renders the daemon tab instead of a placeholder", () => {
    render(<Admin section="daemon" onNavigateSection={() => {}} />);

    expect(screen.getByText("DaemonTab Mock")).toBeTruthy();
  });

  it("renders the logs tab content", () => {
    render(<Admin section="logs" onNavigateSection={() => {}} />);

    expect(screen.getByText("LogsTab Mock")).toBeTruthy();
  });

  it("renders the selected admin tab content", () => {
    render(<Admin section="providers" onNavigateSection={() => {}} />);

    expect(screen.getByText("ProvidersTab Mock")).toBeTruthy();
  });
});
