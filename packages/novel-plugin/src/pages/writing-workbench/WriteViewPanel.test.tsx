import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 一键修的落点验证。
 *
 * 用户反馈「本章指示」和「文风预设」两个按钮行为不对：点了没有可用的编辑入口。
 * 根因是路由落到了打不开对应编辑器的侧栏视图。这些用例断言按钮真的把宿主
 * 带到能改数据的界面，并且宿主没接入口时会给出可见说明而不是静默无反应。
 */

vi.mock("./narrative-pending-events", () => ({
  fetchPendingEvents: () => Promise.resolve([]),
  groupProposalsByChapter: () => ({ current: [], earlier: [], highRiskCount: 0 }),
  mutatePendingEvent: () => Promise.resolve({}),
  riskLabel: (risk: string) => risk,
}));

vi.mock("./CreativeCompassPanel", () => ({
  CreativeCompassPanel: () => <div data-testid="creative-compass">创作罗盘</div>,
}));

/** 章节循环读结算新鲜度与文风金库：按路径后缀返回预置数据，默认没有数据。 */
const apiMocks = vi.hoisted(() => ({
  data: new Map<string, unknown>(),
  fetchJson: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock("@/hooks/use-api", () => ({
  useApi: (path: string | null) => {
    const hit = path ? [...apiMocks.data.entries()].find(([suffix]) => path.endsWith(suffix)) : undefined;
    return { data: hit ? hit[1] : null, loading: false, error: null, refetch: async () => undefined };
  },
  fetchJson: (...args: unknown[]) => apiMocks.fetchJson(...args),
  invalidateApiPaths: (...args: unknown[]) => apiMocks.invalidate(...args),
}));

vi.mock("./ide/StyleVaultPanel", () => ({
  vaultPath: (bookId: string) => `/api/books/${encodeURIComponent(bookId)}/style/vault`,
  ChapterRevisions: ({ chapterNumber }: { chapterNumber: number }) => <div data-testid="chapter-revisions">第 {chapterNumber} 章改稿段</div>,
}));

const BOOK_ID = "book-write-view";

/** 一个带指定 blocker/warning 的 preflight 返回体。 */
function preflightWith(items: { blockers?: unknown[]; warningItems?: unknown[] }) {
  return {
    ok: (items.blockers?.length ?? 0) === 0,
    chapterNumber: 12,
    resolvedDirective: null,
    needsUserConfirm: false,
    recentChapters: [{ number: 11, summary: "上一章" }],
    blockers: items.blockers ?? [],
    warningItems: items.warningItems ?? [],
  };
}

const STYLE_DISABLED = { code: "style-disabled", message: "未启用任何写作技能。", kind: "advisory" };
const BOOK_NOT_FOUND = { code: "book-not-found", message: "无法读取书籍驾驶舱：book.json 损坏", kind: "persistent" };
const MISSING_DIRECTIVE = { code: "missing-directive", message: "无用户本章指示。", kind: "persistent" };

beforeEach(async () => {
  vi.clearAllMocks();
  apiMocks.data.clear();
  // 该包未启用 globals，@testing-library/react 不会自动 cleanup；
  // 不清理会让多次 render 的 DOM 累积，getByTestId 报 "multiple elements"。
  const { cleanup } = await import("@testing-library/react");
  cleanup();
});

describe("WriteViewPanel 一键修落点", () => {
  it("写作技能未启用 → 切到「技能文风」视图", async () => {
    const { fireEvent, render, screen, waitFor } = await import("@testing-library/react");
    const { WriteViewPanel } = await import("./WriteViewPanel");
    const onOpenSettings = vi.fn();
    const onSwitchView = vi.fn();

    render(
      <WriteViewPanel
        bookId={BOOK_ID}
        callTool={async () => preflightWith({ warningItems: [STYLE_DISABLED] })}
        onOpenSettings={onOpenSettings}
        onSwitchView={onSwitchView}
      />,
    );

    const fix = await waitFor(() => screen.getByTestId("write-fix-style-disabled"));
    fireEvent.click(fix);

    await waitFor(() => expect(onSwitchView).toHaveBeenCalledWith("skills-style"));
    // 写作设置里已没有写作技能分区
    expect(onOpenSettings).not.toHaveBeenCalled();
  });

  it("缺本章焦点（书里已有章节）→ 引导卡「补全本章焦点」，点按钮滚动到创作罗盘，而不是跳去经纬大纲", async () => {
    const { fireEvent, render, screen, waitFor } = await import("@testing-library/react");
    const { WriteViewPanel } = await import("./WriteViewPanel");
    const onOpenLorePanel = vi.fn();
    const onSwitchView = vi.fn();
    const onOpenNewBookGuide = vi.fn();

    render(
      <WriteViewPanel
        bookId={BOOK_ID}
        callTool={async () => preflightWith({ blockers: [MISSING_DIRECTIVE] })}
        onOpenLorePanel={onOpenLorePanel}
        onSwitchView={onSwitchView}
        hasChapters
        onOpenNewBookGuide={onOpenNewBookGuide}
      />,
    );

    await waitFor(() => expect(screen.getByTestId("write-onboarding-title").textContent).toBe("补全本章焦点"));
    fireEvent.click(screen.getByTestId("write-onboarding-action"));

    await waitFor(() => expect(screen.getByText(/请在上方创作罗盘填写本章目标/)).toBeTruthy());
    expect(onOpenLorePanel).not.toHaveBeenCalled();
    expect(onSwitchView).not.toHaveBeenCalled();
    expect(onOpenNewBookGuide).not.toHaveBeenCalled();
  });

  it("新书还没答十一问 → 引导卡「先回答建书十一问」替代红色报错，点击交给宿主打开十一问", async () => {
    const { fireEvent, render, screen, waitFor } = await import("@testing-library/react");
    const { WriteViewPanel } = await import("./WriteViewPanel");
    const onOpenNewBookGuide = vi.fn();

    render(
      <WriteViewPanel
        bookId="book-new-guide-pending"
        callTool={async () => preflightWith({ blockers: [MISSING_DIRECTIVE], warningItems: [STYLE_DISABLED] })}
        onOpenNewBookGuide={onOpenNewBookGuide}
      />,
    );

    await waitFor(() => expect(screen.getByTestId("write-onboarding-title").textContent).toBe("先回答建书十一问"));
    // 不再有红色就绪条，也不再有那句报错与红色 ×
    expect(screen.queryByTestId("write-ready-bar")).toBeNull();
    expect(document.body.textContent).not.toContain("无法确定写章方向");
    expect(screen.queryByTestId("write-fix-missing-directive")).toBeNull();
    expect(screen.getByTestId("write-checks").textContent).toContain("写作技能");

    fireEvent.click(screen.getByTestId("write-onboarding-action"));
    expect(onOpenNewBookGuide).toHaveBeenCalledTimes(1);
  });

  it("十一问答完（本机派发完成事件）→ 引导卡换成「补全本章焦点」", async () => {
    const { act, render, screen, waitFor } = await import("@testing-library/react");
    const { WriteViewPanel } = await import("./WriteViewPanel");
    const { markNewBookGuideCompleted } = await import("./new-book-guide-state");

    render(
      <WriteViewPanel
        bookId="book-guide-just-done"
        callTool={async () => preflightWith({ blockers: [MISSING_DIRECTIVE] })}
        onOpenNewBookGuide={() => {}}
      />,
    );

    await waitFor(() => expect(screen.getByTestId("write-onboarding-title").textContent).toBe("先回答建书十一问"));
    act(() => markNewBookGuideCompleted("book-guide-just-done"));
    await waitFor(() => expect(screen.getByTestId("write-onboarding-title").textContent).toBe("补全本章焦点"));
  });

  it("宿主没接十一问入口时给出可见说明", async () => {
    const { fireEvent, render, screen, waitFor } = await import("@testing-library/react");
    const { WriteViewPanel } = await import("./WriteViewPanel");

    render(
      <WriteViewPanel
        bookId="book-no-guide-host"
        callTool={async () => preflightWith({ blockers: [MISSING_DIRECTIVE] })}
      />,
    );

    fireEvent.click(await waitFor(() => screen.getByTestId("write-onboarding-action")));
    await waitFor(() => expect(screen.getByText(/当前环境无法切换到作品总览/)).toBeTruthy());
  });

  it("引导卡状态下写一句够长的本章指示，写章按钮即可用", async () => {
    const { fireEvent, render, screen, waitFor } = await import("@testing-library/react");
    const { WriteViewPanel } = await import("./WriteViewPanel");
    const onRunWrite = vi.fn();

    render(
      <WriteViewPanel
        bookId="book-guide-directive"
        callTool={async () => ({ ...preflightWith({ blockers: [MISSING_DIRECTIVE] }), chapterNumber: 1, recentChapters: [] })}
        onRunWrite={onRunWrite}
      />,
    );

    await waitFor(() => expect(screen.getByTestId("write-onboarding")).toBeTruthy());
    const write = screen.getByTestId("write-chapter") as HTMLButtonElement;
    expect(write.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("write-directive-input"), { target: { value: "让林舟在雨夜的旧站台第一次遇见苏晚" } });
    await waitFor(() => expect((screen.getByTestId("write-chapter") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId("write-chapter"));
    expect(onRunWrite).toHaveBeenCalledWith(expect.objectContaining({ mode: "chapter", chapterNumber: 1, directive: "让林舟在雨夜的旧站台第一次遇见苏晚" }));
  });

  it("除缺指示外还有其它阻断时，照常显示红色报错就绪条", async () => {
    const { render, screen, waitFor } = await import("@testing-library/react");
    const { WriteViewPanel } = await import("./WriteViewPanel");

    render(
      <WriteViewPanel
        bookId="book-broken"
        callTool={async () => preflightWith({ blockers: [BOOK_NOT_FOUND, MISSING_DIRECTIVE] })}
        onOpenNewBookGuide={() => {}}
      />,
    );

    await waitFor(() => expect(screen.getByTestId("write-headline").textContent).toContain("book.json 损坏"));
    expect(screen.queryByTestId("write-onboarding")).toBeNull();
    expect(screen.getByTestId("write-fix-missing-directive")).toBeTruthy();
  });

  it("宿主没接入口时给出可见说明，而不是点了没反应", async () => {
    const { fireEvent, render, screen, waitFor } = await import("@testing-library/react");
    const { WriteViewPanel } = await import("./WriteViewPanel");

    render(
      <WriteViewPanel
        bookId={BOOK_ID}
        callTool={async () => preflightWith({ warningItems: [STYLE_DISABLED] })}
      />,
    );

    const fix = await waitFor(() => screen.getByTestId("write-fix-style-disabled"));
    fireEvent.click(fix);

    await waitFor(() => {
      expect(screen.getByText(/当前环境无法切换侧栏视图，请手动打开「启用写作技能」/)).toBeTruthy();
    });
  });

  it("就绪条标签用「写作技能」，不露英文，也不再出现已下线的「文风预设」", async () => {
    const { render, screen, waitFor } = await import("@testing-library/react");
    const { WriteViewPanel } = await import("./WriteViewPanel");

    render(
      <WriteViewPanel
        bookId={BOOK_ID}
        callTool={async () => preflightWith({ warningItems: [STYLE_DISABLED] })}
      />,
    );

    await waitFor(() => expect(screen.getByTestId("write-checks")).toBeTruthy());
    expect(screen.getByTestId("write-checks").textContent).toContain("写作技能");
    expect(screen.getByTestId("write-checks").textContent).not.toContain("Writing Skills");
    // 旧「文风预设」（enabledPresetIds）已迁移下线，界面上不该再出现这个词
    expect(document.body.textContent).not.toContain("文风预设");
  });

  it("推荐章已写则显示打开正文，而不是生成蓝图", async () => {
    const { fireEvent, render, screen, waitFor } = await import("@testing-library/react");
    const { WriteViewPanel } = await import("./WriteViewPanel");
    const onJumpToChapter = vi.fn();
    const onRunWrite = vi.fn();

    render(
      <WriteViewPanel
        bookId={BOOK_ID}
        callTool={async () => ({
          ok: true,
          chapterNumber: 12,
          formalChapterCount: 12,
          resolvedDirective: "继续推进试炼",
          needsUserConfirm: false,
          recentChapters: [{ number: 12, summary: "试炼进行中" }],
          blockers: [],
          warningItems: [],
          platform: { label: "起点", recommendedChapterWords: { ideal: 2800 } },
        })}
        onJumpToChapter={onJumpToChapter}
        onRunWrite={onRunWrite}
      />,
    );

    const open = await waitFor(() => screen.getByTestId("write-open-chapter"));
    expect(screen.queryByTestId("write-blueprint")).toBeNull();
    expect(screen.getByTestId("write-word-target").textContent).toContain("2,800");
    fireEvent.click(open);
    expect(onJumpToChapter).toHaveBeenCalledWith(12);
    expect(onRunWrite).not.toHaveBeenCalled();
  });

  it("填写至少 8 字指示后，刷新 preflight 会携带 userDirectives", async () => {
    const { fireEvent, render, screen, waitFor } = await import("@testing-library/react");
    const { WriteViewPanel } = await import("./WriteViewPanel");
    const callTool = vi.fn(async () => preflightWith({}));
    const directive = "让主角在雨夜查明旧案真相";

    render(<WriteViewPanel bookId={BOOK_ID} callTool={callTool} />);
    fireEvent.change(screen.getByTestId("write-directive-input"), {
      target: { value: directive },
    });
    await waitFor(() => {
      expect((screen.getByTestId("write-directive-input") as HTMLTextAreaElement).value).toBe(directive);
    });
    fireEvent.click(screen.getByTestId("write-refresh"));

    await waitFor(() => {
      const preflightCalls = callTool.mock.calls.filter(([tool]) => tool === "write.preflight");
      expect(preflightCalls).toContainEqual([
        "write.preflight",
        {
          userDirectives: directive,
          acceptFocusDefault: false,
        },
      ]);
    });
  });
});

describe("WriteViewPanel 章节循环（写 → 改 → 收尾）", () => {
  const FRESHNESS = "narrative-memory/settlement-freshness";
  const VAULT = "style/vault";

  it("还没有写完的章：停在「写」，改与收尾不可点", async () => {
    const { render, screen, waitFor } = await import("@testing-library/react");
    const { WriteViewPanel } = await import("./WriteViewPanel");
    render(<WriteViewPanel bookId={BOOK_ID} callTool={async () => ({ ...preflightWith({}), chapterNumber: 1, recentChapters: [] })} />);

    await waitFor(() => expect(screen.getByTestId("chapter-loop-step-write").getAttribute("aria-selected")).toBe("true"));
    expect((screen.getByTestId("chapter-loop-step-revise") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("chapter-loop-step-close") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("write-directive-input")).toBeTruthy();
  });

  it("AI 刚写完第 11 章、作者还没改：默认停在「改」，能打开第 11 章", async () => {
    const { fireEvent, render, screen, waitFor } = await import("@testing-library/react");
    const { WriteViewPanel } = await import("./WriteViewPanel");
    apiMocks.data.set(FRESHNESS, { chapters: [{ chapterNumber: 11, title: "旧站", status: "unsettled" }] });
    apiMocks.data.set(VAULT, { chapters: [{ chapterNumber: 11, title: "旧站", hasAiDraft: true, share: { authorRatio: 0 } }] });
    const onJumpToChapter = vi.fn();
    render(<WriteViewPanel bookId={BOOK_ID} callTool={async () => preflightWith({})} onJumpToChapter={onJumpToChapter} />);

    await waitFor(() => expect(screen.getByTestId("chapter-loop-revise")).toBeTruthy());
    expect(screen.getByTestId("chapter-loop-step-revise").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("chapter-loop-author-ratio").textContent).toContain("0%");
    expect(screen.getByTestId("chapter-loop-attention-revise")).toBeTruthy();
    fireEvent.click(screen.getByTestId("chapter-loop-open-chapter"));
    expect(onJumpToChapter).toHaveBeenCalledWith(11);
    // 写这一步的输入框此时不显示；点「写」可以切回去
    expect(screen.queryByTestId("write-directive-input")).toBeNull();
    fireEvent.click(screen.getByTestId("chapter-loop-step-write"));
    expect(screen.getByTestId("write-directive-input")).toBeTruthy();
  });

  it("改这一步附带表达自审：读章节正文后只读列出命中，定位交给编辑器搜索", async () => {
    const { fireEvent, render, screen, waitFor } = await import("@testing-library/react");
    const { WriteViewPanel } = await import("./WriteViewPanel");
    apiMocks.data.set(FRESHNESS, { chapters: [{ chapterNumber: 11, title: "旧站", status: "unsettled" }] });
    apiMocks.data.set(VAULT, { chapters: [{ chapterNumber: 11, title: "旧站", hasAiDraft: true, share: { authorRatio: 0 } }] });
    apiMocks.fetchJson.mockResolvedValueOnce({ content: "他不禁抬头。\r\n\r\n她感到紧张。" });
    const onJumpToChapter = vi.fn();
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    render(<WriteViewPanel bookId={BOOK_ID} callTool={async () => preflightWith({})} onJumpToChapter={onJumpToChapter} />);

    await waitFor(() => expect(screen.getByTestId("chapter-loop-revise")).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId("self-review-message").textContent).toContain("已定位"));
    expect(apiMocks.fetchJson).toHaveBeenCalledWith(`/api/books/${BOOK_ID}/chapters/11`);

    const items = screen.getAllByTestId("self-review-item");
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]!.textContent).toContain("不禁");
    fireEvent.click(screen.getAllByTestId("self-review-locate")[0]!);
    expect(onJumpToChapter).toHaveBeenCalledWith(11);

    // 300ms 后把原句送进编辑器搜索（章节 tab 刚打开时给编辑器挂载留时间）
    await new Promise((resolve) => setTimeout(resolve, 400));
    const locateEvent = dispatchSpy.mock.calls
      .map(([event]) => event as CustomEvent<{ quote?: string }>)
      .find((event) => event.type === "novelfork:locate-in-editor");
    expect(locateEvent?.detail?.quote).toContain("不禁");
    dispatchSpy.mockRestore();
  });

  it("自审有命中时可以把问题清单交给叙述者做人文化，消息带逐条要求", async () => {
    const { fireEvent, render, screen, waitFor } = await import("@testing-library/react");
    const { WriteViewPanel, buildHumanizeMessage } = await import("./WriteViewPanel");
    const { reviewChapterParagraphs } = await import("../../engine/compliance/paragraph-self-review");
    apiMocks.data.set(FRESHNESS, { chapters: [{ chapterNumber: 11, title: "旧站", status: "unsettled" }] });
    apiMocks.data.set(VAULT, { chapters: [{ chapterNumber: 11, title: "旧站", hasAiDraft: true, share: { authorRatio: 0 } }] });
    const content = "他不禁抬头。\r\n\r\n她感到紧张。";
    apiMocks.fetchJson.mockResolvedValueOnce({ content });
    const onSendToNarrator = vi.fn(async () => undefined);
    render(<WriteViewPanel bookId={BOOK_ID} callTool={async () => preflightWith({})} onSendToNarrator={onSendToNarrator} />);

    await waitFor(() => expect(screen.getByTestId("self-review-message").textContent).toContain("已定位"));
    fireEvent.click(screen.getByTestId("self-review-humanize"));
    await waitFor(() => expect(screen.getByTestId("self-review-handoff-note").textContent).toContain("已把"));
    expect(onSendToNarrator).toHaveBeenCalledTimes(1);

    const message = onSendToNarrator.mock.calls[0]![0] as string;
    expect(message).toContain("第 11 章的表达检查发现了");
    expect(message).toContain("chapter.propose_selection");
    expect(message).toContain("不超过原句的 10%");
    expect(message).toContain("省略 from/to");
    expect(message).toContain("不禁");
    expect(message).toContain("感到紧张");

    // 消息组装本身：问题清单逐条列出、截断到 20 条
    const issues = reviewChapterParagraphs(content).issues;
    expect(buildHumanizeMessage(11, issues)).toContain("1. 第 1 段");
    expect(buildHumanizeMessage(11, issues)).toContain("2. 第 2 段");
  });

  it("交接时注入文风预设里的作者硬约束，段落在人文化手法说明之前", async () => {
    const { fireEvent, render, screen, waitFor } = await import("@testing-library/react");
    const { WriteViewPanel, buildHumanizeMessage } = await import("./WriteViewPanel");
    const { reviewChapterParagraphs } = await import("../../engine/compliance/paragraph-self-review");
    apiMocks.data.set(FRESHNESS, { chapters: [{ chapterNumber: 11, title: "旧站", status: "unsettled" }] });
    apiMocks.data.set(VAULT, { chapters: [{ chapterNumber: 11, title: "旧站", hasAiDraft: true, share: { authorRatio: 0 } }] });
    const content = "他不禁抬头。\r\n\r\n她感到紧张。";
    apiMocks.fetchJson
      .mockResolvedValueOnce({ content })
      .mockResolvedValueOnce({ preset: { customConstraints: ["对话必须口语化", " 不许用破折号 "] }, revision: "r1", source: "preset", guideText: "" });
    const onSendToNarrator = vi.fn(async () => undefined);
    render(<WriteViewPanel bookId={BOOK_ID} callTool={async () => preflightWith({})} onSendToNarrator={onSendToNarrator} />);

    await waitFor(() => expect(screen.getByTestId("self-review-message").textContent).toContain("已定位"));
    fireEvent.click(screen.getByTestId("self-review-humanize"));
    await waitFor(() => expect(screen.getByTestId("self-review-handoff-note").textContent).toContain("已把"));
    expect(apiMocks.fetchJson).toHaveBeenCalledWith(`/api/books/${BOOK_ID}/style/preset`);

    const message = onSendToNarrator.mock.calls[0]![0] as string;
    expect(message).toContain("本书硬约束（作者设定，必须逐条遵守");
    expect(message).toContain("- 对话必须口语化");
    expect(message).toContain("- 不许用破折号");
    expect(screen.getByTestId("self-review-handoff-note").textContent).not.toContain("未注入");
    const lines = message.split("\n");
    expect(lines.findIndex((line) => line.startsWith("本书硬约束")))
      .toBeLessThan(lines.findIndex((line) => line.startsWith("- 可选的人文化手法")));

    // 组装层：未传或传空数组与现状逐字一致，有效条目才注入
    const issues = reviewChapterParagraphs(content).issues;
    expect(buildHumanizeMessage(11, issues, undefined)).toBe(buildHumanizeMessage(11, issues));
    expect(buildHumanizeMessage(11, issues, [])).toBe(buildHumanizeMessage(11, issues));
    expect(buildHumanizeMessage(11, issues)).not.toContain("本书硬约束");
    expect(buildHumanizeMessage(11, issues, ["对白只用短句"])).toContain("- 对白只用短句");
  });

  it("硬约束读取失败：仍完成交接，消息不带硬约束，说明里如实交代", async () => {
    const { fireEvent, render, screen, waitFor } = await import("@testing-library/react");
    const { WriteViewPanel } = await import("./WriteViewPanel");
    apiMocks.data.set(FRESHNESS, { chapters: [{ chapterNumber: 11, title: "旧站", status: "unsettled" }] });
    apiMocks.data.set(VAULT, { chapters: [{ chapterNumber: 11, title: "旧站", hasAiDraft: true, share: { authorRatio: 0 } }] });
    apiMocks.fetchJson
      .mockResolvedValueOnce({ content: "他不禁抬头。\r\n\r\n她感到紧张。" })
      .mockRejectedValueOnce(new Error("文风预设损坏"));
    const onSendToNarrator = vi.fn(async () => undefined);
    render(<WriteViewPanel bookId={BOOK_ID} callTool={async () => preflightWith({})} onSendToNarrator={onSendToNarrator} />);

    await waitFor(() => expect(screen.getByTestId("self-review-message").textContent).toContain("已定位"));
    fireEvent.click(screen.getByTestId("self-review-humanize"));
    await waitFor(() => expect(screen.getByTestId("self-review-handoff-note").textContent).toContain("已把"));
    expect((onSendToNarrator.mock.calls[0]![0] as string)).not.toContain("本书硬约束");
    expect(screen.getByTestId("self-review-handoff-note").textContent).toContain("未注入");
  });

  it("作者改过但还没结算：默认停在「收尾」，结算经重新结算接口，结果与改稿段可见", async () => {
    const { fireEvent, render, screen, waitFor } = await import("@testing-library/react");
    const { WriteViewPanel } = await import("./WriteViewPanel");
    apiMocks.data.set(FRESHNESS, { chapters: [{ chapterNumber: 11, title: "旧站", status: "unsettled" }] });
    apiMocks.data.set(VAULT, { chapters: [{ chapterNumber: 11, title: "旧站", hasAiDraft: true, share: { authorRatio: 0.35 } }] });
    apiMocks.fetchJson.mockResolvedValueOnce({ summary: "第11章已结算：提出 3 条变化。" });
    render(<WriteViewPanel bookId={BOOK_ID} callTool={async () => preflightWith({})} />);

    await waitFor(() => expect(screen.getByTestId("chapter-loop-close")).toBeTruthy());
    expect(screen.getByTestId("chapter-loop-settlement").textContent).toContain("还没结算");
    expect(screen.getByTestId("chapter-revisions").textContent).toContain("第 11 章");
    fireEvent.click(screen.getByTestId("chapter-loop-settle"));
    await waitFor(() => expect(screen.getByTestId("chapter-loop-settle-note").textContent).toContain("提出 3 条变化"));
    expect(apiMocks.fetchJson).toHaveBeenCalledWith(
      `/api/books/${BOOK_ID}/narrative-memory/chapters/11/resettle`,
      { method: "POST" },
    );
    expect(screen.getByTestId("chapter-loop-next").textContent).toBe("开始写第 12 章");
  });

  it("没有可用模型时，收尾显示服务端给的原因", async () => {
    const { fireEvent, render, screen, waitFor } = await import("@testing-library/react");
    const { WriteViewPanel } = await import("./WriteViewPanel");
    apiMocks.data.set(FRESHNESS, { chapters: [{ chapterNumber: 11, status: "stale" }] });
    apiMocks.fetchJson.mockRejectedValueOnce(new Error("Runtime 还没有设置默认模型。到设置里选择默认模型。"));
    render(<WriteViewPanel bookId={BOOK_ID} callTool={async () => preflightWith({})} />);

    await waitFor(() => expect(screen.getByTestId("chapter-loop-settle").textContent).toBe("重新结算第 11 章"));
    fireEvent.click(screen.getByTestId("chapter-loop-settle"));
    await waitFor(() => expect(screen.getByTestId("chapter-loop-settle-note").textContent).toContain("默认模型"));
  });

  it("已结算的章可以在收尾里强制重新结算（上次漏记时用）", async () => {
    const { fireEvent, render, screen, waitFor } = await import("@testing-library/react");
    const { WriteViewPanel } = await import("./WriteViewPanel");
    apiMocks.data.set(FRESHNESS, { chapters: [{ chapterNumber: 11, status: "fresh" }] });
    apiMocks.fetchJson.mockResolvedValueOnce({ summary: "第11章已重新抽取。" });
    render(<WriteViewPanel bookId={BOOK_ID} callTool={async () => preflightWith({})} />);

    await waitFor(() => expect((screen.getByTestId("chapter-loop-step-close") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId("chapter-loop-step-close"));
    expect(screen.queryByTestId("chapter-loop-settle")).toBeNull();
    fireEvent.click(screen.getByTestId("chapter-loop-force-settle"));
    await waitFor(() => expect(screen.getByTestId("chapter-loop-settle-note").textContent).toContain("重新抽取"));
    expect(apiMocks.fetchJson).toHaveBeenCalledWith(
      `/api/books/${BOOK_ID}/narrative-memory/chapters/11/resettle`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ force: true }) },
    );
  });

  it("结算新鲜、没有提议：回到「写」下一章", async () => {
    const { render, screen, waitFor } = await import("@testing-library/react");
    const { WriteViewPanel } = await import("./WriteViewPanel");
    apiMocks.data.set(FRESHNESS, { chapters: [{ chapterNumber: 11, status: "fresh" }] });
    render(<WriteViewPanel bookId={BOOK_ID} callTool={async () => preflightWith({})} />);

    await waitFor(() => expect(screen.getByTestId("chapter-loop-step-write").getAttribute("aria-selected")).toBe("true"));
    expect((screen.getByTestId("chapter-loop-step-close") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByTestId("chapter-loop-attention-close")).toBeNull();
  });
});

describe("WriteViewPanel 工作流入口（原故事画布「执行」页迁到写作）", () => {
  const FRESHNESS = "narrative-memory/settlement-freshness";
  const VAULT = "style/vault";

  it("写这一步里有「工作流：按工序写这一章」，点击交给宿主在中央打开", async () => {
    const { fireEvent, render, screen, waitFor } = await import("@testing-library/react");
    const { WriteViewPanel } = await import("./WriteViewPanel");
    const onOpenWorkflow = vi.fn();
    render(<WriteViewPanel bookId={BOOK_ID} callTool={async () => ({ ...preflightWith({}), chapterNumber: 1, recentChapters: [] })} onOpenWorkflow={onOpenWorkflow} />);

    await waitFor(() => expect(screen.getByTestId("chapter-loop-step-write").getAttribute("aria-selected")).toBe("true"));
    const entry = screen.getByTestId("write-open-workflow");
    expect(entry.textContent).toContain("工作流：按工序写这一章");
    // 不暴露内部术语
    expect(entry.textContent).not.toMatch(/workflow|执行页|recipe/i);
    fireEvent.click(entry);
    expect(onOpenWorkflow).toHaveBeenCalledTimes(1);
  });

  it("改、收尾两步也能找到工作流入口（工序停下等确认时作者可能在任何一步）", async () => {
    const { render, screen, waitFor } = await import("@testing-library/react");
    const { WriteViewPanel } = await import("./WriteViewPanel");
    apiMocks.data.set(FRESHNESS, { chapters: [{ chapterNumber: 11, title: "旧站", status: "unsettled" }] });
    apiMocks.data.set(VAULT, { chapters: [{ chapterNumber: 11, title: "旧站", hasAiDraft: true, share: { authorRatio: 0 } }] });
    render(<WriteViewPanel bookId={BOOK_ID} callTool={async () => preflightWith({})} onOpenWorkflow={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId("chapter-loop-revise")).toBeTruthy());
    expect(screen.getByTestId("write-open-workflow")).toBeTruthy();
  });

  it("宿主没接工作流入口时不显示按钮，不留点了没反应的死入口", async () => {
    const { render, screen, waitFor } = await import("@testing-library/react");
    const { WriteViewPanel } = await import("./WriteViewPanel");
    render(<WriteViewPanel bookId={BOOK_ID} callTool={async () => ({ ...preflightWith({}), chapterNumber: 1, recentChapters: [] })} />);

    await waitFor(() => expect(screen.getByTestId("chapter-loop-step-write").getAttribute("aria-selected")).toBe("true"));
    expect(screen.queryByTestId("write-open-workflow")).toBeNull();
  });
});

describe("WriteViewPanel「伏笔到期」一键修落点", () => {
  const HOOKS_OVERDUE = { code: "hooks-overdue", message: "有 2 个伏笔已超期。", kind: "advisory" };

  it("打开故事画布（伏笔账本在「下一章」页），不再切到已没有账本的故事推进侧栏", async () => {
    const { fireEvent, render, screen, waitFor } = await import("@testing-library/react");
    const { WriteViewPanel } = await import("./WriteViewPanel");
    const onOpenStoryCanvas = vi.fn();
    const onSwitchView = vi.fn();
    render(
      <WriteViewPanel
        bookId={BOOK_ID}
        callTool={async () => preflightWith({ warningItems: [HOOKS_OVERDUE] })}
        onOpenStoryCanvas={onOpenStoryCanvas}
        onSwitchView={onSwitchView}
      />,
    );

    fireEvent.click(await waitFor(() => screen.getByTestId("write-fix-hooks-overdue")));
    expect(onOpenStoryCanvas).toHaveBeenCalledTimes(1);
    expect(onSwitchView).not.toHaveBeenCalled();
  });

  it("宿主没接故事画布入口时给出可见说明", async () => {
    const { fireEvent, render, screen, waitFor } = await import("@testing-library/react");
    const { WriteViewPanel } = await import("./WriteViewPanel");
    render(<WriteViewPanel bookId={BOOK_ID} callTool={async () => preflightWith({ warningItems: [HOOKS_OVERDUE] })} />);

    fireEvent.click(await waitFor(() => screen.getByTestId("write-fix-hooks-overdue")));
    expect(await screen.findByText(/打开故事画布/)).toBeTruthy();
  });
});
