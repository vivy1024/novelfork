import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchJsonMock, postApiMock, putApiMock, useApiMock } = vi.hoisted(() => ({
  fetchJsonMock: vi.fn(),
  postApiMock: vi.fn(),
  putApiMock: vi.fn(),
  useApiMock: vi.fn(),
}));

vi.mock("../../hooks/use-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../hooks/use-api")>();
  return { ...actual, fetchJson: fetchJsonMock, postApi: postApiMock, putApi: putApiMock, useApi: useApiMock };
});

vi.mock("@/hooks/use-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../hooks/use-api")>();
  return { ...actual, fetchJson: fetchJsonMock, postApi: postApiMock, putApi: putApiMock, useApi: useApiMock };
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
  candidates: [
    {
      id: "candidate-2",
      bookId: TEST_BOOK.id,
      targetChapterId: "2",
      title: "第二章 AI 候选",
      source: "write-next",
      createdAt: "2026-04-27T02:00:00.000Z",
      status: "candidate",
      content: "AI 候选正文",
      metadata: { provider: "sub2api", model: "gpt-5.4", requestId: "run-cand-2" },
    },
  ],
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
  postApiMock.mockReset();
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
  it("connects resource-tree empty-state actions to real workspace operations", async () => {
    const refetchBookDetail = vi.fn(async () => undefined);
    const refetchCandidates = vi.fn(async () => undefined);
    useApiMock.mockImplementation((path: string | null) => {
      if (path === "/books") return { data: booksResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}`) return { data: { ...bookDetailResponse, chapters: [], nextChapter: 1 }, loading: false, error: null, refetch: refetchBookDetail };
      if (path === `/books/${TEST_BOOK.id}/candidates`) return { data: { candidates: [] }, loading: false, error: null, refetch: refetchCandidates };
      if (path === `/books/${TEST_BOOK.id}/story-files`) return { data: { files: [] }, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/truth-files`) return { data: { files: [] }, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/drafts`) return { data: { drafts: [] }, loading: false, error: null, refetch: vi.fn() };
      return { data: null, loading: false, error: null, refetch: vi.fn() };
    });
    fetchJsonMock.mockImplementation(async (path: string) => {
      if (path === `/books/${TEST_BOOK.id}/chapters`) return { chapter: { number: 1 } };
      if (path === `/books/${TEST_BOOK.id}/import/chapters`) return { importedCount: 1 };
      return {};
    });
    const assistantApi = { runAction: vi.fn(async () => ({ message: "AI 输出已进入生成章节候选", resourceMutationTarget: "candidates" as const })) };

    render(<WorkspacePage assistantApi={assistantApi} />);
    const explorer = screen.getByRole("complementary", { name: "小说资源管理器" });

    const createButton = within(explorer).getByRole("button", { name: "创建章节" }) as HTMLButtonElement;
    expect(createButton.disabled).toBe(false);
    fireEvent.click(createButton);
    await waitFor(() => expect(fetchJsonMock).toHaveBeenCalledWith(`/books/${TEST_BOOK.id}/chapters`, expect.objectContaining({ method: "POST" })));

    const generateButton = within(explorer).getByRole("button", { name: "生成下一章" }) as HTMLButtonElement;
    expect(generateButton.disabled).toBe(false);
    fireEvent.click(generateButton);
    await waitFor(() => expect(assistantApi.runAction).toHaveBeenCalledWith("write-next", expect.objectContaining({ bookId: TEST_BOOK.id })));
    await waitFor(() => expect(refetchCandidates).toHaveBeenCalled());

    const importButton = within(explorer).getByRole("button", { name: "导入章节" }) as HTMLButtonElement;
    expect(importButton.disabled).toBe(false);
    fireEvent.click(importButton);
    fireEvent.change(screen.getByLabelText("导入章节文本"), { target: { value: "第一章 新章\n正文" } });
    fireEvent.click(screen.getByRole("button", { name: "导入章节" }));
    await waitFor(() => expect(fetchJsonMock).toHaveBeenCalledWith(`/books/${TEST_BOOK.id}/import/chapters`, expect.objectContaining({ method: "POST" })));
    await waitFor(() => expect(refetchBookDetail).toHaveBeenCalled());

    const outlineButton = within(explorer).getByRole("button", { name: "打开大纲编辑器" }) as HTMLButtonElement;
    expect(outlineButton.disabled).toBe(false);
    fireEvent.click(outlineButton);
    expect(screen.getByRole("heading", { name: "大纲" })).toBeTruthy();
  });

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
    expect(within(editor).getByText(/章节状态：已定稿/)).toBeTruthy();
    expect(within(editor).queryByText(/章节状态：approved|章节状态：unknown/)).toBeNull();
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
    expect(within(editor).getByText("AI 来源：sub2api / gpt-5.4 / run-cand-2")).toBeTruthy();
    expect(within(editor).getByDisplayValue("AI 候选正文")).toBeTruthy();
    expect(within(editor).getByRole("button", { name: "合并到正式章节" })).toBeTruthy();
    expect(within(editor).getByRole("button", { name: "替换正式章节" })).toBeTruthy();
    expect(within(editor).getByRole("button", { name: "另存为草稿" })).toBeTruthy();
    expect(within(editor).getByRole("button", { name: "放弃候选稿" })).toBeTruthy();
  });

  it("opens the outline node as a real markdown editor and saves volume_outline.md", async () => {
    const outlineRefetch = vi.fn(async () => undefined);
    useApiMock.mockImplementation((path: string | null) => {
      if (path === "/books") return { data: booksResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}`) return { data: bookDetailResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/candidates`) return { data: candidatesResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/story-files`) return { data: storyFilesResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/truth-files`) return { data: truthFilesResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/drafts`) return { data: draftsResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/truth-files/volume_outline.md`) return { data: { file: "volume_outline.md", content: "# 卷纲\n\n- 第一卷：灵潮初起" }, loading: false, error: null, refetch: outlineRefetch };
      return { data: null, loading: false, error: null, refetch: vi.fn() };
    });
    putApiMock.mockResolvedValue({ ok: true });

    render(<WorkspacePage />);

    const explorer = screen.getByRole("complementary", { name: "小说资源管理器" });
    fireEvent.click(within(explorer).getByRole("button", { name: /^大纲$/ }));
    const editor = screen.getByRole("main", { name: "正文编辑区" });
    expect(within(editor).getByText("大纲编辑器 · volume_outline.md")).toBeTruthy();
    expect(within(editor).getByDisplayValue(/第一卷：灵潮初起/)).toBeTruthy();

    const outlineTextarea = within(editor).getByLabelText("大纲内容") as HTMLTextAreaElement;
    fireEvent.change(outlineTextarea, { target: { value: "# 新卷纲\n\n- 第二卷：破局" } });
    await waitFor(() => expect(outlineTextarea.value).toBe("# 新卷纲\n\n- 第二卷：破局"));
    fireEvent.click(within(editor).getByRole("button", { name: "保存大纲" }));
    await waitFor(() => expect(putApiMock).toHaveBeenCalledWith(`/books/${TEST_BOOK.id}/truth/volume_outline.md`, { content: "# 新卷纲\n\n- 第二卷：破局" }));
    expect(outlineRefetch).toHaveBeenCalled();

    fireEvent.click(within(explorer).getByRole("button", { name: /^草稿/ }));
    const draftsEditor = screen.getByRole("main", { name: "正文编辑区" });
    expect(within(draftsEditor).getByText("草稿")).toBeTruthy();
    expect(within(draftsEditor).getByText(/该资源节点作为结构容器存在/)).toBeTruthy();
  });

  it("shows a create entry when outline markdown is missing", async () => {
    useApiMock.mockImplementation((path: string | null) => {
      if (path === "/books") return { data: booksResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}`) return { data: bookDetailResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/candidates`) return { data: candidatesResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/story-files`) return { data: storyFilesResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/truth-files`) return { data: truthFilesResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/drafts`) return { data: draftsResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/truth-files/volume_outline.md`) return { data: { file: "volume_outline.md", content: null }, loading: false, error: null, refetch: vi.fn() };
      return { data: null, loading: false, error: null, refetch: vi.fn() };
    });

    render(<WorkspacePage />);
    const explorer = screen.getByRole("complementary", { name: "小说资源管理器" });
    fireEvent.click(within(explorer).getByRole("button", { name: /^大纲$/ }));
    const editor = screen.getByRole("main", { name: "正文编辑区" });
    expect(within(editor).getByText(/暂无大纲/)).toBeTruthy();
    fireEvent.click(within(editor).getByRole("button", { name: "创建默认大纲" }));
    expect(within(editor).getByDisplayValue(/# 大纲/)).toBeTruthy();
  });

  it("loads real story and truth file content through the registered markdown viewer", async () => {
    render(<WorkspacePage />);

    const explorer = screen.getByRole("complementary", { name: "小说资源管理器" });
    fireEvent.click(within(explorer).getByRole("button", { name: /^pending_hooks\.md/ }));
    expect(await screen.findByText(/待处理伏笔/)).toBeTruthy();
    expect(screen.queryByText(/MarkdownViewer|TextViewer/)).toBeNull();

    fireEvent.click(within(explorer).getByRole("button", { name: /^chapter_summaries\.md/ }));
    expect(await screen.findByText(/第一章摘要/)).toBeTruthy();
    expect(screen.queryByText(/MarkdownViewer|TextViewer/)).toBeNull();
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
    expect(screen.queryByText(/DraftEditor/)).toBeNull();
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

  it("maps every Workspace AI action to a concrete route and status message", async () => {
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
    render(<WorkspacePage modelGate={{ blockedResult: null, closeGate: vi.fn(), ensureModelFor }} />);

    const assistant = screen.getByRole("complementary", { name: "AI 与经纬面板" });
    fireEvent.click(within(assistant).getByRole("button", { name: /生成下一章/ }));
    await waitFor(() => expect(fetchJsonMock).toHaveBeenCalledWith(`/books/${TEST_BOOK.id}/write-next`, { method: "POST" }));
    await waitFor(() => expect(candidatesRefetch).toHaveBeenCalled());
    expect(await within(assistant).findByText("AI 输出已进入生成章节候选")).toBeTruthy();

    const routedActions = [
      {
        label: /续写当前段落/,
        gate: "ai-rewrite",
        route: `/books/${TEST_BOOK.id}/inline-write`,
        request: expect.objectContaining({ method: "POST", body: expect.stringContaining('"mode":"continuation"') }),
        message: "续写当前段落已生成提示词预览，请在写作模式面板确认后写入。",
      },
      {
        label: /审校当前章/,
        gate: "ai-review",
        route: `/books/${TEST_BOOK.id}/audit/1`,
        request: { method: "POST" },
        message: "审校当前章已完成。",
      },
      {
        label: /改写选中段落/,
        gate: "ai-rewrite",
        route: `/books/${TEST_BOOK.id}/revise/1`,
        request: expect.objectContaining({ method: "POST", body: expect.stringContaining('"mode":"rewrite"') }),
        message: "改写请求已提交到修订 route。",
      },
      {
        label: /去 AI 味/,
        gate: "deep-ai-taste-scan",
        route: `/books/${TEST_BOOK.id}/detect/1`,
        request: { method: "POST" },
        message: "去 AI 味检测已完成。",
      },
      {
        label: /连续性检查/,
        gate: "ai-review",
        route: `/books/${TEST_BOOK.id}/audit/1`,
        request: { method: "POST" },
        message: "连续性检查已完成。",
      },
    ] as const;

    for (const item of routedActions) {
      fireEvent.click(within(assistant).getByRole("button", { name: item.label }));
      expect(ensureModelFor).toHaveBeenCalledWith(item.gate);
      await waitFor(() => expect(fetchJsonMock).toHaveBeenCalledWith(item.route, item.request));
      expect(await within(assistant).findByText(item.message)).toBeTruthy();
      expect(within(assistant).queryByText(/即将推出|unsupported/)).toBeNull();
    }
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

  it("loads real bible route data for characters, events, settings and chapter summaries", () => {
    useApiMock.mockImplementation((path: string | null) => {
      if (path === "/books") return { data: booksResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}`) return { data: bookDetailResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/candidates`) return { data: candidatesResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/story-files`) return { data: storyFilesResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/truth-files`) return { data: truthFilesResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/drafts`) return { data: draftsResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/bible/characters`) return { data: { characters: [{ id: "char-1", name: "林月", summary: "城门守卫" }] }, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/bible/events`) return { data: { events: [{ id: "event-1", name: "入城冲突", summary: "与守卫交锋" }] }, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/bible/settings`) return { data: { settings: [{ id: "setting-1", name: "灵潮", content: "周期性灵力涨落" }] }, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/bible/chapter-summaries`) return { data: { chapterSummaries: [{ id: "summary-1", title: "第一章摘要", summary: "灵潮初起", chapterNumber: 1 }] }, loading: false, error: null, refetch: vi.fn() };
      return { data: null, loading: false, error: null, refetch: vi.fn() };
    });

    render(<WorkspacePage />);
    const assistant = screen.getByRole("complementary", { name: "AI 与经纬面板" });

    fireEvent.click(within(assistant).getByRole("button", { name: /林月/ }));
    expect(within(assistant).getByText("城门守卫")).toBeTruthy();

    fireEvent.click(within(assistant).getByRole("button", { name: "事件" }));
    fireEvent.click(within(assistant).getByRole("button", { name: /入城冲突/ }));
    expect(within(assistant).getByText("与守卫交锋")).toBeTruthy();

    fireEvent.click(within(assistant).getByRole("button", { name: "设定" }));
    fireEvent.click(within(assistant).getByRole("button", { name: /灵潮/ }));
    expect(within(assistant).getByText("周期性灵力涨落")).toBeTruthy();

    fireEvent.click(within(assistant).getByRole("button", { name: "摘要" }));
    fireEvent.click(within(assistant).getByRole("button", { name: /第一章摘要/ }));
    expect(within(assistant).getByText("灵潮初起")).toBeTruthy();
  });

  it("opens bible categories as real lists and supports creating and editing entries", async () => {
    const refetchCharacters = vi.fn();
    useApiMock.mockImplementation((path: string | null) => {
      if (path === "/books") return { data: booksResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}`) return { data: bookDetailResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/candidates`) return { data: candidatesResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/story-files`) return { data: storyFilesResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/truth-files`) return { data: truthFilesResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/drafts`) return { data: draftsResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/bible/characters`) return { data: { characters: [{ id: "char-1", name: "林月", summary: "城门守卫", firstChapter: 1 }] }, loading: false, error: null, refetch: refetchCharacters };
      return { data: null, loading: false, error: null, refetch: vi.fn() };
    });
    postApiMock.mockResolvedValue({ character: { id: "char-2", name: "韩烛", summary: "地下线人" } });
    putApiMock.mockResolvedValue({ character: { id: "char-1", name: "林月", summary: "守卫队长" } });

    render(<WorkspacePage />);

    const explorer = screen.getByRole("complementary", { name: "小说资源管理器" });
    fireEvent.click(within(explorer).getByRole("button", { name: /人物/ }));

    const editor = screen.getByRole("main", { name: "正文编辑区" });
    expect(within(editor).getByText("经纬分类 · 人物")).toBeTruthy();
    expect(within(editor).getByText("城门守卫")).toBeTruthy();
    expect(within(editor).getByText(/关联章节：1/)).toBeTruthy();

    fireEvent.click(within(editor).getByRole("button", { name: "新建人物" }));
    fireEvent.change(within(editor).getByLabelText("人物名称"), { target: { value: "韩烛" } });
    fireEvent.change(within(editor).getByLabelText("人物内容"), { target: { value: "地下线人" } });
    fireEvent.click(within(editor).getByRole("button", { name: "创建人物" }));
    await waitFor(() => expect(postApiMock).toHaveBeenCalledWith(`/books/${TEST_BOOK.id}/bible/characters`, { name: "韩烛", summary: "地下线人" }));
    expect(refetchCharacters).toHaveBeenCalled();

    fireEvent.click(within(editor).getByRole("button", { name: "编辑林月" }));
    fireEvent.change(within(editor).getByLabelText("人物内容"), { target: { value: "守卫队长" } });
    fireEvent.click(within(editor).getByRole("button", { name: "保存人物" }));
    await waitFor(() => expect(putApiMock).toHaveBeenCalledWith(`/books/${TEST_BOOK.id}/bible/characters/char-1`, { name: "林月", summary: "守卫队长" }));
    expect(refetchCharacters).toHaveBeenCalledTimes(2);

    const assistant = screen.getByRole("complementary", { name: "AI 与经纬面板" });
    expect(within(assistant).getByRole("button", { name: /生成下一章/ })).toBeTruthy();
    expect(within(assistant).getByText(/当前上下文：人物/)).toBeTruthy();
  });

  it("shows pending hook trace records in the foreshadowing bible category", () => {
    useApiMock.mockImplementation((path: string | null) => {
      if (path === "/books") return { data: booksResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}`) return { data: bookDetailResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/candidates`) return { data: candidatesResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/story-files`) return { data: storyFilesResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/truth-files`) return { data: truthFilesResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/drafts`) return { data: draftsResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/bible/events`) return { data: { events: [] }, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/story-files/pending_hooks.md`) {
        return { data: { file: "pending_hooks.md", content: "## hook-new\n- status: open\n- chapter: 1\n- text: 门外传来第三个人的脚步声。\n- related: old-hook" }, loading: false, error: null, refetch: vi.fn() };
      }
      return { data: null, loading: false, error: null, refetch: vi.fn() };
    });

    render(<WorkspacePage />);
    const explorer = screen.getByRole("complementary", { name: "小说资源管理器" });
    fireEvent.click(within(explorer).getByRole("button", { name: /伏笔/ }));

    const editor = screen.getByRole("main", { name: "正文编辑区" });
    expect(within(editor).getByText("hook-new")).toBeTruthy();
    expect(within(editor).getByText("门外传来第三个人的脚步声。")).toBeTruthy();
    expect(within(editor).getByText(/关联章节：1/)).toBeTruthy();
    expect(within(editor).getByText(/关联伏笔：old-hook/)).toBeTruthy();
    expect(within(editor).getByText("伏笔状态：伏笔")).toBeTruthy();
    expect(within(editor).queryByText("伏笔状态：foreshadow")).toBeNull();
  });

  it("applies generated dialogue to a draft through the writing modes confirmation flow", async () => {
    const draftsRefetch = vi.fn(async () => undefined);
    useApiMock.mockImplementation((path: string | null) => {
      if (path === "/books") return { data: booksResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}`) return { data: bookDetailResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/candidates`) return { data: candidatesResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/story-files`) return { data: storyFilesResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/truth-files`) return { data: truthFilesResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/drafts`) return { data: draftsResponse, loading: false, error: null, refetch: draftsRefetch };
      return { data: null, loading: false, error: null, refetch: vi.fn() };
    });
    postApiMock.mockImplementation(async (path: string) => {
      if (path === `/books/${TEST_BOOK.id}/dialogue/generate`) return { lines: [{ character: "林月", line: "你终于来了。" }] };
      if (path === `/books/${TEST_BOOK.id}/writing-modes/apply`) return { target: "draft", resourceId: "draft-dialogue", status: "draft" };
      return {};
    });

    render(<WorkspacePage />);
    const assistant = screen.getByRole("complementary", { name: "AI 与经纬面板" });
    fireEvent.click(within(assistant).getByText("写作模式"));
    fireEvent.click(within(assistant).getByRole("button", { name: "对话生成" }));
    fireEvent.change(within(assistant).getByLabelText("角色"), { target: { value: "林月" } });
    fireEvent.click(within(assistant).getByRole("button", { name: "生成对话" }));

    expect(await within(assistant).findByText(/你终于来了/)).toBeTruthy();
    fireEvent.click(within(assistant).getByRole("button", { name: "插入到正文" }));
    fireEvent.click(within(assistant).getByRole("button", { name: "保存为草稿" }));
    fireEvent.click(within(assistant).getByRole("button", { name: "确认应用写作结果" }));

    await waitFor(() => expect(postApiMock).toHaveBeenCalledWith(`/books/${TEST_BOOK.id}/writing-modes/apply`, expect.objectContaining({ target: "draft", sourceMode: "dialogue-generator" })));
    await waitFor(() => expect(draftsRefetch).toHaveBeenCalled());
    expect(await within(assistant).findByText("写作结果已保存到草稿 draft-dialogue")).toBeTruthy();
  });

  it("executes prompt-preview writing modes before allowing generated content to be applied", async () => {
    postApiMock.mockImplementation(async (path: string) => {
      if (path === `/books/${TEST_BOOK.id}/dialogue/generate`) return { mode: "prompt-preview", promptPreview: "请生成一段对话" };
      if (path === `/books/${TEST_BOOK.id}/writing-modes/execute-prompt`) return { content: "林月：\"你终于来了。\"" };
      return {};
    });

    render(<WorkspacePage />);
    const assistant = screen.getByRole("complementary", { name: "AI 与经纬面板" });
    fireEvent.click(within(assistant).getByText("写作模式"));
    fireEvent.click(within(assistant).getByRole("button", { name: "对话生成" }));
    fireEvent.change(within(assistant).getByLabelText("角色"), { target: { value: "林月" } });
    fireEvent.click(within(assistant).getByRole("button", { name: "生成对话" }));

    expect(await within(assistant).findByText("提示词预览")).toBeTruthy();
    expect(within(assistant).queryByText("Prompt 预览")).toBeNull();
    expect(within(assistant).queryByRole("button", { name: "执行生成（未接入）" })).toBeNull();
    fireEvent.click(within(assistant).getByRole("button", { name: "执行生成" }));
    await waitFor(() => expect(postApiMock).toHaveBeenCalledWith(`/books/${TEST_BOOK.id}/writing-modes/execute-prompt`, expect.objectContaining({ prompt: "请生成一段对话", sourceMode: "dialogue-generator" })));
    expect(await within(assistant).findByText(/你终于来了/)).toBeTruthy();
    fireEvent.click(within(assistant).getByRole("button", { name: "插入到正文" }));
    expect(within(assistant).getByRole("button", { name: "确认应用写作结果" })).toBeTruthy();
  });

  it("shows a writing mode apply error without creating fake resources", async () => {
    const draftsRefetch = vi.fn(async () => undefined);
    useApiMock.mockImplementation((path: string | null) => {
      if (path === "/books") return { data: booksResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}`) return { data: bookDetailResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/candidates`) return { data: candidatesResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/story-files`) return { data: storyFilesResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/truth-files`) return { data: truthFilesResponse, loading: false, error: null, refetch: vi.fn() };
      if (path === `/books/${TEST_BOOK.id}/drafts`) return { data: draftsResponse, loading: false, error: null, refetch: draftsRefetch };
      return { data: null, loading: false, error: null, refetch: vi.fn() };
    });
    postApiMock.mockImplementation(async (path: string) => {
      if (path === `/books/${TEST_BOOK.id}/dialogue/generate`) return { lines: [{ character: "林月", line: "你终于来了。" }] };
      if (path === `/books/${TEST_BOOK.id}/writing-modes/apply`) throw new Error("磁盘只读");
      return {};
    });

    render(<WorkspacePage />);
    const assistant = screen.getByRole("complementary", { name: "AI 与经纬面板" });
    fireEvent.click(within(assistant).getByText("写作模式"));
    fireEvent.click(within(assistant).getByRole("button", { name: "对话生成" }));
    fireEvent.change(within(assistant).getByLabelText("角色"), { target: { value: "林月" } });
    fireEvent.click(within(assistant).getByRole("button", { name: "生成对话" }));
    fireEvent.click(await within(assistant).findByRole("button", { name: "插入到正文" }));
    fireEvent.click(within(assistant).getByRole("button", { name: "保存为草稿" }));
    fireEvent.click(within(assistant).getByRole("button", { name: "确认应用写作结果" }));

    expect(await within(assistant).findByText("写作模式应用失败：磁盘只读")).toBeTruthy();
    expect(draftsRefetch).not.toHaveBeenCalled();
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
    expect(screen.queryByText("预设管理")).toBeNull();
  });

  it("uses unified primary/outline button semantics for the top bar and selected resource node", () => {
    render(<WorkspacePage />);

    const newChapterButton = screen.getByRole("button", { name: "新建章节" });
    const exportButton = screen.getByRole("button", { name: "导出" });
    const publishButton = screen.getByRole("button", { name: "发布就绪" });

    expect(newChapterButton.hasAttribute("disabled")).toBe(false);
    expect(newChapterButton.getAttribute("title")).toBeNull();
    expect(newChapterButton.className).toContain("bg-primary");

    expect(exportButton.hasAttribute("disabled")).toBe(false);
    expect(exportButton.className).toContain("border-border");
    expect(exportButton.className).toContain("hover:bg-muted");

    expect(screen.queryByRole("button", { name: "预设管理" })).toBeNull();

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

  it("runs publish readiness from real API data and shows continuity fallback as a friendly label", async () => {
    fetchJsonMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === `/books/${TEST_BOOK.id}/compliance/publish-readiness` && init?.method === "POST") {
        return {
          report: {
            status: "has-warnings",
            totalBlockCount: 0,
            totalWarnCount: 1,
            totalSuggestCount: 2,
            sensitiveScan: { totalBlockCount: 0, totalWarnCount: 0, totalSuggestCount: 0 },
            aiRatio: { overallAiRatio: 0.42 },
            formatCheck: { issues: [{ type: "missing-synopsis" }] },
            continuity: { status: "unknown", reason: "连续性审计数据缺失" },
          },
        };
      }
      if (path === `/books/${TEST_BOOK.id}/chapters/1`) return { content: "测试正文" };
      if (path === `/books/${TEST_BOOK.id}/chapters/2`) return { content: "第二章正文" };
      return {};
    });

    render(<WorkspacePage />);
    fireEvent.click(screen.getByRole("button", { name: "发布就绪" }));
    fireEvent.click(screen.getByRole("button", { name: "运行检查" }));

    await waitFor(() => expect(fetchJsonMock).toHaveBeenCalledWith(
      `/books/${TEST_BOOK.id}/compliance/publish-readiness`,
      expect.objectContaining({ method: "POST" }),
    ));
    expect(await screen.findByText("存在警告")).toBeTruthy();
    expect(screen.getByText("42%")).toBeTruthy();
    expect(screen.getByText("未完成审计")).toBeTruthy();
    expect(screen.getByText(/连续性审计数据缺失/)).toBeTruthy();
    expect(screen.queryByText("unknown")).toBeNull();
  });

  it("exports the selected book and shows returned filename and content type", async () => {
    fetchJsonMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === `/books/${TEST_BOOK.id}/export` && init?.method === "POST") {
        return {
          fileName: "book-1.md",
          contentType: "text/markdown; charset=utf-8",
          content: "# 第一章\n\n正文",
          chapterCount: 2,
        };
      }
      if (path === `/books/${TEST_BOOK.id}/chapters/1`) return { content: "测试正文" };
      if (path === `/books/${TEST_BOOK.id}/chapters/2`) return { content: "第二章正文" };
      return {};
    });

    render(<WorkspacePage />);
    fireEvent.click(screen.getByRole("button", { name: "导出" }));

    expect(screen.getByText("导出作品")).toBeTruthy();
    expect(screen.getByLabelText("导出格式")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "开始导出" }));

    await waitFor(() => expect(fetchJsonMock).toHaveBeenCalledWith(
      `/books/${TEST_BOOK.id}/export`,
      expect.objectContaining({ method: "POST" }),
    ));
    expect(await screen.findByText(/book-1\.md/)).toBeTruthy();
    expect(screen.getByText(/text\/markdown/)).toBeTruthy();
    expect(screen.getByText(/已导出 2 章/)).toBeTruthy();
  });

  it("shows a real export error", async () => {
    fetchJsonMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === `/books/${TEST_BOOK.id}/export` && init?.method === "POST") {
        throw new Error("chapter read failed");
      }
      if (path === `/books/${TEST_BOOK.id}/chapters/1`) return { content: "测试正文" };
      if (path === `/books/${TEST_BOOK.id}/chapters/2`) return { content: "第二章正文" };
      return {};
    });

    render(<WorkspacePage />);
    fireEvent.click(screen.getByRole("button", { name: "导出" }));
    fireEvent.click(screen.getByRole("button", { name: "开始导出" }));

    expect(await screen.findByText(/导出失败：chapter read failed/)).toBeTruthy();
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
    expect(within(assistant).getByText(/真实生成结果必须先选择候选稿或草稿/)).toBeTruthy();

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
