import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchJsonMock, useApiMock } = vi.hoisted(() => ({
  fetchJsonMock: vi.fn(),
  useApiMock: vi.fn(),
}));

vi.mock("../../hooks/use-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../hooks/use-api")>();
  return { ...actual, fetchJson: fetchJsonMock, useApi: useApiMock };
});

vi.mock("@/hooks/use-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../hooks/use-api")>();
  return { ...actual, fetchJson: fetchJsonMock, useApi: useApiMock };
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

import { WorkspacePage } from "./WorkspacePage";

const TEST_BOOK = {
  id: "book-1", title: "灵潮纪元",
};

const TEST_CHAPTERS = [
  { number: 1, title: "第一章 灵潮初起", status: "approved", wordCount: 3100, fileName: "0001-first.md" },
  { number: 2, title: "第二章 入城", status: "ready-for-review", wordCount: 3100, fileName: "0002-city.md" },
];

const booksResponse = { books: [{ id: TEST_BOOK.id, title: TEST_BOOK.title }] };
const bookDetailResponse = {
  book: { id: TEST_BOOK.id, title: TEST_BOOK.title, status: "active", chapterWordCount: 3000 },
  chapters: TEST_CHAPTERS.map((c) => ({ number: c.number, title: c.title, status: c.status, wordCount: c.wordCount, fileName: c.fileName })),
  nextChapter: 3,
};
const candidatesResponse = {
  candidates: [{ id: "candidate-2", bookId: TEST_BOOK.id, targetChapterId: "2", title: "第二章 AI 候选", source: "write-next", createdAt: "2026-04-27T02:00:00.000Z", status: "candidate", content: "AI 候选正文" }],
};
const storyFilesResponse = {
  files: [{ name: "pending_hooks.md", size: 128, preview: "# hooks" }],
};
const truthFilesResponse = {
  files: [{ name: "chapter_summaries.md", size: 256, preview: "# summaries" }],
};
const draftsResponse = {
  drafts: [{ id: "draft-1", bookId: TEST_BOOK.id, title: "城门冲突片段", content: "草稿正文", updatedAt: "2026-04-27T03:00:00.000Z", wordCount: 4 }],
};

afterEach(() => { cleanup(); vi.clearAllMocks(); });

beforeEach(() => {
  fetchJsonMock.mockReset();
  fetchJsonMock.mockImplementation(async (path: string) => {
    if (path === `/books/${TEST_BOOK.id}/chapters/1`) return { content: "测试正文" };
    if (path === `/books/${TEST_BOOK.id}/chapters/2`) return { content: "第二章正文" };
    if (path === `/books/${TEST_BOOK.id}/story-files/pending_hooks.md`) return { file: "pending_hooks.md", content: "# hooks\n\n待处理伏笔" };
    if (path === `/books/${TEST_BOOK.id}/truth-files/chapter_summaries.md`) return { file: "chapter_summaries.md", content: "# summaries\n\n第一章摘要" };
    return {};
  });
  useApiMock.mockImplementation((path: string | null) => {
    if (path === "/books") return { data: booksResponse, loading: false, error: null, refetch: vi.fn() };
    if (path === `/books/${TEST_BOOK.id}`) return { data: bookDetailResponse, loading: false, error: null, refetch: vi.fn() };
    if (path === `/books/${TEST_BOOK.id}/candidates`) return { data: candidatesResponse, loading: false, error: null, refetch: vi.fn() };
    if (path === `/books/${TEST_BOOK.id}/story-files`) return { data: storyFilesResponse, loading: false, error: null, refetch: vi.fn() };
    if (path === `/books/${TEST_BOOK.id}/truth-files`) return { data: truthFilesResponse, loading: false, error: null, refetch: vi.fn() };
    if (path === `/books/${TEST_BOOK.id}/drafts`) return { data: draftsResponse, loading: false, error: null, refetch: vi.fn() };
    return { data: null, loading: false, error: null, refetch: vi.fn() };
  });
});

