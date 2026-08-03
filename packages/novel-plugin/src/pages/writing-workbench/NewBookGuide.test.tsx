import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 建书十一问完成后的摘要屏。
 *
 * 作者刚回答完十一问，应当当场看到「系统按你的回答挑了哪些技能、为什么」，
 * 而不是被直接丢进工作台、事后自己去设置页翻 372 个技能。
 */

const postCalls: Array<{ path: string; body: unknown }> = [];
let postResult: unknown = {};

vi.mock("@/hooks/use-api", () => ({
  postApi: (path: string, body: unknown) => {
    postCalls.push({ path, body });
    return Promise.resolve(postResult);
  },
}));

beforeEach(async () => {
  postCalls.length = 0;
  postResult = {};
  const { cleanup } = await import("@testing-library/react");
  cleanup();
});

describe("NewBookGuide 完成后的推荐摘要", () => {
  it("有推荐时展示摘要屏，并在点确认后把 outcome 上抛", async () => {
    const { fireEvent, render, screen, waitFor } = await import("@testing-library/react");
    const { NewBookGuide } = await import("./NewBookGuide");
    postResult = {
      recommendedWritingSkills: [
        { name: "异能志怪-强化章节开头", reason: "新书前三章决定留存，先把开篇钩子立住" },
        { name: "异能志怪-输出番茄版", reason: "平台选了「番茄」" },
      ],
      matchedGenreCluster: "异能志怪",
    };
    const onComplete = vi.fn();

    render(<NewBookGuide bookId="book-1" bookTitle="灵潮纪元" onComplete={onComplete} />);
    fireEvent.click(screen.getByRole("button", { name: /全部跳过/ }));

    const summary = await waitFor(() => screen.getByTestId("new-book-guide-summary"));
    expect(summary.textContent).toContain("已按你的回答挑好 2 个写作技能");
    expect(summary.textContent).toContain("异能志怪-强化章节开头");
    expect(summary.textContent).toContain("新书前三章决定留存");
    // 推荐不等于已启用，摘要必须讲清楚
    expect(summary.textContent).toContain("还没有启用");
    // 摘要屏出现时还不应结束引导
    expect(onComplete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("new-book-guide-continue"));
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(onComplete.mock.calls[0]?.[0]).toMatchObject({ matchedGenreCluster: "异能志怪" });
  });

  it("没有推荐时不多一屏，直接完成", async () => {
    const { fireEvent, render, screen, waitFor } = await import("@testing-library/react");
    const { NewBookGuide } = await import("./NewBookGuide");
    postResult = { recommendedWritingSkills: [] };
    const onComplete = vi.fn();

    render(<NewBookGuide bookId="book-2" bookTitle="无名作品" onComplete={onComplete} />);
    fireEvent.click(screen.getByRole("button", { name: /全部跳过/ }));

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("new-book-guide-summary")).toBeNull();
  });

  it("提交到 guided-setup 且带全部题目答案", async () => {
    const { fireEvent, render, screen, waitFor } = await import("@testing-library/react");
    const { NewBookGuide } = await import("./NewBookGuide");
    render(<NewBookGuide bookId="book-3" bookTitle="测试书" onComplete={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /全部跳过/ }));

    await waitFor(() => expect(postCalls.length).toBe(1));
    expect(postCalls[0]?.path).toBe("/books/book-3/guided-setup");
    const answers = (postCalls[0]?.body as { answers: Record<string, unknown> }).answers;
    // 十一问的字段映射不能因为新增摘要屏而丢
    for (const field of ["genre", "premise", "protagonist", "goldenFinger", "tone", "platform", "chapterWordCount", "aiTasteLevel"]) {
      expect(Object.keys(answers)).toContain(field);
    }
  });
});
