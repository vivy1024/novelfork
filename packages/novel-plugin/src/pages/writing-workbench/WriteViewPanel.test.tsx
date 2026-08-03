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

const STYLE_DISABLED = { code: "style-disabled", message: "未启用任何 Writing Skills。", kind: "advisory" };
const MISSING_DIRECTIVE = { code: "missing-directive", message: "无用户本章指示。", kind: "persistent" };

beforeEach(async () => {
  vi.clearAllMocks();
  // 该包未启用 globals，@testing-library/react 不会自动 cleanup；
  // 不清理会让多次 render 的 DOM 累积，getByTestId 报 "multiple elements"。
  const { cleanup } = await import("@testing-library/react");
  cleanup();
});

describe("WriteViewPanel 一键修落点", () => {
  it("Writing Skills 未启用 → 打开写作设置的 writing-skills 分区", async () => {
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

    await waitFor(() => expect(onOpenSettings).toHaveBeenCalledWith("writing-skills"));
    // 「工具」侧栏没有启用入口，不该再往那边跳
    expect(onSwitchView).not.toHaveBeenCalled();
  });

  it("缺本章指示 → 打开经纬面板并定位 outline 分类", async () => {
    const { fireEvent, render, screen, waitFor } = await import("@testing-library/react");
    const { WriteViewPanel } = await import("./WriteViewPanel");
    const onOpenLorePanel = vi.fn();
    const onSwitchView = vi.fn();

    render(
      <WriteViewPanel
        bookId={BOOK_ID}
        callTool={async () => preflightWith({ blockers: [MISSING_DIRECTIVE] })}
        onOpenLorePanel={onOpenLorePanel}
        onSwitchView={onSwitchView}
      />,
    );

    const fix = await waitFor(() => screen.getByTestId("write-fix-missing-directive"));
    fireEvent.click(fix);

    await waitFor(() => expect(onOpenLorePanel).toHaveBeenCalledWith("outline"));
    expect(onSwitchView).not.toHaveBeenCalled();
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
      expect(screen.getByText(/当前环境无法打开写作设置/)).toBeTruthy();
    });
  });

  it("就绪条标签用 Writing Skills，不再出现已下线的「文风预设」", async () => {
    const { render, screen, waitFor } = await import("@testing-library/react");
    const { WriteViewPanel } = await import("./WriteViewPanel");

    render(
      <WriteViewPanel
        bookId={BOOK_ID}
        callTool={async () => preflightWith({ warningItems: [STYLE_DISABLED] })}
      />,
    );

    await waitFor(() => expect(screen.getByTestId("write-checks")).toBeTruthy());
    expect(screen.getByTestId("write-checks").textContent).toContain("Writing Skills");
    // 旧「文风预设」（enabledPresetIds）已迁移下线，界面上不该再出现这个词
    expect(document.body.textContent).not.toContain("文风预设");
  });
});
