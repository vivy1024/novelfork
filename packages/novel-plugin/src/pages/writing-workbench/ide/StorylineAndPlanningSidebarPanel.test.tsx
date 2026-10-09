import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { orderOutlineTree, pruneStoryChapterTree, resolveNextAction, StorylineAndPlanningSidebarPanel } from "./StorylineAndPlanningSidebarPanel";
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
    if (path?.endsWith("/settlement-freshness") && path.includes("/books/book-quiet/")) {
      return { data: { chapters: [], staleChapters: [] }, loading: false, error: null, refetch: vi.fn(async () => undefined) };
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

// 下一章计划：侧栏只引用画布「下一章」页的同一份计划；这里给一份固定计划。
const planHarness = vi.hoisted(() => ({
  plan: null as import("../next-chapter-plan").NextChapterPlan | null,
  reload: vi.fn(),
  calls: [] as Array<{ bookId: string; currentChapter: number | undefined }>,
}));

vi.mock("../use-next-chapter-plan", () => ({
  useNextChapterPlan: (bookId: string, currentChapter: number | undefined) => {
    planHarness.calls.push({ bookId, currentChapter });
    return { state: { status: "loading" }, reload: planHarness.reload, plan: planHarness.plan };
  },
}));

function fixturePlan(): import("../next-chapter-plan").NextChapterPlan {
  const debt = { id: "d1", entryId: "d1", title: "青铜戒指之谜", status: "planted", plantedChapter: 1, chaptersPending: 13, urgency: "overdue" as const, reason: "已悬置 13 章" };
  return {
    nextChapter: 13,
    focus: { goal: "让主线退一档" },
    hasStorylines: true,
    suggestions: [{ id: "focus:main", storylineId: "main", laneKind: "main", laneTitle: "夺回师门", reason: "focus-named", reasonText: "焦点点名" }],
    hookPlan: [{ debt, pendingChapters: 13, headline: "已悬置 13 章" }],
    overdue: [debt],
    watch: [],
    healthy: [],
    narrativeSummary: "共 1 条剧情线 · 0 个场景 · 1 条伏笔",
  };
}

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
  planHarness.plan = null;
  planHarness.calls = [];
});

