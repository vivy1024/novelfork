import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NarrativeMemoryPanel, NarrativeMemoryPanelShell } from "./NarrativeMemoryPanel";

// 本包没开 vitest globals，RTL 的自动 cleanup 不会注册；不清理会让多次 render
// 的 DOM 累积，按 role 定位时命中上一个用例留下的节点。
afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// 容器组件（NarrativeMemoryPanel）竞态回归测试
//
// 历史 bug：load() 与 search()/loadMoreSearch() 共用同一个 generationRef。
// 搜索提交会自增 generation，若随后面板刷新/审批触发 load，在途搜索回来时
// 守卫判定「已被取代」→ 结果丢弃，且 finally 里的条件清锁一并失效 ——
// setSearchLoading(false) 永远等不到，搜索区永久转圈；反向交错同理威胁 load
// 的 setLoading(false)。修复：链路各自持有 loadGenerationRef /
// searchGenerationRef，load 的 finally 无条件清锁。
// ---------------------------------------------------------------------------

const apiMock = vi.hoisted(() => ({
  fetchJsonImpl: undefined as undefined | ((path: string) => Promise<unknown>),
}));

vi.mock("@/hooks/use-api", () => ({
  // tolerate404 靠 instanceof ApiRequestError 判定，语义与真实类一致即可。
  ApiRequestError: class ApiRequestError extends Error {
    readonly code?: string;
    readonly status?: number;
    constructor(message: string, options?: { code?: string; status?: number }) {
      super(message);
      this.name = "ApiRequestError";
      this.code = options?.code;
      this.status = options?.status;
    }
  },
  fetchJson: (path: string) => {
    if (!apiMock.fetchJsonImpl) return Promise.reject(new Error(`unexpected fetchJson: ${path}`));
    return apiMock.fetchJsonImpl(path);
  },
}));

function deferred<T = unknown>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** load() 的六路并发取数：全部给最小空 payload；非 load 路由返回 null 由调用方处置。 */
function emptyLoadPayload(path: string): unknown | null {
  if (path.includes("/search?")) return null;
  if (path.includes("/diagnostics/latest")) return {};
  if (path.includes("/events/pending")) return { events: [] };
  if (path.includes("/stats")) return { stats: null };
  if (path.includes("/list?kind=event")) return { entries: [] };
  if (path.includes("/current")) return { items: [] };
  if (path.includes("/facts/by-entity")) return { groups: [] };
  return null;
}

function installRouter(overrides: (path: string) => Promise<unknown> | undefined) {
  apiMock.fetchJsonImpl = (path) => {
    const overridden = overrides(path);
    if (overridden) return overridden;
    const payload = emptyLoadPayload(path);
    if (payload === null) return Promise.reject(new Error(`unexpected fetchJson: ${path}`));
    return Promise.resolve(payload);
  };
}

