import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Sidebar } from "./Sidebar";

afterEach(() => { cleanup(); });

describe("Sidebar", () => {
  it("renders brand, storyline section, narrator section, and footer buttons", () => {
    render(<Sidebar />);

    expect(screen.getByText("NovelFork Studio")).toBeTruthy();
    expect(screen.getByText("叙事线")).toBeTruthy();
    expect(screen.getByText("叙述者")).toBeTruthy();
    expect(screen.getByText("套路")).toBeTruthy();
    expect(screen.getByText("设置")).toBeTruthy();
  });

  it("shows empty state when no content is provided", () => {
    render(<Sidebar />);

    expect(screen.getByText("暂无叙事线")).toBeTruthy();
    expect(screen.getByText("暂无活跃会话")).toBeTruthy();
  });

  it("renders custom storyline and narrator content", () => {
    render(
      <Sidebar
        storylineContent={<div>书A</div>}
        narratorContent={<div>会话1</div>}
      />,
    );

    expect(screen.getByText("书A")).toBeTruthy();
    expect(screen.getByText("会话1")).toBeTruthy();
  });

  it("collapses and expands storyline section on click", () => {
    render(<Sidebar storylineContent={<div>书A</div>} />);

    expect(screen.getByText("书A")).toBeTruthy();

    fireEvent.click(screen.getByText("叙事线"));
    expect(screen.queryByText("书A")).toBeNull();

    fireEvent.click(screen.getByText("叙事线"));
    expect(screen.getByText("书A")).toBeTruthy();
  });

  it("collapses and expands narrator section on click", () => {
    render(<Sidebar narratorContent={<div>会话1</div>} />);

    expect(screen.getByText("会话1")).toBeTruthy();

    fireEvent.click(screen.getByText("叙述者"));
    expect(screen.queryByText("会话1")).toBeNull();

    fireEvent.click(screen.getByText("叙述者"));
    expect(screen.getByText("会话1")).toBeTruthy();
  });

  it("calls onRoutinesClick and onSettingsClick", () => {
    const onRoutines = vi.fn();
    const onSettings = vi.fn();

    render(<Sidebar onRoutinesClick={onRoutines} onSettingsClick={onSettings} />);

    fireEvent.click(screen.getByText("套路"));
    expect(onRoutines).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByText("设置"));
    expect(onSettings).toHaveBeenCalledOnce();
  });

  it("renders storyline and narrator action buttons", () => {
    render(
      <Sidebar
        storylineActions={<button type="button">新建</button>}
        narratorActions={<button type="button">+</button>}
      />,
    );

    expect(screen.getByText("新建")).toBeTruthy();
    expect(screen.getByText("+")).toBeTruthy();
  });

  it("displays version number in footer", () => {
    render(<Sidebar />);
    const sidebar = screen.getByTestId("studio-sidebar");
    expect(sidebar.textContent).toContain("v0.");
  });
});
