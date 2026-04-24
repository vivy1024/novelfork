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
  RequestsTab: ({ onOpenRun }: { onOpenRun?: (runId: string) => void }) => (
    <div>
      <div>RequestsTab Mock</div>
      <div>{onOpenRun ? "Requests OpenRun Ready" : "Requests OpenRun Missing"}</div>
    </div>
  ),
}));

vi.mock("./LogsTab", () => ({
  LogsTab: ({ onOpenRun }: { onOpenRun?: (runId: string) => void }) => (
    <div>
      <div>LogsTab Mock</div>
      <div>{onOpenRun ? "Logs OpenRun Ready" : "Logs OpenRun Missing"}</div>
    </div>
  ),
}));

vi.mock("./ContainerTab", () => ({
  ContainerTab: () => <div>ContainerTab Mock</div>,
}));

vi.mock("./DaemonTab", () => ({
  DaemonTab: () => <div>DaemonTab Mock</div>,
}));

vi.mock("./WorktreesTab", () => ({
  WorktreesTab: () => <div>WorktreesTab Mock</div>,
}));

import { Admin } from "./Admin";

describe("Admin", () => {
  it("shows daemon, logs, worktree, and container entry cards in overview", () => {
    const onNavigateSection = vi.fn();

    render(<Admin section="overview" onNavigateSection={onNavigateSection} />);

    fireEvent.click(screen.getByRole("button", { name: /守护进程/i }));
    fireEvent.click(screen.getByRole("button", { name: /日志/i }));
    fireEvent.click(screen.getByRole("button", { name: /worktree/i }));
    fireEvent.click(screen.getByRole("button", { name: /容器/i }));

    expect(onNavigateSection).toHaveBeenNthCalledWith(1, "daemon");
    expect(onNavigateSection).toHaveBeenNthCalledWith(2, "logs");
    expect(onNavigateSection).toHaveBeenNthCalledWith(3, "worktrees");
    expect(onNavigateSection).toHaveBeenNthCalledWith(4, "container");
  });

  it("renders the selected admin tab content", () => {
    render(<Admin section="providers" onNavigateSection={() => {}} />);

    expect(screen.getByText("ProvidersTab Mock")).toBeTruthy();
  });

  it("passes run drill-down affordances into requests and logs tabs", () => {
    const onOpenRun = vi.fn();
    const { rerender } = render(<Admin section="requests" onNavigateSection={() => {}} onOpenRun={onOpenRun} />);

    expect(screen.getByText("RequestsTab Mock")).toBeTruthy();
    expect(screen.getByText("Requests OpenRun Ready")).toBeTruthy();

    rerender(<Admin section="logs" onNavigateSection={() => {}} onOpenRun={onOpenRun} />);

    expect(screen.getByText("LogsTab Mock")).toBeTruthy();
    expect(screen.getByText("Logs OpenRun Ready")).toBeTruthy();
  });

  it("renders daemon, worktree, and container tab content", () => {
    const { rerender } = render(<Admin section="daemon" onNavigateSection={() => {}} />);
    expect(screen.getByText("DaemonTab Mock")).toBeTruthy();

    rerender(<Admin section="worktrees" onNavigateSection={() => {}} />);
    expect(screen.getByText("WorktreesTab Mock")).toBeTruthy();

    rerender(<Admin section="container" onNavigateSection={() => {}} />);
    expect(screen.getByText("ContainerTab Mock")).toBeTruthy();
  });
});
