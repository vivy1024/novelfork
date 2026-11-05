import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const apiData = new Map<string, unknown>();

vi.mock("@/hooks/use-api", () => ({
  fetchJson: async (path: string) => apiData.get(path) ?? {},
}));

import { chapterRelativePath, writeChapterIndex } from "../../engine/writing-resource/chapter-layout.js";
import { saveChapterAiDraft, summarizeStyleVault } from "../../engine/writing-layers/style-vault.js";
import { AUTHOR_SHARE_DEBOUNCE_MS, AuthorShareBadge, aiDraftPath, formatAuthorRatio } from "./AuthorShareBadge";

const AI_TEXT = "雨下了一整夜。\n\n她站在站台上，等末班车。\n\n“末班车还来吗？”她问。\n\n没人回答她。";
const AUTHOR_TEXT = "雨下了一整夜。\n\n她缩在站台的檐下，数着地上的积水。\n\n“车还来吗？”她问。\n\n没人回答她。\n\n远处有灯亮了一下。";

const tempDirs: string[] = [];

afterEach(async () => {
  cleanup();
  apiData.clear();
  vi.useRealTimers();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** 按文风金库的真实落盘格式建一本书：章节索引 + 正文 + AI 原稿。 */
async function bookWithDraft(current: string): Promise<string> {
  const bookRoot = join(tmpdir(), `novelfork-author-share-${crypto.randomUUID()}`);
  tempDirs.push(bookRoot);
  await mkdir(join(bookRoot, "chapters", "卷01"), { recursive: true });
  const fileName = chapterRelativePath("卷01", 1, "雨夜");
  await writeFile(join(bookRoot, "chapters", fileName), current, "utf8");
  await writeChapterIndex(bookRoot, [{ number: 1, title: "雨夜", fileName, wordCount: current.length, updatedAt: "2026-10-20T00:00:00.000Z" } as never]);
  await saveChapterAiDraft(bookRoot, { chapterNumber: 1, text: AI_TEXT, source: "pipeline.write" });
  return bookRoot;
}

describe("AuthorShareBadge 与文风金库面板一致", () => {
  it("同一份正文：徽标的百分比与服务端文风金库汇总（面板数字）完全相同", async () => {
    const bookRoot = await bookWithDraft(AUTHOR_TEXT);
    const summary = await summarizeStyleVault(bookRoot);
    const panelShare = summary.chapters.find((chapter) => chapter.chapterNumber === 1)!.share!;
    expect(panelShare.authorRatio).toBeGreaterThan(0);
    expect(panelShare.authorRatio).toBeLessThan(1);

    apiData.set(aiDraftPath("book-1", 1), { hasAiDraft: true, text: AI_TEXT });
    render(<AuthorShareBadge bookId="book-1" chapterNumber={1} content={AUTHOR_TEXT} />);
    expect((await screen.findByTestId("author-share-badge")).textContent).toBe(`作者改动 ${formatAuthorRatio(panelShare.authorRatio)}`);
  });

  it("编辑时随输入（防抖后）更新", async () => {
    apiData.set(aiDraftPath("book-1", 1), { hasAiDraft: true, text: AI_TEXT });
    const { rerender } = render(<AuthorShareBadge bookId="book-1" chapterNumber={1} content={AI_TEXT} />);
    expect((await screen.findByTestId("author-share-badge")).textContent).toBe("作者改动 0%");
    vi.useFakeTimers();

    rerender(<AuthorShareBadge bookId="book-1" chapterNumber={1} content={AUTHOR_TEXT} />);
    // 防抖期内不重算
    expect(screen.getByTestId("author-share-badge").textContent).toBe("作者改动 0%");
    act(() => { vi.advanceTimersByTime(AUTHOR_SHARE_DEBOUNCE_MS); });
    expect(screen.getByTestId("author-share-badge").textContent).not.toBe("作者改动 0%");
  });

  it("本章版本变了（叙述者重写换了新原稿）会重读原稿，不拿旧原稿算占比", async () => {
    apiData.set(aiDraftPath("book-1", 1), { hasAiDraft: true, text: AI_TEXT });
    const { rerender } = render(<AuthorShareBadge bookId="book-1" chapterNumber={1} content={AUTHOR_TEXT} revision="v1" />);
    await screen.findByTestId("author-share-badge");
    expect(screen.getByTestId("author-share-badge").textContent).not.toBe("作者改动 0%");

    // 叙述者重写本章：新原稿就是现在的正文，占比应回到 0%
    apiData.set(aiDraftPath("book-1", 1), { hasAiDraft: true, text: AUTHOR_TEXT });
    rerender(<AuthorShareBadge bookId="book-1" chapterNumber={1} content={AUTHOR_TEXT} revision="v2" />);
    await screen.findByText("作者改动 0%");
  });

  it("没有 AI 原稿显示「无 AI 原稿」；点击跳到文风金库该章", async () => {
    apiData.set(aiDraftPath("book-1", 3), { hasAiDraft: false });
    const onOpen = vi.fn();
    render(<AuthorShareBadge bookId="book-1" chapterNumber={3} content="作者自己写的。" onOpenStyleVault={onOpen} />);
    const badge = await screen.findByTestId("author-share-badge");
    expect(badge.textContent).toBe("无 AI 原稿");
    fireEvent.click(badge);
    expect(onOpen).toHaveBeenCalledWith(3);
  });
});