describe("StorylineAndPlanningSidebarPanel 故事推进入口（IA 收敛后）", () => {
  it("默认展示章节与大纲 Tab，并点击叶子复用 onOpen", () => {
    const { onOpen, chapter, outline } = renderPanel();

    expect(screen.getByRole("button", { name: "章节与大纲" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "章后事实" })).toBeTruthy();
    // 只剩两个子页签：「故事画布」改成顶部按钮，「进度账本」与画布伏笔账本重复，已下线
    expect(screen.queryByRole("button", { name: "故事画布" })).toBeNull();
    expect(screen.queryByRole("button", { name: "进度账本" })).toBeNull();
    expect(screen.getByRole("button", { name: "打开故事画布" })).toBeTruthy();
    // 「当前语境」只是切到写作视图，与活动栏「写作」重复，已下线
    expect(screen.queryByText("当前语境")).toBeNull();
    // 计数是真实章数与纲条目数，不是顶层节点数
    expect(screen.getByText("章节 1 · 大纲 1")).toBeTruthy();
    expect(screen.getByText("第 12 章")).toBeTruthy();
    expect(screen.getByText("第一卷：起点")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "第 12 章" }));
    fireEvent.click(screen.getByRole("button", { name: "第一卷：起点" }));
    expect(onOpen).toHaveBeenCalledWith(chapter);
    expect(onOpen).toHaveBeenCalledWith(outline);
  });

  it("页头模具：标题、侧栏自己的用途句与当前状态；「打开故事画布」留在页头右侧", () => {
    renderPanel();

    expect(screen.getByTestId("sidebar-page-head-title").textContent).toBe("故事推进");
    expect(screen.getByTestId("sidebar-page-head-sub").textContent).toContain("盯住位置与下一步");
    expect(screen.getByTestId("sidebar-page-head-sub").textContent).toContain("第 12 章");
    expect(screen.getByRole("button", { name: "打开故事画布" })).toBeTruthy();
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
    // 卷目录默认展开：打开即见章节，不用逐个点开
    expect(screen.getByRole("button", { name: "卷01" })).toBeTruthy();
    expect(screen.queryByText("0001_雨夜.md")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "第 1 章 雨夜" }));
    expect(onOpen).toHaveBeenCalledWith(chapterFile);
  });

  it("章节树只放章节：chapters/ 下的非章节笔记与空卷目录不进树", () => {
    const chapterFile: WorkbenchResourceNode = {
      id: "file:chapters/卷01/0001_雨夜.md",
      kind: "chapter",
      title: "0001_雨夜.md",
      capabilities,
      metadata: { filePath: "chapters/卷01/0001_雨夜.md", isFile: true, chapterNumber: 1 },
    };
    // 资源树把 chapters/ 下所有 .md 都标成 chapter；认不出章号的是作者笔记，不是章节
    const note: WorkbenchResourceNode = {
      id: "file:chapters/作者说清单.md",
      kind: "chapter",
      title: "作者说清单.md",
      capabilities,
      metadata: { filePath: "chapters/作者说清单.md", isFile: true },
    };
    const emptyVolume: WorkbenchResourceNode = { id: "file-dir:chapters/卷03", kind: "group", title: "卷03", capabilities, metadata: { isDirectory: true }, children: [] };
    const root: WorkbenchResourceNode = {
      id: "file-dir:chapters",
      kind: "group",
      title: "chapters",
      capabilities,
      metadata: { filePath: "chapters", isDirectory: true },
      children: [
        { id: "file-dir:chapters/卷01", kind: "group", title: "卷01", capabilities, metadata: { isDirectory: true }, children: [chapterFile] },
        emptyVolume,
        note,
      ],
    };
    const pruned = pruneStoryChapterTree([root]);
    expect(pruned[0]!.children!.map((child) => child.title)).toEqual(["卷01"]);
    expect(pruned[0]!.children![0]!.children).toEqual([chapterFile]);
    expect(pruneStoryChapterTree([note, emptyVolume])).toEqual([]);
  });

  it("大纲按推进顺序：卷纲在前并展开成按章节区间排的各卷，细纲按章号；卷纲不给提拔", () => {
    const onOpen = vi.fn();
    const onAction = vi.fn();
    const volumeOutline: WorkbenchResourceNode = {
      id: "jingwei-entry:vol",
      kind: "jingwei-entry",
      title: "卷纲",
      capabilities,
      metadata: {
        category: "outline",
        fields: {
          volumes: [
            { id: "v2", title: "第二卷 北港", chapterRange: { from: 5, to: 9 } },
            { id: "v1", title: "第一卷 雨城", chapterRange: { from: 1, to: 4 } },
          ],
        },
      },
    };
    const chapter8 = { ...node("jingwei-entry:c8", "第8章 细纲：雾钟敲响", "jingwei-entry"), metadata: { category: "outline", fields: {} } };
    const chapter3 = { ...node("jingwei-entry:c3", "第 3 章 细纲：灰衣人", "jingwei-entry"), metadata: { category: "outline", fields: {} } };
    const group = node("jingwei-cat:outline", "卷纲/大纲 (3)", "group", [chapter8, volumeOutline, chapter3]);

    const ordered = orderOutlineTree([group]);
    expect(ordered[0]!.children!.map((child) => child.title)).toEqual(["卷纲", "第 3 章 细纲：灰衣人", "第8章 细纲：雾钟敲响"]);
    expect(ordered[0]!.children![0]!.children!.map((child) => child.title)).toEqual([
      "第一卷 雨城（第 1–4 章）",
      "第二卷 北港（第 5–9 章）",
    ]);

    render(
      <StorylineAndPlanningSidebarPanel
        bookId="book-1"
        chapterTreeNodes={[]}
        outlineTreeNodes={[group]}
        selectedNodeId={null}
        onOpen={onOpen}
        onAction={onAction}
      />,
    );
    expect(screen.getByText("章节 0 · 大纲 3")).toBeTruthy();
    // 两条单章细纲有提拔按钮，卷纲容器没有
    expect(screen.getAllByTitle("将大纲提拔至手稿章节")).toHaveLength(2);
    // 点某一卷，打开的是卷纲条目本身
    fireEvent.click(screen.getByRole("button", { name: "第一卷 雨城（第 1–4 章）" }));
    expect(onOpen).toHaveBeenCalledWith(volumeOutline);
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

  it("顶部「打开故事画布」按钮在中央打开画布并落在「下一章」；侧栏不再有画布说明页与跳转按钮", () => {
    const { onOpen } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "打开故事画布" }));

    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "story-progression:book-1",
        metadata: expect.objectContaining({ isStoryProgression: true, preferredView: "next" }),
      }),
    );
    // 点开只剩一段说明文字的「故事画布」子页签已下线
    expect(screen.queryByTestId("storyline-canvas-note")).toBeNull();
    expect(screen.queryByTestId("storyline-canvas-entries")).toBeNull();
    expect(screen.queryByRole("button", { name: "关系网络" })).toBeNull();
    expect(screen.queryByRole("button", { name: /独立全屏故事地图/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /大纲总览/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /打开故事树/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /打开推进/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /打开章节脉络/ })).toBeNull();
  });

  it("侧栏不再渲染伏笔 / 冲突 / 债务进度表（伏笔只在画布「下一章」的伏笔账本）", () => {
    const { onOpen } = renderPanel();
    expect(screen.queryByTestId("ledger-progress-table")).toBeNull();
    expect(screen.queryByText("通道授权争夺")).toBeNull();
    expect(screen.queryByText("实验债")).toBeNull();
    expect(onOpen).not.toHaveBeenCalledWith(expect.objectContaining({ id: "tool:foreshadowing" }));
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

  it("NEXT 缺纲而没有叙述者通道时，卡内明说而不是静默吞掉点击", () => {
    const chapter = { ...node("chapter:12", "第 12 章", "chapter"), metadata: { chapterNumber: 12 } };
    render(
      <StorylineAndPlanningSidebarPanel
        bookId="book-quiet"
        chapterTreeNodes={[node("chapters", "章节", "group", [chapter])]}
        outlineTreeNodes={[]}
        selectedNodeId={null}
        onOpen={vi.fn()}
      />,
    );
    const note = screen.getByTestId("storyline-next-no-narrator");
    expect(note.textContent).toContain("叙述者");
    // 点击不报错也不偷偷发消息，提示仍在
    fireEvent.click(screen.getByTestId("storyline-next-outline-empty"));
    expect(screen.getByTestId("storyline-next-no-narrator")).toBeTruthy();
  });

  it("接上叙述者通道后卷纲 seed 照常发送，不出现提示", () => {
    const onSendToNarrator = vi.fn();
    renderPanel({ outlineTreeNodes: [], onSendToNarrator });
    expect(screen.queryByTestId("storyline-next-no-narrator")).toBeNull();
  });

  it("resolveNextAction 维护提醒优先，只返回最高优先级一条；都没有时给下一章建议", () => {
    expect(resolveNextAction({ hasOutline: false, plannedCount: 3, pendingCount: 2 }).key).toBe("outline-empty");
    expect(resolveNextAction({ hasOutline: true, plannedCount: 2, pendingCount: 9 }).key).toBe("promote-outline");
    expect(resolveNextAction({ hasOutline: true, plannedCount: 0, pendingCount: 3 }).key).toBe("review-pending");
    expect(resolveNextAction({ hasOutline: true, plannedCount: 0, pendingCount: 0, staleCount: 2 }))
      .toMatchObject({ key: "resettle-stale", tab: "memory" });
    expect(resolveNextAction({ hasOutline: true, plannedCount: 0, pendingCount: 1, staleCount: 2 }).key).toBe("review-pending");
    // 下一章建议原样引用计划那一句，不另算伏笔到期
    expect(resolveNextAction({ hasOutline: true, plannedCount: 0, pendingCount: 0, nextChapterSuggestion: "下一章建议：第 13 章 · 主线「夺回师门」（焦点点名）" }))
      .toEqual({ key: "next-chapter", label: "下一章建议：第 13 章 · 主线「夺回师门」（焦点点名）" });
    // 计划还没读到：引导去画布看，不自造建议
    expect(resolveNextAction({ hasOutline: true, plannedCount: 0, pendingCount: 0 }))
      .toEqual({ key: "next-chapter", label: "打开故事画布，看下一章写什么" });
  });

  it("NEXT 卡的下一章建议与画布「下一章」页同一句；点击打开画布并落在「下一章」", async () => {
    const { describeNextChapterSuggestion } = await import("../next-chapter-plan");
    planHarness.plan = fixturePlan();
    const onOpen = vi.fn();
    const chapter = { ...node("chapter:12", "第 12 章", "chapter"), metadata: { chapterNumber: 12 } };
    // book-quiet：没有待审、没有记忆过期，维护提醒都不命中，才轮到下一章建议
    render(
      <StorylineAndPlanningSidebarPanel
        bookId="book-quiet"
        chapterTreeNodes={[node("chapters", "章节", "group", [chapter])]}
        outlineTreeNodes={[node("outline:1", "第一卷：起点", "jingwei-entry")]}
        selectedNodeId={null}
        onOpen={onOpen}
      />,
    );

    // 侧栏把真实当前章交给同一个计划 hook
    expect(planHarness.calls.at(-1)).toEqual({ bookId: "book-quiet", currentChapter: 12 });
    const card = screen.getByTestId("storyline-next-next-chapter");
    expect(card.textContent).toBe(describeNextChapterSuggestion(fixturePlan()));
    expect(card.textContent).toContain("顺手回收「青铜戒指之谜」");
    // 旧的侧栏伏笔口径（目标章 ≤ 当前章 + 1）与「一切就绪」占位都已下线
    expect(screen.queryByTestId("storyline-next-foreshadow-due")).toBeNull();
    expect(screen.queryByTestId("storyline-next-all-set")).toBeNull();

    fireEvent.click(card);
    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "story-progression:book-quiet",
        metadata: expect.objectContaining({ isStoryProgression: true, preferredView: "next" }),
      }),
    );
  });
});
