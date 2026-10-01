import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveNextAction, StorylineAndPlanningSidebarPanel } from "./StorylineAndPlanningSidebarPanel";
import { buildTargetChapterFields } from "./IdeWorkbench";
import type { ResourceTreeAction } from "../../WorkbenchResourceTree";
import type { WorkbenchResourceNode } from "../useWorkbenchResources";

vi.mock("@/hooks/use-api", () => ({
  fetchJson: vi.fn(async () => ({})),
  invalidateApiPaths: vi.fn(),
  useApi: (path: string | null) => {
    if (path?.includes("category=foreshadowing")) {
      return {
        data: {
          entries: [
            { id: "fs-1", title: "青铜戒指之谜", customFields: { status: "已埋设", plantedChapter: 5, targetChapter: 12 } },
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
    if (path?.endsWith("/settlement-freshness")) {
      return {
        data: {
          chapters: [
            { chapterNumber: 2, title: "入城", status: "fresh" },
            { chapterNumber: 3, title: "雨夜", status: "stale", settledAt: "2026-09-28T00:00:00.000Z" },
          ],
          staleChapters: [3],
          explanation: { whatHappened: "第 3 章的正文在结算后又被改过。", whyItMatters: "这些章的记忆停在旧正文上。", suggestedAction: "重新结算。" },
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
            resources: [{ resourceId: "debt-1", name: "实验债", balance: 3, lastChapter: 2 }],
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

vi.mock("../NarrativeMemoryPanel", () => ({
  NarrativeMemorySummary: ({ onOpenCenter }: { onOpenCenter?: () => void }) => (
    <button type="button" data-testid="mock-memory-summary" onClick={() => onOpenCenter?.()}>
      章后事实摘要
    </button>
  ),
}));

const capabilities = { open: true, readonly: false, unsupported: false, edit: true, delete: true, apply: false };

function node(id: string, title: string, kind: WorkbenchResourceNode["kind"] = "file", children?: WorkbenchResourceNode[]): WorkbenchResourceNode {
  return {
    id,
    kind,
    title,
    capabilities,
    ...(children ? { children } : {}),
  };
}

function renderPanel(options: {
  onAction?: (action: ResourceTreeAction) => void;
  extraOutlineNodes?: WorkbenchResourceNode[];
  onSendToNarrator?: (message: string) => void;
  bookTargetChapters?: number;
  outlineTreeNodes?: WorkbenchResourceNode[];
} = {}) {
  const onOpen = vi.fn();
  const onSwitchView = vi.fn();
  const onSendToNarrator = options.onSendToNarrator ?? vi.fn();
  const chapter = node("chapter:12", "第 12 章", "chapter");
  (chapter as WorkbenchResourceNode & { metadata?: Record<string, unknown> }).metadata = { chapterNumber: 12 };
  const outline = node("outline:1", "第一卷：起点", "jingwei-entry");
  render(
    <StorylineAndPlanningSidebarPanel
      bookId="book-1"
      chapterTreeNodes={[node("chapters", "章节", "group", [chapter])]}
      outlineTreeNodes={options.outlineTreeNodes ?? [node("outline", "卷纲", "group", [outline, ...(options.extraOutlineNodes ?? [])])]}
      selectedNodeId={null}
      onOpen={onOpen}
      onSwitchView={onSwitchView}
      onAction={options.onAction}
      onSendToNarrator={onSendToNarrator}
      bookTargetChapters={options.bookTargetChapters}
    />,
  );
  return { onOpen, onSwitchView, onSendToNarrator, chapter, outline };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("StorylineAndPlanningSidebarPanel 故事推进入口（IA 收敛后）", () => {
  it("默认展示章节与大纲 Tab，并点击叶子复用 onOpen", () => {
    const { onOpen, chapter, outline } = renderPanel();

    expect(screen.getByRole("button", { name: "章节与大纲" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "章后事实" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "故事画布" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "进度账本" })).toBeTruthy();
    expect(screen.getByText("当前语境")).toBeTruthy();
    expect(screen.getByText("第 12 章")).toBeTruthy();
    expect(screen.getByText("第一卷：起点")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "第 12 章" }));
    fireEvent.click(screen.getByRole("button", { name: "第一卷：起点" }));
    expect(onOpen).toHaveBeenCalledWith(chapter);
    expect(onOpen).toHaveBeenCalledWith(outline);
  });

  it("章节树显示「正文 › 卷01 › 第 1 章 雨夜」，不露文件名；点开交出的仍是原节点", () => {
    const onOpen = vi.fn();
    const chapterFile: WorkbenchResourceNode = {
      id: "file:chapters/卷01/0001_雨夜.md",
      kind: "chapter",
      title: "0001_雨夜.md",
      path: "chapters/卷01/0001_雨夜.md",
      capabilities,
      metadata: { filePath: "chapters/卷01/0001_雨夜.md", isFile: true, isChapter: true, chapterNumber: 1 },
    };
    const volume: WorkbenchResourceNode = {
      id: "file-dir:chapters/卷01",
      kind: "group",
      title: "卷01",
      capabilities,
      metadata: { filePath: "chapters/卷01", isDirectory: true },
      children: [chapterFile],
    };
    render(
      <StorylineAndPlanningSidebarPanel
        bookId="book-1"
        chapterTreeNodes={[{ id: "file-dir:chapters", kind: "group", title: "chapters", capabilities, metadata: { filePath: "chapters", isDirectory: true }, children: [volume] }]}
        outlineTreeNodes={[]}
        selectedNodeId={null}
        onOpen={onOpen}
        onSwitchView={vi.fn()}
      />,
    );

    expect(screen.getByText("正文")).toBeTruthy();
    // 卷目录默认收起，展开后才看到章节
    fireEvent.click(screen.getByRole("button", { name: "卷01" }));
    expect(screen.queryByText("0001_雨夜.md")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "第 1 章 雨夜" }));
    expect(onOpen).toHaveBeenCalledWith(chapterFile);
  });

  it("T3 身份链：已落稿纲显示 ✓徽标且隐藏提拔按钮，规划中显示 🗺，无目标号不标", () => {
    const onAction = vi.fn();
    const draftedOutline = node("outline:drafted", "第 12 章：通道授权", "jingwei-entry");
    (draftedOutline as WorkbenchResourceNode & { metadata?: Record<string, unknown> }).metadata = {
      category: "outline",
      fields: { targetChapterNumber: 12 },
    };
    const plannedOutline = node("outline:planned", "第 13 章：协议裂变", "jingwei-entry");
    (plannedOutline as WorkbenchResourceNode & { metadata?: Record<string, unknown> }).metadata = {
      category: "outline",
      fields: { targetChapterNumber: 13 },
    };
    const chapter12 = node("chapter:12", "第 12 章", "chapter");
    (chapter12 as WorkbenchResourceNode & { metadata?: Record<string, unknown> }).metadata = { chapterNumber: 12 };
    render(
      <StorylineAndPlanningSidebarPanel
        bookId="book-1"
        chapterTreeNodes={[node("chapters", "章节", "group", [chapter12])]}
        outlineTreeNodes={[draftedOutline, plannedOutline]}
        selectedNodeId={null}
        onOpen={vi.fn()}
        onSwitchView={vi.fn()}
        onAction={onAction}
      />,
    );

    // 已落稿：✓ 徽标；提拔按钮只对未落稿纲保留（下方对 🗺 纲的点击即验证）
    expect(screen.getByText("✓已落稿")).toBeTruthy();
    // 规划中：🗺 徽标 + 提拔按钮可用
    expect(screen.getByText("🗺规划中")).toBeTruthy();
    const promoteButton = screen.getByTitle("将大纲提拔至手稿章节");
    fireEvent.click(promoteButton);
    expect(onAction).toHaveBeenCalledWith({ type: "promote-outline", node: plannedOutline });
  });

  it("T3 纯函数：buildTargetChapterFields 合并保留既有字段仅写目标章号", () => {
    expect(buildTargetChapterFields({ volumeNumber: 1, goal: "主角觉醒" }, 12)).toEqual({
      volumeNumber: 1,
      goal: "主角觉醒",
      targetChapterNumber: 12,
    });
    expect(buildTargetChapterFields(undefined, 3)).toEqual({ targetChapterNumber: 3 });
    // 重复提拔覆盖旧目标号（改纲场景）
    expect(buildTargetChapterFields({ targetChapterNumber: 5 }, 9).targetChapterNumber).toBe(9);
  });

  it("章后事实 Tab 只渲染轻量摘要卡，点击摘要直达中央面板节点", () => {
    const { onOpen } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "章后事实" }));

    // 摘要卡渲染，且完整面板不在侧栏内嵌
    fireEvent.click(screen.getByTestId("mock-memory-summary"));
    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "memory-center:book-1",
        metadata: expect.objectContaining({ isMemoryCenter: true, bookId: "book-1" }),
      }),
    );
  });

  it("章后事实 Tab 列出记忆过期的章节，点重新结算调用对应接口", async () => {
    const { fetchJson } = await import("@/hooks/use-api");
    vi.mocked(fetchJson).mockResolvedValueOnce({ summary: "第 3 章已重新结算。" });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "章后事实" }));

    const region = screen.getByRole("region", { name: "记忆过期的章节" });
    expect(region.textContent).toContain("第 3 章 · 雨夜");
    expect(region.textContent).not.toContain("入城");
    fireEvent.click(screen.getByRole("button", { name: "重新结算第 3 章" }));
    expect(await screen.findByText("第 3 章已重新结算。")).toBeTruthy();
    expect(fetchJson).toHaveBeenCalledWith("/api/books/book-1/narrative-memory/chapters/3/resettle", { method: "POST" });
  });

  it("故事画布 Tab 点击即在中央打开画布，并提供故事树/推进/脉络快捷入口；经典图谱入口已移除", () => {
    const { onOpen } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "故事画布" }));

    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "story-progression:book-1",
        metadata: expect.objectContaining({ isStoryProgression: true, preferredView: "tree" }),
      }),
    );

    // 侧栏只保留两个轻量快捷入口，不再堆叠全部视图按钮与经典图谱折叠区
    expect(screen.queryByTestId("storyline-canvas-entries")).toBeNull();
    expect(screen.queryByRole("button", { name: "关系网络" })).toBeNull();
    expect(screen.queryByRole("button", { name: /独立全屏故事地图/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /大纲总览/ })).toBeNull();

    // 快捷入口跟随画布的四视图：故事树（默认主视觉）/ 推进 / 章节脉络
    fireEvent.click(screen.getByRole("button", { name: /打开故事树/ }));
    expect(onOpen).toHaveBeenLastCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ preferredView: "tree" }),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /打开推进/ }));
    expect(onOpen).toHaveBeenLastCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ preferredView: "board" }),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /打开章节脉络/ }));
    expect(onOpen).toHaveBeenLastCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ preferredView: "chronicle" }),
      }),
    );
  });

  it("当前语境切换到写作视图，进度账本就地渲染伏笔/冲突/债务，点看板才打开 tool 节点", async () => {
    const { onOpen, onSwitchView } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "当前语境" }));
    expect(onSwitchView).toHaveBeenCalledWith("write");

    fireEvent.click(screen.getByRole("button", { name: "进度账本" }));
    expect(screen.getByTestId("ledger-progress-table")).toBeTruthy();
    expect(screen.getByText("青铜戒指之谜")).toBeTruthy();
    expect(screen.getByText("通道授权争夺")).toBeTruthy();
    expect(screen.getByText("实验债")).toBeTruthy();
    expect(onOpen).not.toHaveBeenCalledWith(expect.objectContaining({ id: "tool:foreshadowing" }));

    fireEvent.click(screen.getByRole("button", { name: "打开看板" }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "tool:foreshadowing" }));
  });

  it("驾驶舱显示位置锚定条，并把目标章数渲染为进度", () => {
    renderPanel({ bookTargetChapters: 200 });
    expect(screen.getByTestId("storyline-cockpit")).toBeTruthy();
    expect(screen.getByTestId("storyline-position-bar")).toBeTruthy();
    expect(screen.getByText("📍 第 12 章")).toBeTruthy();
    expect(screen.getByText("/ 目标 200 章")).toBeTruthy();
    expect(screen.getByText("6%")).toBeTruthy();
  });

  it("NEXT 缺纲时点击把卷纲 seed 发给叙述者", () => {
    const onSendToNarrator = vi.fn();
    renderPanel({ outlineTreeNodes: [], onSendToNarrator });
    fireEvent.click(screen.getByTestId("storyline-next-outline-empty"));
    expect(onSendToNarrator).toHaveBeenCalledWith(expect.stringContaining("outline.volume"));
  });

  it("resolveNextAction 五级规则只返回最高优先级一条", () => {
    expect(resolveNextAction({ hasOutline: false, plannedCount: 3, pendingCount: 2, dueNowCount: 1 }).key).toBe("outline-empty");
    expect(resolveNextAction({ hasOutline: true, plannedCount: 2, pendingCount: 9, dueNowCount: 4 }).key).toBe("promote-outline");
    expect(resolveNextAction({ hasOutline: true, plannedCount: 0, pendingCount: 3, dueNowCount: 4 }).key).toBe("review-pending");
    expect(resolveNextAction({ hasOutline: true, plannedCount: 0, pendingCount: 0, staleCount: 2, dueNowCount: 4 }))
      .toMatchObject({ key: "resettle-stale", tab: "memory" });
    expect(resolveNextAction({ hasOutline: true, plannedCount: 0, pendingCount: 1, staleCount: 2, dueNowCount: 0 }).key).toBe("review-pending");
    expect(resolveNextAction({ hasOutline: true, plannedCount: 0, pendingCount: 0, dueNowCount: 2 }).key).toBe("foreshadow-due");
    expect(resolveNextAction({ hasOutline: true, plannedCount: 0, pendingCount: 0, dueNowCount: 0 }).key).toBe("all-set");
  });
});
