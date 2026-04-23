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

vi.mock("./LogsTab", () => ({
  LogsTab: () => <div>LogsTab Mock</div>,
}));

vi.mock("./TerminalTab", () => ({
  TerminalTab: () => <div>TerminalTab Mock</div>,
}));

vi.mock("./ContainerTab", () => ({
  ContainerTab: () => <div>ContainerTab Mock</div>,
}));

import { Admin } from "./Admin";

describe("Admin", () => {
  it("shows daemon, logs, worktree, terminal, and container entry cards in overview", () => {
    const onNavigateSection = vi.fn();

    render(<Admin section="overview" onNavigateSection={onNavigateSection} />);

    fireEvent.click(screen.getByRole("button", { name: /守护进程/i }));
    fireEvent.click(screen.getByRole("button", { name: /日志/i }));
    fireEvent.click(screen.getByRole("button", { name: /worktree/i }));
    fireEvent.click(screen.getByRole("button", { name: /终端/i }));
    fireEvent.click(screen.getByRole("button", { name: /容器/i }));

    expect(onNavigateSection).toHaveBeenNthCalledWith(1, "daemon");
    expect(onNavigateSection).toHaveBeenNthCalledWith(2, "logs");
    expect(onNavigateSection).toHaveBeenNthCalledWith(3, "worktrees");
    expect(onNavigateSection).toHaveBeenNthCalledWith(4, "terminal");
    expect(onNavigateSection).toHaveBeenNthCalledWith(5, "container");
  });

  it("renders the selected admin tab content", () => {
    render(<Admin section="providers" onNavigateSection={() => {}} />);

    expect(screen.getByText("ProvidersTab Mock")).toBeTruthy();
  });

  it("renders terminal, logs, and container tab content", () => {
    const { rerender } = render(<Admin section="terminal" onNavigateSection={() => {}} />);

    expect(screen.getByText("TerminalTab Mock")).toBeTruthy();

    rerender(<Admin section="logs" onNavigateSection={() => {}} />);

    expect(screen.getByText("LogsTab Mock")).toBeTruthy();

    rerender(<Admin section="container" onNavigateSection={() => {}} />);

    expect(screen.getByText("ContainerTab Mock")).toBeTruthy();
  });
});
