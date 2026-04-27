import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { resolveStudioEntryMode, resolveStudioNextRoute } from "./entry";
import { StudioNextApp } from "./StudioNextApp";

afterEach(() => cleanup());

describe("Studio Next routing", () => {
  it("preserves legacy routes — non-/next paths stay on legacy entry", () => {
    expect(resolveStudioEntryMode("/")).toBe("legacy");
    expect(resolveStudioEntryMode("/books/demo")).toBe("legacy");
    expect(resolveStudioEntryMode("/settings")).toBe("legacy");
    expect(resolveStudioEntryMode("/routines")).toBe("legacy");
  });

  it("routes /next paths to the new entry", () => {
    expect(resolveStudioEntryMode("/next")).toBe("next");
    expect(resolveStudioEntryMode("/next/settings")).toBe("next");
    expect(resolveStudioEntryMode("/next/routines")).toBe("next");
    expect(resolveStudioEntryMode("/next/workspace")).toBe("next");
  });

  it("resolves sub-routes within the new entry", () => {
    expect(resolveStudioNextRoute("/next")).toBe("workspace");
    expect(resolveStudioNextRoute("/next/settings")).toBe("settings");
    expect(resolveStudioNextRoute("/next/routines")).toBe("routines");
    expect(resolveStudioNextRoute("/next/unknown")).toBe("workspace");
  });

  it("navigates between all three first-phase pages without page reload", () => {
    render(<StudioNextApp initialRoute="workspace" />);

    expect(screen.getByRole("heading", { name: "创作工作台" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    expect(screen.getByRole("heading", { name: "设置" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "套路" }));
    expect(screen.getByRole("heading", { name: "套路" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "创作工作台" }));
    expect(screen.getByRole("heading", { name: "创作工作台" })).toBeTruthy();
  });

  it("settings page supports section switching — only right side updates", () => {
    render(<StudioNextApp initialRoute="settings" />);

    const settingsNav = screen.getByRole("navigation", { name: "设置分区" });
    expect(within(settingsNav).getByRole("button", { name: /个人资料/ })).toBeTruthy();
    expect(within(settingsNav).getByRole("button", { name: /AI 供应商/ })).toBeTruthy();

    fireEvent.click(within(settingsNav).getByRole("button", { name: /个人资料/ }));
    expect(screen.getAllByText(/Git 用户名/).length).toBeGreaterThan(0);

    fireEvent.click(within(settingsNav).getByRole("button", { name: /关于/ }));
    expect(screen.getAllByText(/NovelFork/).length).toBeGreaterThan(0);
  });

  it("workspace resource tree click updates the central editor", () => {
    render(<StudioNextApp initialRoute="workspace" />);

    const explorer = screen.getByRole("complementary", { name: "小说资源管理器" });
    fireEvent.click(within(explorer).getByRole("button", { name: /第二章 AI 候选/ }));

    const editor = screen.getByRole("main", { name: "正文编辑区" });
    expect(within(editor).getByRole("heading", { name: "第二章 AI 候选" })).toBeTruthy();
  });

  it("workspace top bar has publish readiness and preset manager entry links", () => {
    render(<StudioNextApp initialRoute="workspace" />);

    expect(screen.getByText("发布就绪")).toBeTruthy();
    expect(screen.getByText("预设管理")).toBeTruthy();
  });

  it("workspace writing tools panel is accessible from the assistant panel", () => {
    render(<StudioNextApp initialRoute="workspace" />);

    const assistant = screen.getByRole("complementary", { name: "AI 与经纬面板" });
    expect(within(assistant).getByText("写作工具")).toBeTruthy();
  });
});
