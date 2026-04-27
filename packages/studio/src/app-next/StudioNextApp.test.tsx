import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { StudioNextApp } from "./StudioNextApp";

afterEach(() => cleanup());

describe("StudioNextApp", () => {
  it("defaults to the novel writing workspace instead of the legacy dashboard", () => {
    render(<StudioNextApp initialRoute="workspace" />);

    expect(screen.getByRole("banner")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Studio Next 主导航" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "创作工作台" })).toBeTruthy();
    expect(screen.getByText("资源管理器")).toBeTruthy();
    expect(screen.getByText("AI / 经纬面板")).toBeTruthy();
  });

  it("switches between the first-phase workspace, settings and routines pages", () => {
    render(<StudioNextApp initialRoute="workspace" />);

    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    expect(screen.getByRole("heading", { name: "设置" })).toBeTruthy();
    expect(screen.getByText("个人设置")).toBeTruthy();
    expect(screen.getByText("实例管理")).toBeTruthy();
    expect(screen.getByRole("button", { name: /个人资料/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /模型/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /AI 供应商/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "套路" }));
    expect(screen.getByRole("heading", { name: "套路" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "MCP 工具" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "钩子" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "创作工作台" }));
    expect(screen.getByRole("heading", { name: "创作工作台" })).toBeTruthy();
  });
});