describe("NarrativeMemoryPanelShell", () => {
  it("exposes author-first story status and history without diagnosis or market tools", () => {
    const html = renderToStaticMarkup(
      <NarrativeMemoryPanelShell
        bookId="book-1"
        diagnostics={null}
        empty
        error={null}
        events={[]}
        onRefresh={() => undefined}
      />,
    );

    // IA 收敛后为单页平铺：故事状态 / 关系矩阵 / 结算历史同屏，不再有主 tab。
    for (const label of ["当前故事状态", "关系矩阵", "结算历史"]) {
      expect(html).toContain(label);
    }
    // 旧的三主 tab 已删除：发展历程与伏笔账本收敛为外部权威入口的跳转按钮。
    expect(html).not.toContain("📋 大纲");
    expect(html).not.toContain("📜 发展历程");
    expect(html).not.toContain("📌 伏笔账本");
    // 未提供跳转回调时不渲染跳转区。
    expect(html).not.toContain("narrative-memory-jump-links");

    // 伏笔已收敛到唯一入口「伏笔看板」（经纬为源），记忆面板不再提供伏笔视图。
    expect(html).not.toContain("伏笔板");
    expect(html).not.toContain("伏笔网络");

    expect(html).toContain("当前故事状态");
    expect(html).toContain("自动结算");
    expect(html).not.toContain("质量监控");
    expect(html).not.toContain("市场雷达");
    expect(html).not.toContain("选段写作");
    // 诊断默认不作为主内容暴露工程字段
    expect(html).not.toContain("Wave 摘要");
    expect(html).not.toContain("存储概览");
  });

  it("renders story status, relationship matrix and settlement history flat on one page", () => {
    render(
      <NarrativeMemoryPanelShell
        bookId="book-1"
        diagnostics={null}
        empty={false}
        error={null}
        events={[]}
        stateFacts={[
          { kind: "fact", id: "f-state", title: "韩立 状态 谨慎", category: "character_state", subject: "韩立", predicate: "状态", object: "谨慎" },
          { kind: "fact", id: "f-hook", title: "伏笔：神秘石符", category: "hook", evidenceText: "石符泛起微光" },
        ]}
        entityGroups={[{
          entity: "韩立",
          facts: [{ id: "f-state", subject: "韩立", predicate: "状态", object: "谨慎", category: "character_state" }],
        }]}
        historyEvents={[{ kind: "event", id: "applied-1", title: "韩立 抵达 药园", status: "applied", chapterNumber: 7, category: "location_changed" }]}
        onRefresh={() => undefined}
      />,
    );

    // 单页平铺：三类内容同屏可见，无需任何 tab 切换。
    expect(screen.getByText("当前故事状态")).toBeTruthy();
    expect(screen.getByText("关系矩阵")).toBeTruthy();
    expect(screen.getByTestId("narrative-memory-history")).toBeTruthy();
    // 同一条结算同时出现在「最近结算」摘要与下方完整历史里。
    expect(screen.getAllByText("韩立 抵达 药园").length).toBeGreaterThanOrEqual(2);
  });

  it("exposes jump links to the authoritative 发展历程/伏笔账本 entries when callbacks are provided", async () => {
    const onOpenDevelopmentTimeline = vi.fn();
    const onOpenForeshadowingLedger = vi.fn();
    const { rerender } = render(
      <NarrativeMemoryPanelShell
        bookId="book-1"
        diagnostics={null}
        empty={false}
        error={null}
        events={[]}
        onOpenDevelopmentTimeline={onOpenDevelopmentTimeline}
        onOpenForeshadowingLedger={onOpenForeshadowingLedger}
        onRefresh={() => undefined}
      />,
    );

    // 顶部只放轻量跳转，不再内嵌重复内容。
    const jumpArea = screen.getByTestId("narrative-memory-jump-links");
    fireEvent.click(within(jumpArea).getByRole("button", { name: /发展历程/u }));
    expect(onOpenDevelopmentTimeline).toHaveBeenCalledTimes(1);
    fireEvent.click(within(jumpArea).getByRole("button", { name: /伏笔账本/u }));
    expect(onOpenForeshadowingLedger).toHaveBeenCalledTimes(1);

    // 面板内不再渲染发展历程工作区与伏笔证据列表。
    rerender(
      <NarrativeMemoryPanelShell
        bookId="book-1"
        diagnostics={null}
        empty={false}
        error={null}
        events={[]}
        stateFacts={[{ kind: "fact", id: "f-hook", title: "伏笔：神秘石符", category: "hook", evidenceText: "石符泛起微光" }]}
        onRefresh={() => undefined}
      />,
    );
    // 未提供回调时跳转区整体不渲染，面板内也不再有发展历程/伏笔证据内容。
    expect(screen.queryByTestId("narrative-memory-jump-links")).toBeNull();
    expect(screen.queryByTestId("development-timeline-view")).toBeNull();
    expect(screen.queryByTestId("narrative-memory-hook-ledger")).toBeNull();
  });

  it("shows story status, settlement history, and pending review actions", () => {
    const html = renderToStaticMarkup(
      <NarrativeMemoryPanelShell
        bookId="book-1"
        diagnostics={{
          purpose: "write_chapter",
          chapterNumber: 12,
          totalMs: 120,
          totalEstimatedTokens: 800,
          channels: [{ channel: "state", status: "ok", latencyMs: 10, candidateCount: 3, returnedCount: 2, estimatedTokens: 100 }],
          warnings: ["budget tight"],
        }}
        stats={{ total: 3, byKind: { fact: 2, event: 1 }, pendingEvents: 1 }}
        empty={false}
        error={null}
        events={[{ id: "event-1", eventType: "hook_planted", entity: "小瓶", risk: "high", confidence: 0.9, chapterNumber: 8, evidence: "正文证据" }]}
        historyEvents={[{ kind: "event", id: "applied-1", title: "韩立 抵达 药园", status: "applied", chapterNumber: 7, category: "location_changed" }]}
        stateFacts={[{ kind: "fact", id: "fact-1", title: "韩立 状态 谨慎", category: "character_state", subject: "韩立", predicate: "状态", object: "谨慎" }]}
        onApprove={() => undefined}
        onReject={() => undefined}
        onRefresh={() => undefined}
      />,
    );

    expect(html).toContain("当前故事状态");
    expect(html).toContain("作者可纠错");
    expect(html).toContain("韩立 状态 谨慎");
    expect(html).toContain("角色状态");
    expect(html).toContain("最近结算");
    expect(html).toContain("韩立 抵达 药园");
    expect(html).toContain("改后批准");
    expect(html).toContain("拒绝");
    expect(html).toContain("正文证据");
    expect(html).toContain("章后默认自动结算");
    expect(html).toContain("高级：召回诊断");
    // 诊断默认折叠，不直接铺开通道明细
    expect(html).not.toContain("检索 3");
  });

  /**
   * 叙事线审批台账必须真的可达。
   *
   * 服务端从 H-2 起就记录批准/驳回，但界面上一直没有入口 —— 能力存在却看不到。
   * 这里走真实的视图切换，而不是直接断言隐藏 DOM。
   */
  it("opens an entity detail drawer from the story status board", () => {
    const onOpenEntityDetail = vi.fn();
    render(
      <NarrativeMemoryPanelShell
        bookId="book-1"
        diagnostics={null}
        empty={false}
        error={null}
        events={[]}
        stateFacts={[{ kind: "fact", id: "fact-1", subject: "韩立", predicate: "境界", object: "筑基期", category: "character_state" }]}
        entityGroups={[{
          entity: "韩立",
          facts: [{ id: "fact-1", subject: "韩立", predicate: "境界", object: "筑基期", category: "character_state" }],
        }]}
        onOpenEntityDetail={onOpenEntityDetail}
        onRefresh={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "韩立" }));
    expect(onOpenEntityDetail).toHaveBeenCalledWith("韩立");
  });

  /**
   * 待审队列批量操作：置信度筛选 + 多选 + 批量批准/丢弃。
   */
  it("filters pending events by confidence and exposes bulk actions for the selection", async () => {
    const onBulkApprove = vi.fn(async () => undefined);
    const onBulkDelete = vi.fn(async () => undefined);
    const events: Array<Parameters<typeof NarrativeMemoryPanelShell>[0]["events"][number]> = [
      { id: "e-low", eventType: "location_changed", entity: "韩立", predicate: "抵达", object: "药园", confidence: 0.5, risk: "medium", chapterNumber: 12 },
      { id: "e-mid", eventType: "character_state_changed", entity: "韩立", predicate: "状态", object: "谨慎", confidence: 0.7, risk: "medium", chapterNumber: 12 },
      { id: "e-high", eventType: "location_changed", entity: "韩立", predicate: "离开", object: "药园", confidence: 0.9, risk: "low", chapterNumber: 12 },
    ];
    render(
      <NarrativeMemoryPanelShell
        bookId="book-1"
        diagnostics={null}
        empty={false}
        error={null}
        events={events}
        onBulkApprove={onBulkApprove}
        onBulkDelete={onBulkDelete}
        onRefresh={() => undefined}
      />,
    );

    // 置信度筛选：只留下低置信。
    fireEvent.click(screen.getByRole("button", { name: /低置信/u }));
    expect(screen.queryByText(/谨慎/u)).toBeNull();
    expect(screen.getByText(/药园/u, { selector: "div" }).closest("div")).toBeTruthy();
    const checkbox = screen.getByRole("checkbox", { name: /选择事件 韩立/u });
    expect(checkbox).toBeTruthy();

    // 多选 + 批量批准。
    fireEvent.click(checkbox);
    const approveButton = await screen.findByRole("button", { name: "批量批准" });
    fireEvent.click(approveButton);
    expect(onBulkApprove).toHaveBeenCalledWith(["e-low"]);
    // 批准后选择自动清空，批量操作栏随之消失（等待异步完成）。
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "批量丢弃" })).toBeNull();
    });

    // 切回全部再选两条 → 批量丢弃（操作栏重新出现，bulkLoading 已复位）。
    fireEvent.click(screen.getByRole("button", { name: "全部" }));
    const allCheckboxes = screen.getAllByRole("checkbox", { name: /选择事件/u });
    fireEvent.click(allCheckboxes[0]!);
    fireEvent.click(allCheckboxes[1]!);
    fireEvent.click(await screen.findByRole("button", { name: "批量丢弃" }));
    expect(onBulkDelete).toHaveBeenCalledWith(expect.arrayContaining(["e-low", "e-mid"]));
  });

  it("selects all filtered events through the select-all toggle", () => {
    render(
      <NarrativeMemoryPanelShell
        bookId="book-1"
        diagnostics={null}
        empty={false}
        error={null}
        events={[
          { id: "e-1", eventType: "location_changed", entity: "韩立", confidence: 0.8, risk: "low", chapterNumber: 12 },
          { id: "e-2", eventType: "location_changed", entity: "厉飞雨", confidence: 0.8, risk: "low", chapterNumber: 12 },
        ]}
        onBulkApprove={vi.fn(async () => undefined)}
        onRefresh={() => undefined}
      />,
    );

    const selectAll = screen.getByRole("checkbox", { name: "全选当前筛选下的待审事件" });
    fireEvent.click(selectAll);
    expect(screen.getByText(/已选 2 条/u)).toBeTruthy();

    fireEvent.click(selectAll);
    expect(screen.queryByText(/已选/u)).toBeNull();
  });

  /**
   * 真分页：结算历史与审批台账不再被 slice(0, 40) 截断，
   * 「加载更多」把下一页追加进列表。
   */
  it("paginates settlement history and line approvals with load-more", () => {
    const onLoadMoreHistory = vi.fn();
    const onLoadMoreApprovals = vi.fn();
    render(
      <NarrativeMemoryPanelShell
        bookId="book-1"
        diagnostics={null}
        empty={false}
        error={null}
        events={[]}
        historyEvents={[
          { kind: "event", id: "h-1", title: "韩立 抵达 药园", status: "applied", chapterNumber: 12 },
        ]}
        lineApprovals={[
          { previewId: "p-1", summary: "添加节点：青铜铃", decision: "approved" as const, approvedAt: "2026-08-01T02:00:00.000Z" },
        ]}
        historyHasMore
        onLoadMoreHistory={onLoadMoreHistory}
        approvalsHasMore
        onLoadMoreApprovals={onLoadMoreApprovals}
        onRefresh={() => undefined}
      />,
    );

    // 平铺后结算历史与审批台账常驻可见，直接点「加载更多」。
    fireEvent.click(screen.getByRole("button", { name: "加载更多历史" }));
    expect(onLoadMoreHistory).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "加载更多审批" }));
    expect(onLoadMoreApprovals).toHaveBeenCalledTimes(1);
  });

  it("reaches the narrative line approval ledger from the settlement history view", () => {
    render(
      <NarrativeMemoryPanelShell
        bookId="book-1"
        diagnostics={null}
        empty={false}
        error={null}
        events={[]}
        lineApprovals={[
          {
            previewId: "narrative-preview:book-1:1",
            approvedAt: "2026-08-01T02:00:00.000Z",
            summary: "添加节点：青铜铃异响",
            decision: "approved",
            targetNodeIds: ["node-hook"],
          },
          {
            previewId: "narrative-preview:book-1:2",
            approvedAt: "2026-08-01T03:00:00.000Z",
            summary: "删除节点：旧支线",
            decision: "rejected",
            reason: "与主线冲突",
            removedNodeIds: ["node-old"],
          },
        ]}
        onRefresh={() => undefined}
      />,
    );

    // 平铺结构：台账与结算历史同屏常驻，无需切换视图。
    const ledger = screen.getByTestId("narrative-line-approvals");
    expect(ledger).toBeTruthy();
    expect(ledger.textContent).toContain("添加节点：青铜铃异响");
    expect(ledger.textContent).toContain("已批准");
    // 驳回同样留痕，并带上作者填的理由。
    expect(ledger.textContent).toContain("删除节点：旧支线");
    expect(ledger.textContent).toContain("已驳回");
    expect(ledger.textContent).toContain("与主线冲突");
    expect(ledger.textContent).toContain("删除节点 1");
  });

  it("explains the empty approval ledger instead of hiding the section", () => {
    render(
      <NarrativeMemoryPanelShell
        bookId="book-1"
        diagnostics={null}
        empty={false}
        error={null}
        events={[]}
        onRefresh={() => undefined}
      />,
    );

    // 平铺结构：空台账直接可见并给出解释文案。
    expect(screen.getByTestId("narrative-line-approvals").textContent).toContain("在叙事线视图增删节点后会出现");
  });
});

