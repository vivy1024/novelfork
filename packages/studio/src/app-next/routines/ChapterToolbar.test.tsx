// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ChapterToolbar } from "@vivy1024/novelfork-novel-plugin/pages/writing-workbench";

describe("ChapterToolbar (Studio DOM Integration)", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ issues: [] }),
      })
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("支持展开收起与切换 Tab", async () => {
    render(
      <ChapterToolbar
        bookId="book-1"
        chapterNumber={1}
        content="主角陈平安拔剑向前。"
      />
    );

    const toggleBtn = screen.getByRole("button", { name: /章节体检/ });
    fireEvent.click(toggleBtn);

    expect(screen.getByText("人味润色")).toBeTruthy();
    expect(screen.getByText("叙事审计")).toBeTruthy();
    expect(screen.getByText("对抗审查")).toBeTruthy();
    expect(screen.getByText("本章审稿")).toBeTruthy();
    expect(screen.getByText("发布检查")).toBeTruthy();
  });

  it("切换章节或作品时自动清理前一章分析与错误状态，避免串章串书", async () => {
    const { rerender } = render(
      <ChapterToolbar
        bookId="book-1"
        chapterNumber={1}
        content="第一章内容"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /章节体检/ }));
    fireEvent.click(screen.getByRole("button", { name: "叙事审计" }));
    fireEvent.click(screen.getByRole("button", { name: "交叙述者审计" }));

    expect(await screen.findByText("当前视图没有可用的叙述者，无法执行叙事审计。")).toBeTruthy();

    rerender(
      <ChapterToolbar
        bookId="book-1"
        chapterNumber={2}
        content="第二章内容"
      />
    );

    expect(screen.queryByText("当前视图没有可用的叙述者，无法执行叙事审计。")).toBeNull();
  });

  it("对抗审查唤起时正确调用 onSendToNarrator，并处理异步错误反馈", async () => {
    const onSend = vi.fn().mockRejectedValue(new Error("网络中断或叙述者不可用"));

    render(
      <ChapterToolbar
        bookId="book-1"
        chapterNumber={3}
        content="第三章正文内容..."
        onSendToNarrator={onSend}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /章节体检/ }));
    fireEvent.click(screen.getByRole("button", { name: "对抗审查" }));

    const runBtn = screen.getByRole("button", { name: "唤起工作流审查" });
    fireEvent.click(runBtn);

    expect(await screen.findByText("网络中断或叙述者不可用")).toBeTruthy();
    expect(onSend).toHaveBeenCalledWith(expect.stringContaining("第三章正文内容"));
  });

  it("审稿意见生成修订提案时若 onSendToNarrator 抛错能正确捕获并提示", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          issues: [
            {
              issueId: "issue-1",
              category: "AI套词",
              severity: "warning",
              description: "出现了不自然的转折句式",
              suggestion: "删除不必要转折",
              quote: "不自然的转折",
            },
          ],
        }),
      })
    );

    const onSend = vi.fn().mockRejectedValue(new Error("叙述者忙碌中"));

    render(
      <ChapterToolbar
        bookId="book-1"
        chapterNumber={1}
        content="正文中有不自然的转折句式出现。"
        onSendToNarrator={onSend}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /章节体检/ }));
    fireEvent.click(screen.getByRole("button", { name: /本章审稿/ }));

    await waitFor(() => {
      expect(screen.getByText("出现了不自然的转折句式")).toBeTruthy();
    });

    const autofixBtn = screen.getByTestId("audit-issue-autofix");
    fireEvent.click(autofixBtn);

    await waitFor(() => {
      expect(screen.getByText("叙述者忙碌中")).toBeTruthy();
    });
  });
});
