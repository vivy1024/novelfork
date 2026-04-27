import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const useApiMock = vi.hoisted(() => vi.fn());

vi.mock("../../hooks/use-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../hooks/use-api")>();
  return { ...actual, useApi: useApiMock };
});

vi.mock("../../components/InkEditor", () => {
  const { forwardRef, useImperativeHandle } = require("react");
  return {
    getMarkdown: () => "",
    InkEditor: forwardRef(function MockInkEditor(props: any, ref: any) {
      useImperativeHandle(ref, () => ({ getMarkdown: () => props.initialContent ?? "" }));
      return (
        <textarea
          aria-label="章节正文"
          value={props.initialContent ?? ""}
          onChange={(e: any) => props.onChange?.(e.target.value)}
        />
      );
    }),
  };
});

import { FALLBACK_BOOK, FALLBACK_CHAPTERS, WorkspacePage } from "./WorkspacePage";

const booksResponse = { books: [{ id: FALLBACK_BOOK.id, title: FALLBACK_BOOK.title }] };
const bookDetailResponse = {
  book: { id: FALLBACK_BOOK.id, title: FALLBACK_BOOK.title, status: "active", chapterWordCount: 3000 },
  chapters: FALLBACK_CHAPTERS.map((c) => ({ number: c.number, title: c.title, status: c.status, wordCount: c.wordCount, fileName: c.fileName })),
  nextChapter: 3,
};
const candidatesResponse = {
  candidates: [{ id: "candidate-2", bookId: FALLBACK_BOOK.id, targetChapterId: "2", title: "第二章 AI 候选", source: "write-next", createdAt: "2026-04-27T02:00:00.000Z", status: "candidate" }],
};

afterEach(() => { cleanup(); vi.clearAllMocks(); });

beforeEach(() => {
  useApiMock.mockImplementation((path: string | null) => {
    if (path === "/books") return { data: booksResponse, loading: false, error: null, refetch: vi.fn() };
    if (path === `/books/${FALLBACK_BOOK.id}`) return { data: bookDetailResponse, loading: false, error: null, refetch: vi.fn() };
    if (path === `/books/${FALLBACK_BOOK.id}/candidates`) return { data: candidatesResponse, loading: false, error: null, refetch: vi.fn() };
    return { data: null, loading: false, error: null, refetch: vi.fn() };
  });
});

describe("WorkspacePage", () => {
  it("renders a book resource tree and opens an existing chapter in the central editor", async () => {
    const loadChapter = vi.fn(async () => ({ content: "测试正文" }));
    const saveChapter = vi.fn(async () => undefined);
    render(<WorkspacePage chapterApi={{ loadChapter, saveChapter }} />);

    expect(screen.getByRole("combobox", { name: "作品选择" })).toBeTruthy();
    expect(screen.getByPlaceholderText("搜索章节 / 生成稿 / 经纬条目")).toBeTruthy();
    expect(screen.getByText("运行状态：空闲")).toBeTruthy();

    const explorer = screen.getByRole("complementary", { name: "小说资源管理器" });
    expect(within(explorer).getByRole("button", { name: /已有章节/ })).toBeTruthy();
    fireEvent.click(within(explorer).getByRole("button", { name: /第一章 灵潮初起/ }));

    const editor = screen.getByRole("main", { name: "正文编辑区" });
    expect(within(editor).getByRole("heading", { name: "第一章 灵潮初起" })).toBeTruthy();
    expect(within(editor).getByText(/章节状态：approved/)).toBeTruthy();
    await waitFor(() => expect(within(editor).getByLabelText("章节正文")).toBeTruthy());
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

  it("shows bible panel with tab switching in the right panel", () => {
    render(<WorkspacePage />);

    const assistant = screen.getByRole("complementary", { name: "AI 与经纬面板" });
    expect(within(assistant).getByText("经纬资料库")).toBeTruthy();
    expect(within(assistant).getByRole("button", { name: "人物" })).toBeTruthy();
    expect(within(assistant).getByRole("button", { name: "事件" })).toBeTruthy();
    expect(within(assistant).getByRole("button", { name: "设定" })).toBeTruthy();
    expect(within(assistant).getByRole("button", { name: "摘要" })).toBeTruthy();
  });

  it("shows create form for bible entries in the right panel", () => {
    render(<WorkspacePage />);

    const assistant = screen.getByRole("complementary", { name: "AI 与经纬面板" });
    fireEvent.click(within(assistant).getByRole("button", { name: /新建人物/ }));
    expect(within(assistant).getByLabelText("人物名称")).toBeTruthy();
    expect(within(assistant).getByLabelText("人物内容")).toBeTruthy();
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

  it("exposes writing tools panel with chapter-context tools and daily progress", () => {
    render(<WorkspacePage />);

    const assistant = screen.getByRole("complementary", { name: "AI 与经纬面板" });
    const toolsToggle = within(assistant).getByText("写作工具");
    expect(toolsToggle).toBeTruthy();

    fireEvent.click(toolsToggle);
    expect(within(assistant).getByText("节奏分析")).toBeTruthy();
    expect(within(assistant).getByText("对话分析")).toBeTruthy();
    expect(within(assistant).getByText("钩子生成")).toBeTruthy();
    expect(within(assistant).getByText("日更进度")).toBeTruthy();
  });

  it("shows non-chapter hint when writing tools are opened on a non-chapter node", () => {
    render(<WorkspacePage />);

    const explorer = screen.getByRole("complementary", { name: "小说资源管理器" });
    fireEvent.click(within(explorer).getByRole("button", { name: /人物/ }));

    const assistant = screen.getByRole("complementary", { name: "AI 与经纬面板" });
    fireEvent.click(within(assistant).getByText("写作工具"));
    expect(within(assistant).getByText(/请选择一个章节/)).toBeTruthy();
  });

  it("provides publish readiness and preset manager entry links in the top bar", () => {
    render(<WorkspacePage />);

    expect(screen.getByText("发布就绪")).toBeTruthy();
    expect(screen.getByText("预设管理")).toBeTruthy();
  });
});