describe("NarrativeMemoryPanel（容器）generation 竞态", () => {
  it("搜索在途时插入整面板 load（刷新）不再废掉搜索：共用 generation 时此场景搜索区永久转圈", async () => {
    const searchGate = deferred();
    installRouter((path) => {
      if (path.includes("/search?")) return searchGate.promise;
      return undefined;
    });

    render(<NarrativeMemoryPanel bookId="book-1" />);
    // 初始 load 完成，面板出现在眼前（搜索框与刷新按钮都在）。
    await screen.findByText("章后事实与故事状态");

    const input = screen.getByPlaceholderText("搜索角色、关系、伏笔、证据...");
    fireEvent.change(input, { target: { value: "韩立" } });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    // 搜索已提交、响应在途。
    await screen.findByText("搜索结果");

    // 搜索还没回来，作者点了刷新 → 一次完整的 load 插进来并跑完。
    fireEvent.click(screen.getByTitle("刷新"));
    await screen.findByText("章后事实与故事状态");

    // 搜索响应此刻才到。旧实现里它的 generation 已被 load 推高：
    // 结果被守卫丢弃、finally 里的 setSearchLoading(false) 同样被守卫挡住 ——
    // 「N 条」计数徽章永远不会出现。分离 ref 后，load 不再搅动搜索链路。
    searchGate.resolve({ entries: [{ kind: "event", id: "s-1", title: "韩立 抵达 药园" }] });
    await screen.findByText("1 条");
    expect(screen.getByText("韩立 抵达 药园")).toBeTruthy();
  });

  it("load 结束无条件退出「加载中」：bookId 切换后迟到的旧 load 不覆盖新面板、也不留下转圈", async () => {
    const book1Gate = deferred();
    installRouter((path) => {
      // book-1 的整轮 load 挂起，book-2 立即放行。
      if (path.includes("/books/book-1/")) return book1Gate.promise;
      return undefined;
    });

    const { rerender } = render(<NarrativeMemoryPanel bookId="book-1" />);
    // book-1 的 load 在途：整屏加载。
    expect(await screen.findByText("加载故事状态...")).toBeTruthy();

    rerender(<NarrativeMemoryPanel bookId="book-2" />);
    // book-2 的 load 完成 → 新一代面板出现、加载屏消失。
    await screen.findByText("章后事实与故事状态");

    // 旧 load 这才回来：守卫（loadGenerationRef）丢弃其结果；finally 无条件
    // setLoading(false) —— 即使守卫判定「已被取代」，清锁也不会被跳过。
    book1Gate.resolve({});
    await waitFor(() => {
      expect(screen.queryByText("加载故事状态...")).toBeNull();
    });
    expect(screen.getByText("章后事实与故事状态")).toBeTruthy();
  });

  it("搜索链路内部仍互相取消：连续搜索时迟到的上一代响应不回盖最新结果", async () => {
    const firstGate = deferred();
    const secondGate = deferred();
    let searchCalls = 0;
    installRouter((path) => {
      if (path.includes("/search?")) {
        searchCalls += 1;
        return searchCalls === 1 ? firstGate.promise : secondGate.promise;
      }
      return undefined;
    });

    render(<NarrativeMemoryPanel bookId="book-1" />);
    const input = await screen.findByPlaceholderText("搜索角色、关系、伏笔、证据...");

    fireEvent.change(input, { target: { value: "韩立" } });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    fireEvent.change(input, { target: { value: "南宫" } });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));

    // 新搜索先回来：展示它的结果。
    secondGate.resolve({ entries: [{ kind: "event", id: "s-2", title: "南宫婉 赠丹" }] });
    await screen.findByText("南宫婉 赠丹");

    // 旧搜索最后才回来：守卫丢弃，新鲜结果不被回盖，加载态也已复位。
    firstGate.resolve({ entries: [{ kind: "event", id: "s-1", title: "韩立 抵达 药园" }] });
    await waitFor(() => {
      expect(screen.getByText("南宫婉 赠丹")).toBeTruthy();
      expect(screen.queryByText("韩立 抵达 药园")).toBeNull();
    });
    expect(screen.getByText("1 条")).toBeTruthy();
  });
});
