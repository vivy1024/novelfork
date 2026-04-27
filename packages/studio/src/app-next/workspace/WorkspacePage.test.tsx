import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { WorkspacePage } from "./WorkspacePage";

afterEach(() => cleanup());

describe("WorkspacePage", () => {
  it("renders a book resource tree and opens an existing chapter in the central editor", () => {
    render(<WorkspacePage />);

    expect(screen.getByRole("combobox", { name: "作品选择" })).toBeTruthy();
    expect(screen.getByPlaceholderText("搜索章节 / 生成稿 / 经纬条目")).toBeTruthy();
    expect(screen.getByText("运行状态：空闲")).toBeTruthy();

    const explorer = screen.getByRole("complementary", { name: "小说资源管理器" });
    expect(within(explorer).getByRole("button", { name: /已有章节/ })).toBeTruthy();
    fireEvent.click(within(explorer).getByRole("button", { name: /第一章 灵潮初起/ }));

    const editor = screen.getByRole("main", { name: "正文编辑区" });
    expect(within(editor).getByRole("heading", { name: "第一章 灵潮初起" })).toBeTruthy();
    expect(within(editor).getByText(/章节状态：approved/)).toBeTruthy();
    expect(within(editor).getByLabelText("章节正文")).toBeTruthy();
    expect(within(editor).getByText("生成稿 vs 已有章节")).toBeTruthy();
  });

  it("opens generated candidates as non-destructive candidate drafts with explicit actions", () => {
    render(<WorkspacePage />);

    const explorer = screen.getByRole("complementary", { name: "小说资源管理器" });
    fireEvent.click(within(explorer).getByRole("button", { name: /第二章 AI 候选/ }));

    const editor = screen.getByRole("main", { name: "正文编辑区" });
    expect(within(editor).getByRole("heading", { name: "第二章 AI 候选" })).toBeTruthy();
    expect(within(editor).getByText("候选稿 / 不会自动覆盖正式正文")).toBeTruthy();
    expect(within(editor).getByRole("button", { name: "合并到正式章节" })).toBeTruthy();
    expect(within(editor).getByRole("button", { name: "替换正式章节" })).toBeTruthy();
    expect(within(editor).getByRole("button", { name: "另存为草稿" })).toBeTruthy();
  });

  it("opens bible categories and keeps AI actions tied to the selected writing context", () => {
    render(<WorkspacePage />);

    const explorer = screen.getByRole("complementary", { name: "小说资源管理器" });
    fireEvent.click(within(explorer).getByRole("button", { name: /人物/ }));

    const editor = screen.getByRole("main", { name: "正文编辑区" });
    expect(within(editor).getByRole("heading", { name: "人物" })).toBeTruthy();
    expect(within(editor).getByText("经纬资料详情")).toBeTruthy();

    const assistant = screen.getByRole("complementary", { name: "AI 与经纬面板" });
    expect(within(assistant).getByRole("button", { name: /生成下一章/ })).toBeTruthy();
    expect(within(assistant).getByText(/当前上下文：人物/)).toBeTruthy();
  });
});