describe("WorkspacePage", () => {
  it("renders a book resource tree and opens an existing chapter in the central editor", async () => {
    const loadChapter = vi.fn(async () => ({ content: "测试正文" }));
    const saveChapter = vi.fn(async () => undefined);
    render(<WorkspacePage chapterApi={{ loadChapter, saveChapter }} />);

    expect(screen.getByRole("combobox", { name: "作品选择" })).toBeTruthy();

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
    expect(within(editor).getByDisplayValue("AI 候选正文")).toBeTruthy();
    expect(within(editor).getByRole("button", { name: "合并到正式章节" })).toBeTruthy();
    expect(within(editor).getByRole("button", { name: "替换正式章节" })).toBeTruthy();
    expect(within(editor).getByRole("button", { name: "另存为草稿" })).toBeTruthy();
    expect(within(editor).getByRole("button", { name: "放弃候选稿" })).toBeTruthy();
  });

  it("uses explicit registered viewers for outline nodes and transparent unsupported state for structural groups", () => {
    render(<WorkspacePage />);

    const explorer = screen.getByRole("complementary", { name: "小说资源管理器" });
    fireEvent.click(within(explorer).getByRole("button", { name: /^大纲$/ }));
    expect(screen.getByText("OutlineEditor")).toBeTruthy();
    expect(screen.getByText(/大纲查看与编辑将在后续任务接入真实 story\/truth 文件/)).toBeTruthy();

    fireEvent.click(within(explorer).getByRole("button", { name: /^草稿/ }));
    expect(screen.getByText("草稿 当前不可直接编辑")).toBeTruthy();
    expect(screen.getByText(/该资源节点当前只作为结构容器存在/)).toBeTruthy();
  });

  it("loads real story and truth file content through the registered markdown viewer", async () => {
    render(<WorkspacePage />);

    const explorer = screen.getByRole("complementary", { name: "小说资源管理器" });
    fireEvent.click(within(explorer).getByRole("button", { name: /^pending_hooks\.md/ }));
    expect(await screen.findByText(/待处理伏笔/)).toBeTruthy();

    fireEvent.click(within(explorer).getByRole("button", { name: /^chapter_summaries\.md/ }));
    expect(await screen.findByText(/第一章摘要/)).toBeTruthy();
  });

  it("lists real drafts and saves draft content through DraftEditor", async () => {
    fetchJsonMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === `/books/${TEST_BOOK.id}/drafts/draft-1` && init?.method === "PUT") {
        return { draft: { ...draftsResponse.drafts[0], content: "修改后的草稿", wordCount: 6, updatedAt: "2026-04-27T04:00:00.000Z" } };
      }
      if (path === `/books/${TEST_BOOK.id}/drafts/draft-1`) return { draft: draftsResponse.drafts[0] };
      if (path === `/books/${TEST_BOOK.id}/chapters/1`) return { content: "测试正文" };
      if (path === `/books/${TEST_BOOK.id}/chapters/2`) return { content: "第二章正文" };
      return {};
    });

    render(<WorkspacePage />);
    const explorer = screen.getByRole("complementary", { name: "小说资源管理器" });
    fireEvent.click(within(explorer).getByRole("button", { name: /城门冲突片段/ }));

    expect(await screen.findByDisplayValue("草稿正文")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("草稿正文"), { target: { value: "修改后的草稿" } });
    expect(screen.getByText(/草稿保存状态：未保存/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));

    await waitFor(() => expect(fetchJsonMock).toHaveBeenCalledWith(`/books/${TEST_BOOK.id}/drafts/draft-1`, expect.objectContaining({ method: "PUT" })));
    expect(await screen.findByText(/草稿保存状态：已保存/)).toBeTruthy();
  });

  it("refreshes draft resources when a candidate is saved as draft", async () => {
    const createdDraft = { id: "draft-candidate-2", bookId: TEST_BOOK.id, title: "第二章 AI 候选", content: "候选另存草稿", updatedAt: "2026-04-27T04:00:00.000Z", wordCount: 6 };
    let draftResourceData = { drafts: [] as typeof draftsResponse.drafts };
    const draftsRefetch = vi.fn(async () => {
      draftResourceData = { drafts: [createdDraft] };
    });
    useApiMock.mockImplementation((path: string | null) => {
      if (path === "/books") return { data: booksResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}`) return { data: bookDetailResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/candidates`) return { data: candidatesResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/story-files`) return { data: storyFilesResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/truth-files`) return { data: truthFilesResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/drafts`) return { data: draftResourceData, loading: false, error: null, refetch: draftsRefetch };
      return { data: null, loading: false, error: null, refetch: vi.fn() };
    });
    fetchJsonMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === `/books/${TEST_BOOK.id}/candidates/candidate-2/accept` && init?.method === "POST") {
        return { draft: createdDraft };
      }
      if (path === `/books/${TEST_BOOK.id}/drafts/draft-candidate-2`) {
        return { draft: createdDraft };
      }
      if (path === `/books/${TEST_BOOK.id}/chapters/1`) return { content: "测试正文" };
      if (path === `/books/${TEST_BOOK.id}/chapters/2`) return { content: "第二章正文" };
      return {};
    });

    render(<WorkspacePage />);
    const explorer = screen.getByRole("complementary", { name: "小说资源管理器" });
    fireEvent.click(within(explorer).getByRole("button", { name: /第二章 AI 候选/ }));
    fireEvent.click(screen.getByRole("button", { name: "另存为草稿" }));

    await waitFor(() => expect(draftsRefetch).toHaveBeenCalled());
    const matchingNodes = await within(explorer).findAllByRole("button", { name: /第二章 AI 候选/ });
    const draftNode = matchingNodes.find((button) => button.getAttribute("aria-current") === null && button.textContent?.includes("6"));
    expect(draftNode).toBeTruthy();
    fireEvent.click(draftNode!);
    expect(await screen.findByDisplayValue("候选另存草稿")).toBeTruthy();
  });

  it("shows a transparent error when candidate content is missing", () => {
    useApiMock.mockImplementation((path: string | null) => {
      if (path === "/books") return { data: booksResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}`) return { data: bookDetailResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/candidates`) {
        return { data: { candidates: [{ ...candidatesResponse.candidates[0], content: null, contentError: "候选稿正文缺失：candidate-2.md" }] }, loading: false, error: null, refetch: vi.fn() };
      }
      if (path === `/books/${TEST_BOOK.id}/story-files`) return { data: storyFilesResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/truth-files`) return { data: truthFilesResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/drafts`) return { data: draftsResponse, loading: false, error: null, refetch: vi.fn() };
      return { data: null, loading: false, error: null, refetch: vi.fn() };
    });

    render(<WorkspacePage />);
    const explorer = screen.getByRole("complementary", { name: "小说资源管理器" });
    fireEvent.click(within(explorer).getByRole("button", { name: /第二章 AI 候选/ }));

    expect(screen.getByText(/候选稿正文缺失：candidate-2.md/)).toBeTruthy();
    expect(screen.queryByLabelText("候选稿正文")).toBeNull();
  });

  it("refreshes candidate resources after accepting or rejecting a generated candidate", async () => {
    let candidateResourceData = candidatesResponse;
    const candidatesRefetch = vi.fn(async () => {
      candidateResourceData = { candidates: [{ ...candidatesResponse.candidates[0], status: "accepted" as const }] };
    });
    const acceptCandidate = vi.fn(async () => ({ candidate: { ...candidatesResponse.candidates[0], status: "accepted" as const } }));
    const rejectCandidate = vi.fn(async () => ({ candidate: { ...candidatesResponse.candidates[0], status: "rejected" as const } }));
    useApiMock.mockImplementation((path: string | null) => {
      if (path === "/books") return { data: booksResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}`) return { data: bookDetailResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/candidates`) return { data: candidateResourceData, loading: false, error: null, refetch: candidatesRefetch };
      if (path === `/books/${TEST_BOOK.id}/story-files`) return { data: storyFilesResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/truth-files`) return { data: truthFilesResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/drafts`) return { data: draftsResponse, loading: false, error: null, refetch: vi.fn() };
      return { data: null, loading: false, error: null, refetch: vi.fn() };
    });

    render(<WorkspacePage candidateApi={{ acceptCandidate, rejectCandidate }} />);
    let explorer = screen.getByRole("complementary", { name: "小说资源管理器" });
    fireEvent.click(within(explorer).getByRole("button", { name: /第二章 AI 候选/ }));
    fireEvent.click(screen.getByRole("button", { name: "合并到正式章节" }));
    fireEvent.click(screen.getByRole("button", { name: "确认合并" }));

    await waitFor(() => expect(candidatesRefetch).toHaveBeenCalled());
    await waitFor(() => expect(within(explorer).queryByRole("button", { name: /第二章 AI 候选/ })).toBeNull());

    cleanup();
    candidateResourceData = candidatesResponse;
    candidatesRefetch.mockImplementation(async () => {
      candidateResourceData = { candidates: [{ ...candidatesResponse.candidates[0], status: "rejected" as const }] };
    });
    candidatesRefetch.mockClear();
    render(<WorkspacePage candidateApi={{ acceptCandidate: vi.fn(async () => undefined), rejectCandidate }} />);
    explorer = screen.getByRole("complementary", { name: "小说资源管理器" });
    fireEvent.click(within(explorer).getByRole("button", { name: /第二章 AI 候选/ }));
    fireEvent.click(screen.getByRole("button", { name: "放弃候选稿" }));

    await waitFor(() => expect(candidatesRefetch).toHaveBeenCalled());
    await waitFor(() => expect(within(explorer).queryByRole("button", { name: /第二章 AI 候选/ })).toBeNull());
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

    cleanup();
    render(<WorkspacePage candidateApi={{ acceptCandidate, rejectCandidate }} />);
    const replaceExplorer = screen.getByRole("complementary", { name: "小说资源管理器" });
    fireEvent.click(within(replaceExplorer).getByRole("button", { name: /第二章 AI 候选/ }));
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

    cleanup();
    render(<WorkspacePage candidateApi={{ acceptCandidate, rejectCandidate }} />);
    const rejectExplorer = screen.getByRole("complementary", { name: "小说资源管理器" });
    fireEvent.click(within(rejectExplorer).getByRole("button", { name: /第二章 AI 候选/ }));
    fireEvent.click(screen.getByRole("button", { name: "放弃候选稿" }));
    await waitFor(() => expect(rejectCandidate).toHaveBeenCalledWith("book-1", "candidate-2"));
  });

  it("runs the first AI panel action through the model gate and writes output to generated candidates", async () => {
    const candidatesRefetch = vi.fn(async () => undefined);
    useApiMock.mockImplementation((path: string | null) => {
      if (path === "/books") return { data: booksResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}`) return { data: bookDetailResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/candidates`) return { data: candidatesResponse, loading: false, error: null, refetch: candidatesRefetch };
      if (path === `/books/${TEST_BOOK.id}/story-files`) return { data: storyFilesResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/truth-files`) return { data: truthFilesResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/drafts`) return { data: draftsResponse, loading: false, error: null, refetch: vi.fn() };
      return { data: null, loading: false, error: null, refetch: vi.fn() };
    });
    const ensureModelFor = vi.fn(() => true);
    const runAction = vi.fn(async () => ({ message: "AI 输出已进入生成章节候选" }));
    render(<WorkspacePage assistantApi={{ runAction }} modelGate={{ blockedResult: null, closeGate: vi.fn(), ensureModelFor }} />);

    const assistant = screen.getByRole("complementary", { name: "AI 与经纬面板" });
    fireEvent.click(within(assistant).getByRole("button", { name: /生成下一章/ }));

    expect(ensureModelFor).toHaveBeenCalledWith("ai-writing");
    await waitFor(() => expect(runAction).toHaveBeenCalledWith("write-next", expect.objectContaining({ bookId: "book-1", selectedNodeTitle: "第一章 灵潮初起" })));
    await waitFor(() => expect(candidatesRefetch).toHaveBeenCalled());
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

  it("shows writing mode application as disabled when no editor write target is wired", () => {
    render(<WorkspacePage />);

    const assistant = screen.getByRole("complementary", { name: "AI 与经纬面板" });
    fireEvent.click(within(assistant).getByText("写作模式"));
    expect(within(assistant).getByText(/当前工作台尚未暴露安全写入目标/)).toBeTruthy();
  });

  it("persists applied chapter hooks through the workspace hook action", async () => {
    const storyFilesRefetch = vi.fn(async () => undefined);
    useApiMock.mockImplementation((path: string | null) => {
      if (path === "/books") return { data: booksResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}`) return { data: bookDetailResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/candidates`) return { data: candidatesResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/story-files`) return { data: storyFilesResponse, loading: false, error: null, refetch: storyFilesRefetch };
      if (path === `/books/${TEST_BOOK.id}/truth-files`) return { data: truthFilesResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/drafts`) return { data: draftsResponse, loading: false, error: null, refetch: vi.fn() };
      return { data: null, loading: false, error: null, refetch: vi.fn() };
    });
    fetchJsonMock.mockImplementation(async (path: string) => {
      if (path === `/books/${TEST_BOOK.id}/chapters/1`) return { content: "测试正文" };
      if (path === `/books/${TEST_BOOK.id}/hooks/generate`) {
        return {
          hooks: [{
            id: "hook-new",
            style: "suspense",
            text: "门外传来第三个人的脚步声。",
            rationale: "制造新问题",
            retentionEstimate: "high",
          }],
        };
      }
      if (path === `/books/${TEST_BOOK.id}/hooks/apply`) return { persisted: true, file: "pending_hooks.md" };
      return {};
    });

    render(<WorkspacePage />);

    const assistant = screen.getByRole("complementary", { name: "AI 与经纬面板" });
    fireEvent.click(within(assistant).getByText("写作工具"));
    fireEvent.click(within(assistant).getByRole("button", { name: "钩子生成" }));
    fireEvent.click(within(assistant).getByRole("button", { name: "生成章末钩子" }));

    expect(await within(assistant).findByText("门外传来第三个人的脚步声。")).toBeTruthy();
    fireEvent.click(within(assistant).getByRole("button", { name: "插入所选钩子" }));

    await waitFor(() => expect(fetchJsonMock).toHaveBeenLastCalledWith("/books/book-1/hooks/apply", expect.objectContaining({ method: "POST" })));
    await waitFor(() => expect(storyFilesRefetch).toHaveBeenCalled());
    expect(await within(assistant).findByText("钩子已写入 pending_hooks.md")).toBeTruthy();
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

  it("uses unified primary/outline button semantics for the top bar and selected resource node", () => {
    render(<WorkspacePage />);

    const newChapterButton = screen.getByRole("button", { name: "新建章节" });
    const exportButton = screen.getByRole("button", { name: "导出" });
    const publishButton = screen.getByRole("button", { name: "发布就绪" });
    const presetButton = screen.getByRole("button", { name: "预设管理" });

    expect(newChapterButton.hasAttribute("disabled")).toBe(false);
    expect(newChapterButton.getAttribute("title")).toBeNull();
    expect(newChapterButton.className).toContain("bg-primary");

    expect(exportButton.hasAttribute("disabled")).toBe(true);
    expect(exportButton.className).toContain("border-border");
    expect(exportButton.className).toContain("hover:bg-muted");

    expect(presetButton.hasAttribute("disabled")).toBe(true);
    expect(presetButton.getAttribute("title")).toBe("即将推出");
    expect(presetButton.className).toContain("border-border");

    fireEvent.click(publishButton);
    expect(publishButton.className).toContain("bg-primary");
    expect(publishButton.className).toContain("text-primary-foreground");

    const explorer = screen.getByRole("complementary", { name: "小说资源管理器" });
    const selectedNode = within(explorer).getByRole("button", { name: /第一章 灵潮初起/ });
    expect(selectedNode.getAttribute("aria-current")).toBe("page");
    expect(selectedNode.className).toContain("bg-primary");
    expect(selectedNode.className).toContain("text-primary-foreground");

    const candidateNode = within(explorer).getByRole("button", { name: /第二章 AI 候选/ });
    fireEvent.click(candidateNode);
    expect(candidateNode.getAttribute("aria-current")).toBe("page");
    expect(candidateNode.className).toContain("bg-primary");
    expect(candidateNode.className).toContain("text-primary-foreground");
    expect(selectedNode.getAttribute("aria-current")).toBeNull();
  });

  it("creates a chapter from the workspace, refreshes resources and opens the new editor", async () => {
    const newChapter = {
      number: 3,
      title: "第三章",
      status: "drafting",
      wordCount: 0,
      auditIssueCount: 0,
      updatedAt: "2026-04-29T00:00:00.000Z",
      fileName: "0003_第三章.md",
    };
    let bookResourceData = bookDetailResponse;
    const bookRefetch = vi.fn(async () => {
      bookResourceData = {
        ...bookDetailResponse,
        chapters: [...bookDetailResponse.chapters, newChapter],
        nextChapter: 4,
      };
    });
    useApiMock.mockImplementation((path: string | null) => {
      if (path === "/books") return { data: booksResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}`) return { data: bookResourceData, loading: false, error: null, refetch: bookRefetch };
      if (path === `/books/${TEST_BOOK.id}/candidates`) return { data: candidatesResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/story-files`) return { data: storyFilesResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/truth-files`) return { data: truthFilesResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/drafts`) return { data: draftsResponse, loading: false, error: null, refetch: vi.fn() };
      return { data: null, loading: false, error: null, refetch: vi.fn() };
    });
    fetchJsonMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === `/books/${TEST_BOOK.id}/chapters` && init?.method === "POST") {
        return { chapter: newChapter };
      }
      if (path === `/books/${TEST_BOOK.id}/chapters/3`) return { content: "# 第三章\n\n" };
      if (path === `/books/${TEST_BOOK.id}/chapters/1`) return { content: "测试正文" };
      if (path === `/books/${TEST_BOOK.id}/chapters/2`) return { content: "第二章正文" };
      return {};
    });

    render(<WorkspacePage />);
    fireEvent.click(screen.getByRole("button", { name: "新建章节" }));

    await waitFor(() => expect(fetchJsonMock).toHaveBeenCalledWith(`/books/${TEST_BOOK.id}/chapters`, expect.objectContaining({ method: "POST" })));
    await waitFor(() => expect(bookRefetch).toHaveBeenCalled());
    const explorer = screen.getByRole("complementary", { name: "小说资源管理器" });
    const newChapterNode = await within(explorer).findByRole("button", { name: /第三章/ });
    expect(newChapterNode.getAttribute("aria-current")).toBe("page");
    const editor = screen.getByRole("main", { name: "正文编辑区" });
    expect(within(editor).getByRole("heading", { name: "第三章" })).toBeTruthy();
    await waitFor(() => expect((within(editor).getByLabelText("章节正文") as HTMLTextAreaElement).value).toBe("# 第三章\n\n"));
  });

  it("shows a real create error without adding a front-end fake chapter node", async () => {
    fetchJsonMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === `/books/${TEST_BOOK.id}/chapters` && init?.method === "POST") {
        throw new Error("disk full");
      }
      if (path === `/books/${TEST_BOOK.id}/chapters/1`) return { content: "测试正文" };
      if (path === `/books/${TEST_BOOK.id}/chapters/2`) return { content: "第二章正文" };
      return {};
    });

    render(<WorkspacePage />);
    fireEvent.click(screen.getByRole("button", { name: "新建章节" }));

    expect(await screen.findByText("新建章节失败：disk full")).toBeTruthy();
    const explorer = screen.getByRole("complementary", { name: "小说资源管理器" });
    expect(within(explorer).queryByRole("button", { name: /第三章/ })).toBeNull();
    expect(within(explorer).getByRole("button", { name: /第一章 灵潮初起/ }).getAttribute("aria-current")).toBe("page");
  });

  it("uses semantic candidate actions and writing tool buttons for non-destructive workflow", () => {
    render(<WorkspacePage />);

    const explorer = screen.getByRole("complementary", { name: "小说资源管理器" });
    fireEvent.click(within(explorer).getByRole("button", { name: /第二章 AI 候选/ }));

    const mergeButton = screen.getByRole("button", { name: "合并到正式章节" });
    const replaceButton = screen.getByRole("button", { name: "替换正式章节" });
    const draftButton = screen.getByRole("button", { name: "另存为草稿" });
    const abandonButton = screen.getByRole("button", { name: "放弃候选稿" });

    expect(mergeButton.className).toContain("border-border");
    expect(replaceButton.className).toContain("border-border");
    expect(draftButton.className).toContain("border-border");
    expect(abandonButton.className).toContain("bg-destructive/10");
    expect(abandonButton.className).toContain("text-destructive");

    fireEvent.click(mergeButton);
    const confirmMerge = screen.getByRole("button", { name: "确认合并" });
    const cancelMerge = screen.getByRole("button", { name: "取消" });
    expect(confirmMerge.className).toContain("bg-primary");
    expect(confirmMerge.className).toContain("text-primary-foreground");
    expect(cancelMerge.className).toContain("border-border");

    const assistant = screen.getByRole("complementary", { name: "AI 与经纬面板" });
    fireEvent.click(within(assistant).getByText("写作模式"));
    const writingModeInline = within(assistant).getByRole("button", { name: "续写/扩写/补写" });
    const writingModeDialogue = within(assistant).getByRole("button", { name: "对话生成" });
    expect(writingModeInline.className).toContain("bg-primary");
    expect(writingModeInline.className).toContain("text-primary-foreground");
    expect(writingModeDialogue.className).toContain("border-border");
    expect(within(assistant).getByText(/当前工作台尚未暴露安全写入目标/)).toBeTruthy();

    fireEvent.click(within(assistant).getByText("写作工具"));
    const rhythmTab = within(assistant).getByRole("button", { name: "节奏分析" });
    const dialogueTab = within(assistant).getByRole("button", { name: "对话分析" });
    const runAnalysis = within(assistant).getByRole("button", { name: "运行节奏 + 对话分析" });
    expect(rhythmTab.className).toContain("bg-primary");
    expect(rhythmTab.className).toContain("text-primary-foreground");
    expect(dialogueTab.className).toContain("border-border");
    expect(runAnalysis.className).toContain("bg-primary");
    expect(runAnalysis.className).toContain("text-primary-foreground");
  });
});
