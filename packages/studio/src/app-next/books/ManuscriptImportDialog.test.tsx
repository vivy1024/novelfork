import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BookManagementPage } from "./BookManagementPage";
import type { ManuscriptImportClient, ManuscriptImportView } from "../runtime/manuscript-import-client";

afterEach(cleanup);

const chapter = (index: number, title: string) => ({
  index,
  title,
  chars: 1200,
  lineCount: 12,
  head: `${title}的开头`,
  tail: `…${title}的结尾`,
  anomalies: index === 2 ? [{ code: "too-short", message: "只有 1200 字，明显短于全书常见章长" }] : [],
});

function previewView(revision = 1): ManuscriptImportView {
  return {
    job: {
      jobId: "job-12345678",
      bookId: "book-1",
      sourceName: "旧稿.txt",
      phase: "preview",
      split: { mode: "rule" },
      planRevision: revision,
      source: { kind: "text", sha256: "a".repeat(64), bytes: 9000, charCount: 3600, files: [{ name: "旧稿.txt", encoding: "utf-8" }] },
      chapters: [],
      settlement: { state: "idle" },
    },
    preview: { revision, chapterCount: 3, totalChars: 3600, chapters: [chapter(1, "雨夜"), chapter(2, "来客"), chapter(3, "旧信")], warnings: [] },
    progress: { total: 0, written: 0, settled: 0, failed: 0, pending: 0 },
    running: false,
  };
}

function writtenView(): ManuscriptImportView {
  const base = previewView(2);
  return {
    job: {
      ...base.job,
      phase: "written",
      chapters: [1, 2, 3].map((number) => ({ index: number, chapterNumber: number, title: `第${number}章`, written: true, settle: { status: "pending", attempts: 0 } })),
      settlement: {
        state: "blocked",
        explanation: { whatHappened: "逐章事实没有开始：还没有设置默认模型。", whyItMatters: "没有用规则凑数", suggestedAction: "在设置里配置默认模型。" },
      },
    },
    progress: { total: 3, written: 3, settled: 0, failed: 0, pending: 3 },
    running: false,
  };
}

function client(overrides: Partial<ManuscriptImportClient> = {}): ManuscriptImportClient {
  return {
    start: vi.fn(async () => previewView()),
    read: vi.fn(async () => previewView()),
    readChapterLines: vi.fn(async () => ({ lines: ["第一行", "短标题", "第三行"], revision: 1 })),
    resplit: vi.fn(async () => previewView(2)),
    edit: vi.fn(async () => previewView(2)),
    confirm: vi.fn(async () => writtenView()),
    settle: vi.fn(async () => writtenView()),
    synthesize: vi.fn(async () => writtenView()),
    publish: vi.fn(async () => ({ ...writtenView(), job: { ...writtenView().job, phase: "published" as const } })),
    ...overrides,
  };
}

function renderPage(api: ManuscriptImportClient, books: Parameters<typeof BookManagementPage>[0]["books"] = []) {
  const createBook = vi.fn(async () => "book-1");
  render(
    <BookManagementPage
      books={books}
      loading={false}
      error={null}
      onNavigateToBook={vi.fn()}
      onCreateBook={vi.fn()}
      onClaimLegacyBook={vi.fn()}
      onRepairBook={vi.fn()}
      onRebindBookWorkspace={vi.fn()}
      onDeleteBook={vi.fn()}
      manuscriptImportClient={api}
      onCreateManuscriptBook={createBook}
      onBooksChanged={vi.fn()}
    />,
  );
  return { createBook };
}

