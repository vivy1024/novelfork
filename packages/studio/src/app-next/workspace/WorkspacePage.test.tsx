import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

  it("loads, edits and saves existing chapter content through the migrated chapter API", async () => {
    const loadChapter = vi.fn(async () => ({ content: "远端正式正文" }));
    const saveChapter = vi.fn(async () => undefined);
    render(<WorkspacePage chapterApi={{ loadChapter, saveChapter }} />);

    const explorer = screen.getByRole("complementary", { name: "小说资源管理器" });
    fireEvent.click(within(explorer).getByRole("button", { name: /第一章 灵潮初起/ }));
    await waitFor(() => expect(screen.getByDisplayValue("远端正式正文")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("章节正文"), { target: { value: "修改后的正文" } });
    expect(screen.getByText(/保存状态：未保存/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(saveChapter).toHaveBeenCalledWith("book-1", 1, "修改后的正文"));
    expect(screen.getByText(/保存状态：已保存/)).toBeTruthy();
  });

  it("shows save errors without losing unsaved chapter edits", async () => {
    const loadChapter = vi.fn(async () => ({ content: "远端正式正文" }));
    const saveChapter = vi.fn(async () => { throw new Error("disk full"); });
    render(<WorkspacePage chapterApi={{ loadChapter, saveChapter }} />);

    await waitFor(() => expect(screen.getByDisplayValue("远端正式正文")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("章节正文"), { target: { value: "仍需保留" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(screen.getByText("保存失败：disk full")).toBeTruthy());
    expect(screen.getByDisplayValue("仍需保留")).toBeTruthy();
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
    expect(within(editor).getByRole("button", { name: "放弃候选稿" })).toBeTruthy();
  });

  it("confirms merge or replace before accepting a generated candidate", async () => {
    const acceptCandidate = vi.fn(async () => undefined);
    const rejectCandidate = vi.fn(async () => undefined);
    render(<WorkspacePage candidateApi={{ acceptCandidate, rejectCandidate }} />);

    const explorer = screen.getByRole("complementary", { name: "小说资源管理器" });
    fireEvent.click(within(explorer).getByRole("button", { name: /第二章 AI 候选/ }));
    fireEvent.click(screen.getByRole("button", { name: "合并到正式章节" }));

    expect(screen.getByText("确认合并到正式章节")).toBeTruthy();
    expect(screen.getAllByText("目标章节：2").length).toBeGreaterThan(0);
    expect(screen.getByText(/影响范围：追加到正式章节末尾/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认合并" }));

    await waitFor(() => expect(acceptCandidate).toHaveBeenCalledWith("book-1", "candidate-2", "merge"));
    expect(screen.getByText("候选稿已合并到正式章节")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "替换正式章节" }));
    expect(screen.getByText("确认替换到正式章节")).toBeTruthy();
    expect(screen.getByText(/影响范围：用候选稿替换目标正式章节正文/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认替换" }));
    await waitFor(() => expect(acceptCandidate).toHaveBeenCalledWith("book-1", "candidate-2", "replace"));
  });

  it("can save a generated candidate as draft or abandon it without touching formal chapters", async () => {
    const acceptCandidate = vi.fn(async () => undefined);
    const rejectCandidate = vi.fn(async () => undefined);
    render(<WorkspacePage candidateApi={{ acceptCandidate, rejectCandidate }} />);

    const explorer = screen.getByRole("complementary", { name: "小说资源管理器" });
    fireEvent.click(within(explorer).getByRole("button", { name: /第二章 AI 候选/ }));
    fireEvent.click(screen.getByRole("button", { name: "另存为草稿" }));
    await waitFor(() => expect(acceptCandidate).toHaveBeenCalledWith("book-1", "candidate-2", "draft"));
    expect(screen.getByText("候选稿已另存为草稿")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "放弃候选稿" }));
    await waitFor(() => expect(rejectCandidate).toHaveBeenCalledWith("book-1", "candidate-2"));
  });

  it("runs the first AI panel action through the model gate and writes output to generated candidates", async () => {
    const ensureModelFor = vi.fn(() => true);
    const runAction = vi.fn(async () => ({ message: "AI 输出已进入生成章节候选" }));
    render(<WorkspacePage assistantApi={{ runAction }} modelGate={{ blockedResult: null, closeGate: vi.fn(), ensureModelFor }} />);

    const assistant = screen.getByRole("complementary", { name: "AI 与经纬面板" });
    fireEvent.click(within(assistant).getByRole("button", { name: /生成下一章/ }));

    expect(ensureModelFor).toHaveBeenCalledWith("ai-writing");
    await waitFor(() => expect(runAction).toHaveBeenCalledWith("write-next", expect.objectContaining({ bookId: "book-1", selectedNodeTitle: "第一章 灵潮初起" })));
    expect(screen.getByText("AI 输出已进入生成章节候选")).toBeTruthy();
  });

  it("opens the AI gate instead of running actions when no usable model is configured", () => {
    const ensureModelFor = vi.fn(() => false);
    const runAction = vi.fn(async () => ({ message: "should not run" }));
    render(<WorkspacePage assistantApi={{ runAction }} modelGate={{ blockedResult: { ok: false, action: "ai-writing", reason: "model-not-configured", message: "此功能需要配置 AI 模型。" }, closeGate: vi.fn(), ensureModelFor }} />);

    fireEvent.click(screen.getByRole("button", { name: /生成下一章/ }));

    expect(runAction).not.toHaveBeenCalled();
    expect(screen.getByText("此功能需要配置 AI 模型。")).toBeTruthy();
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
