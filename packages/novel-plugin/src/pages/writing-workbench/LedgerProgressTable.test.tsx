import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PRESSURE_LEDGER_STALE_AFTER_CHAPTERS,
} from "../../engine/agents/pressure-ledger-kinds";
import {
  buildConflictRow,
  buildDebtRow,
  buildForeshadowRow,
  createForeshadowingBoardNode,
  LedgerProgressTable,
  looksLikePuzzle,
} from "./LedgerProgressTable";

const fetchJson = vi.hoisted(() => vi.fn(async () => ({})));

vi.mock("@/hooks/use-api", () => ({
  fetchJson: (...args: unknown[]) => fetchJson(...args),
  useApi: (path: string | null) => {
    if (path?.includes("category=foreshadowing")) {
      return {
        data: {
          entries: [
            { id: "fs-1", title: "青铜戒指之谜", customFields: { status: "已埋设", plantedChapter: 5, targetChapter: 12, kind: "puzzle" } },
            { id: "fs-2", title: "已回收伏笔", customFields: { status: "已回收", plantedChapter: 1 } },
          ],
        },
        loading: false,
        error: null,
        refetch: vi.fn(async () => undefined),
      };
    }
    if (path?.includes("category=conflicts")) {
      return {
        data: {
          entries: [
            { id: "cf-1", title: "通道授权争夺", customFields: { status: "进行中", chapterStart: 8, chapterEnd: 10 } },
          ],
        },
        loading: false,
        error: null,
        refetch: vi.fn(async () => undefined),
      };
    }
    if (path?.endsWith("/state")) {
      return {
        data: {
          resourceLedger: {
            resources: [
              { resourceId: "debt-1", name: "实验债", balance: 3, lastChapter: 2 },
              { resourceId: "misc-1", name: "无关道具", balance: 1, lastChapter: 2 },
            ],
          },
        },
        loading: false,
        error: null,
        refetch: vi.fn(async () => undefined),
      };
    }
    return { data: undefined, loading: false, error: null, refetch: vi.fn(async () => undefined) };
  },
}));

vi.mock("@/components/ui/toast", () => ({
  toast: vi.fn(),
}));

afterEach(() => {
  cleanup();
  fetchJson.mockClear();
});

describe("LedgerProgressTable 行模型", () => {
  it("伏笔超期用债务模块 explanation，不自造文案", () => {
    const row = buildForeshadowRow(
      { id: "fs-1", title: "断剑", customFields: { status: "已埋设", plantedChapter: 1 } },
      30,
    );
    expect(row.kind).toBe("foreshadow");
    expect(row.warning).toContain("超过");
    expect(row.statusEditable).toBe(true);
  });

  it("冲突到期未收束给出警告；已收束不再警告", () => {
    const open = buildConflictRow(
      { id: "cf-1", title: "通道", customFields: { status: "进行中", chapterEnd: 10 } },
      12,
    );
    expect(open.warning).toContain("仍未收束");
    const closed = buildConflictRow(
      { id: "cf-2", title: "通道", customFields: { status: "已收束", chapterEnd: 10 } },
      12,
    );
    expect(closed.warning).toBeUndefined();
  });

  it("冲突行优先吃正方/反方/赌注/收束章，旧起止章仍可回退", () => {
    const modern = buildConflictRow(
      {
        id: "cf-new",
        title: "授权争夺",
        customFields: {
          protagonistSide: "林舟",
          antagonistSide: "周衡",
          stakes: "失去北境通道",
          status: "进行中",
          resolutionChapter: 10,
        },
      },
      12,
    );
    expect(modern.description).toContain("林舟 vs 周衡");
    expect(modern.description).toContain("失去北境通道");
    expect(modern.chapterLabel).toContain("收 10");
    expect(modern.jumpChapter).toBe(10);
    expect(modern.warning).toContain("仍未收束");

    const legacy = buildConflictRow(
      { id: "cf-old", title: "旧冲突", customFields: { summary: "事件摘要", chapterStart: 3, chapterEnd: 8, status: "进行中" } },
      6,
    );
    expect(legacy.description).toContain("事件摘要");
    expect(legacy.chapterLabel).toBe("起 3 · 收 8");
    expect(legacy.jumpChapter).toBe(8);
  });

  it("资源按钱证仇债分类；遗忘阈值与闸一致；无关道具不入表", () => {
    const forgotten = buildDebtRow(
      { resourceId: "debt-1", name: "实验债", lastChapter: 2, balance: 1 },
      2 + PRESSURE_LEDGER_STALE_AFTER_CHAPTERS,
    );
    expect(forgotten?.kind).toBe("debt");
    expect(forgotten?.statusEditable).toBe(false);
    expect(forgotten?.warning).toContain("可能被遗忘");
    expect(buildDebtRow({ resourceId: "misc", name: "无关道具", lastChapter: 1 }, 20)).toBeNull();
  });

  it("谜题是过滤标签，不是新分类", () => {
    expect(looksLikePuzzle({ name: "青铜戒指之谜" })).toBe(true);
    expect(looksLikePuzzle({ name: "通道授权", eventType: "puzzle" })).toBe(true);
    expect(looksLikePuzzle({ name: "日常冲突", eventType: "主线" })).toBe(false);
  });
});

describe("LedgerProgressTable", () => {
  it("聚合伏笔、冲突、债务三类行，资源行只读，改伏笔状态走 fieldsPatch", async () => {
    const onOpen = vi.fn();
    const onJumpToChapter = vi.fn();
    render(
      <LedgerProgressTable
        bookId="book-1"
        currentChapter={12}
        onOpen={onOpen}
        onJumpToChapter={onJumpToChapter}
      />,
    );

    expect(screen.getByTestId("ledger-progress-table")).toBeTruthy();
    expect(screen.getByText("青铜戒指之谜")).toBeTruthy();
    expect(screen.getByText("通道授权争夺")).toBeTruthy();
    expect(screen.getByText("实验债")).toBeTruthy();
    expect(screen.queryByText("无关道具")).toBeNull();
    expect(screen.getByText("章后结算")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("青铜戒指之谜 状态"), { target: { value: "部分揭示" } });
    expect(fetchJson).toHaveBeenCalledWith(
      "/api/books/book-1/jingwei/entries/fs-1",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ fieldsPatch: { status: "部分揭示" } }),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "打开看板" }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining(createForeshadowingBoardNode()));
  });

  it("谜题过滤只留下带谜标记的行", () => {
    render(
      <LedgerProgressTable
        bookId="book-1"
        currentChapter={12}
        onOpen={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "谜题" }));
    expect(screen.getByText("青铜戒指之谜")).toBeTruthy();
    expect(screen.queryByText("通道授权争夺")).toBeNull();
    expect(screen.queryByText("实验债")).toBeNull();
  });
});