describe("书架「导入旧稿」", () => {
  it("选文件 → 切分预览（含异常提示）→ 合并 → 确认写章；无模型时展示停在逐章事实的原因", async () => {
    const api = client();
    const { createBook } = renderPage(api);
    fireEvent.click(screen.getByRole("button", { name: "导入旧稿" }));
    const file = new File(["第一章 雨夜\n正文"], "长夜.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText("选择旧稿文本文件"), { target: { files: [file] } });
    expect((screen.getByLabelText("书名") as HTMLInputElement).value).toBe("长夜");
    fireEvent.click(screen.getByRole("button", { name: "切分预览" }));

    await screen.findByTestId("manuscript-preview");
    expect(createBook).toHaveBeenCalledWith("长夜");
    expect(api.start).toHaveBeenCalledWith("book-1", expect.objectContaining({ sourceName: "长夜.txt", files: [file] }));
    expect(screen.getAllByTestId("manuscript-preview-chapter")).toHaveLength(3);
    expect(screen.getByText(/明显短于全书常见章长/u)).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: "与下一章合并" })[0]!);
    await waitFor(() => expect(api.edit).toHaveBeenCalledWith("book-1", "job-12345678", 1, { op: "merge", index: 1 }));

    fireEvent.click(await screen.findByRole("button", { name: "确认并写入 3 章" }));
    await screen.findByTestId("manuscript-settlement");
    expect(api.confirm).toHaveBeenCalledWith("book-1", "job-12345678", 2);
    expect(screen.getByText("逐章事实停在这一步")).toBeTruthy();
    expect(screen.getByText(/还没有设置默认模型/u)).toBeTruthy();
    // 没有模型也能先完成导入开始写。
    expect(screen.getByRole("button", { name: "完成导入" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "继续逐章事实" })).toBeTruthy();
  });

  it("导入中的书显示徽标，并能从书架继续导入", async () => {
    const api = client({ read: vi.fn(async () => writtenView()) });
    renderPage(api, [{ id: "book-1", title: "长夜", manuscriptImportJobId: "job-12345678" }]);
    expect(screen.getByText("导入中")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "继续导入" }));
    await screen.findByTestId("manuscript-settlement");
    expect(api.read).toHaveBeenCalledWith("book-1", "job-12345678");
  });

  it("导入报告显示待确认人物草稿数与三段式说明，完成导入后可跳到工作台的待确认", async () => {
    const reported = (phase: "written" | "published"): ManuscriptImportView => {
      const base = writtenView();
      return {
        ...base,
        job: {
          ...base.job,
          phase,
          settlement: { state: "done" },
          report: {
            chapterCount: 3, settledChapters: 3, unsettledChapters: [], failedChapters: [],
            eventCount: 14, pendingEventCount: 0, highRiskPendingCount: 0, pendingReviewTotal: 2,
            entityCount: 0, relationCount: 0, foreshadow: { total: 0, byPhase: {} }, storylines: [],
            characterDrafts: {
              pending: 2,
              stagedThisRun: 2,
              threshold: 3,
              items: [{ entryId: "e-1", title: "林照", firstChapter: 1, occurrences: 7 }, { entryId: "e-2", title: "沈默", firstChapter: 2, occurrences: 4 }],
              explanation: {
                whatHappened: "从正文里统计到 2 个反复出现的人物，已起草为待你确认的人物条目。",
                whyItMatters: "实体图谱、关系图与场景校验只认已确认的人物条目。",
                suggestedAction: "到「待确认 › 人物」逐个确认或删掉。",
              },
            },
            warnings: [],
          },
        },
        progress: { total: 3, written: 3, settled: 3, failed: 0, pending: 0 },
      };
    };
    const api = client({ read: vi.fn(async () => reported("written")), publish: vi.fn(async () => reported("published")) });
    const onNavigateToBook = vi.fn();
    render(
      <BookManagementPage
        books={[{ id: "book-1", title: "长夜", manuscriptImportJobId: "job-12345678" }]}
        loading={false}
        error={null}
        onNavigateToBook={onNavigateToBook}
        onCreateBook={vi.fn()}
        onClaimLegacyBook={vi.fn()}
        onRepairBook={vi.fn()}
        onRebindBookWorkspace={vi.fn()}
        onDeleteBook={vi.fn()}
        manuscriptImportClient={api}
        onCreateManuscriptBook={vi.fn(async () => "book-1")}
        onBooksChanged={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "继续导入" }));
    const drafts = await screen.findByTestId("manuscript-character-drafts");
    expect(drafts.textContent).toContain("待你确认的人物草稿 2 个，确认后才会进入实体图谱与场景校验");
    expect(drafts.textContent).toContain("从正文里统计到 2 个反复出现的人物");
    expect(drafts.textContent).toContain("实体图谱、关系图与场景校验只认已确认的人物条目");
    expect(drafts.textContent).toContain("林照（7 次）、沈默（4 次）");
    // 发布前只提示去处，发布后给跳转入口
    expect(screen.queryByRole("button", { name: "去待确认处理" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "完成导入" }));
    fireEvent.click(await screen.findByRole("button", { name: "去待确认处理" }));
    expect(onNavigateToBook).toHaveBeenCalledWith("book-1");
  });

  it("先发的轮询晚到：旧的「运行中」响应不把已停下的新状态盖回去", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const runningView: ManuscriptImportView = {
        ...writtenView(),
        job: { ...writtenView().job, settlement: { state: "running" } },
        running: true,
      };
      const stoppedView: ManuscriptImportView = { ...writtenView(), job: { ...writtenView().job, settlement: { state: "paused" } } };
      // 1：恢复读取（运行中）；2：第一次轮询，挂起；3：第二次轮询，立即回「已停」。
      let releaseStale: (view: ManuscriptImportView) => void = () => undefined;
      const read = vi.fn()
        .mockResolvedValueOnce(runningView)
        .mockImplementationOnce(() => new Promise<ManuscriptImportView>((resolve) => { releaseStale = resolve; }))
        .mockResolvedValue(stoppedView);
      renderPage(client({ read }), [{ id: "book-1", title: "长夜", manuscriptImportJobId: "job-12345678" }]);
      fireEvent.click(screen.getByRole("button", { name: "继续导入" }));
      await screen.findByText(/逐章事实进行中/u);

      await vi.advanceTimersByTimeAsync(2_100);
      await vi.advanceTimersByTimeAsync(2_100);
      await waitFor(() => expect(read).toHaveBeenCalledTimes(3));
      await waitFor(() => expect(screen.queryByText(/逐章事实进行中/u)).toBeNull());

      // 第一次轮询这时才回来，带的是旧的「运行中」
      releaseStale(runningView);
      await vi.advanceTimersByTimeAsync(50);
      expect(screen.queryByText(/逐章事实进行中/u)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("恢复任务加载中关闭弹窗：在途读取回来后不再写状态，也不报错", async () => {
    let release: (view: ManuscriptImportView) => void = () => undefined;
    const read = vi.fn(() => new Promise<ManuscriptImportView>((resolve) => { release = resolve; }));
    const api = client({ read });
    renderPage(api, [{ id: "book-1", title: "长夜", manuscriptImportJobId: "job-12345678" }]);
    fireEvent.click(screen.getByRole("button", { name: "继续导入" }));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    fireEvent.keyDown(screen.getByTestId("manuscript-import-dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("manuscript-import-dialog")).toBeNull());
    release(writtenView());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByTestId("manuscript-settlement")).toBeNull();
  });

  it("没有注入导入客户端时不显示入口", () => {
    render(
      <BookManagementPage
        books={[]}
        loading={false}
        error={null}
        onNavigateToBook={vi.fn()}
        onCreateBook={vi.fn()}
        onClaimLegacyBook={vi.fn()}
        onRepairBook={vi.fn()}
        onRebindBookWorkspace={vi.fn()}
        onDeleteBook={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "导入旧稿" })).toBeNull();
  });
});
