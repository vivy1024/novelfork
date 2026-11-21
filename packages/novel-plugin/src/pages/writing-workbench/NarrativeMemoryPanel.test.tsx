import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NarrativeMemoryPanel, NarrativeMemoryPanelShell, classifyPendingEventSemantic } from "./NarrativeMemoryPanel";

it("将真实结算事件 world_fact_introduced 归入世界设定而非关键事件", () => {
  expect(classifyPendingEventSemantic({ eventType: "world_fact_introduced", category: "event" })).toBe("world_fact");
});

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
  fetchJsonImpl: undefined as undefined | ((path: string, init?: RequestInit) => Promise<unknown>),
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
  fetchJson: (path: string, init?: RequestInit) => {
    if (!apiMock.fetchJsonImpl) return Promise.reject(new Error(`unexpected fetchJson: ${path}`));
    return apiMock.fetchJsonImpl(path, init);
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

    // IA 收敛后为单页平铺：故事状态 / 关系矩阵 / 伏笔事实 / 结算历史同屏，不再有主 tab。
    for (const label of ["当前故事状态", "关系矩阵", "伏笔事实", "结算历史"]) {
      expect(html).toContain(label);
    }
    // 旧的三主 tab 已删除：发展历程收敛为外部权威入口的跳转按钮。
    expect(html).not.toContain("📋 大纲");
    expect(html).not.toContain("📜 发展历程");
    // 未提供跳转回调时不渲染跳转区。
    expect(html).not.toContain("narrative-memory-jump-links");

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

  it("renders story status, relationship matrix, hook facts, and settlement history flat on one page", () => {
    render(
      <NarrativeMemoryPanelShell
        bookId="book-1"
        diagnostics={null}
        empty={false}
        error={null}
        events={[]}
        stateFacts={[
          { kind: "fact", id: "f-state", title: "韩立 状态 谨慎", category: "character_state", subject: "韩立", predicate: "状态", object: "谨慎" },
          { kind: "fact", id: "f-hook", title: "伏笔：神秘石符", category: "hook", subject: "韩立", predicate: "持有", object: "神秘石符", evidenceText: "石符泛起微光" },
        ]}
        entityGroups={[{
          entity: "韩立",
          facts: [
            { id: "f-state", subject: "韩立", predicate: "状态", object: "谨慎", category: "character_state", sourceChapter: 3, evidenceText: "韩立压住呼吸，神色谨慎。", confidence: 0.91 },
            { id: "f-hook", subject: "韩立", predicate: "持有", object: "神秘石符", category: "hook" },
          ],
        }]}
        historyEvents={[{ kind: "event", id: "applied-1", title: "韩立 抵达 药园", status: "applied", chapterNumber: 7, category: "location_changed" }]}
        onRefresh={() => undefined}
      />,
    );

    // 单页平铺：内容同屏可见，无需任何 tab 切换。
    expect(screen.getByText("当前故事状态")).toBeTruthy();
    expect(screen.getByText("关系矩阵")).toBeTruthy();
    expect(screen.getByTestId("narrative-memory-hook-section")).toBeTruthy();
    expect(screen.getByTestId("narrative-memory-history")).toBeTruthy();
    // 同一条结算同时出现在「最近结算」摘要与下方完整历史里。
    expect(screen.getAllByText("韩立 抵达 药园").length).toBeGreaterThanOrEqual(2);
  });

  it("shows source chapter, evidence, confidence and jumps to the source chapter", () => {
    const onOpenChapter = vi.fn();
    render(
      <NarrativeMemoryPanelShell
        bookId="book-1"
        diagnostics={null}
        empty={false}
        error={null}
        stateFacts={[{
          kind: "fact",
          id: "f-state",
          title: "韩立 状态 谨慎",
          category: "character_state",
          subject: "韩立",
          predicate: "状态",
          object: "谨慎",
          sourceChapter: 3,
          evidenceText: "韩立压住呼吸，神色谨慎。",
          confidence: 0.91,
        }]}
        events={[{
          id: "pending-1",
          eventType: "character_state_changed",
          entity: "韩立",
          confidence: 0.42,
          chapterNumber: 12,
          evidence: "韩立把小瓶藏进袖中。",
          risk: "high",
        }]}
        entityGroups={[{
          entity: "韩立",
          facts: [{
            id: "f-state",
            subject: "韩立",
            predicate: "状态",
            object: "谨慎",
            category: "character_state",
            sourceChapter: 3,
            evidenceText: "韩立压住呼吸，神色谨慎。",
            confidence: 0.91,
          }],
        }]}
        historyEvents={[{
          kind: "event",
          id: "applied-1",
          title: "韩立 抵达 药园",
          status: "applied",
          chapterNumber: 7,
          category: "location_changed",
          evidenceText: "韩立走进药园。",
          confidence: 0.88,
        }]}
        onOpenChapter={onOpenChapter}
        onRefresh={() => undefined}
      />,
    );

    expect(screen.getByTestId("memory-fact-evidence-f-state")).toBeTruthy();
    expect(screen.getByText("韩立压住呼吸，神色谨慎。")).toBeTruthy();
    expect(screen.getByText("置信 0.91")).toBeTruthy();
    fireEvent.click(screen.getByTitle("打开来源第 3 章"));
    expect(onOpenChapter).toHaveBeenCalledWith(3);
    fireEvent.click(screen.getByTitle("打开来源第 12 章"));
    expect(onOpenChapter).toHaveBeenCalledWith(12);
    // 最近结算摘要与完整历史各展示一次证据片段。
    expect(screen.getAllByText("韩立走进药园。").length).toBeGreaterThanOrEqual(2);
  });

  it("shows closed/corrected fact status and search-result evidence with chapter jump", () => {
    const onOpenChapter = vi.fn();
    render(
      <NarrativeMemoryPanelShell
        bookId="book-1"
        diagnostics={null}
        empty={false}
        error={null}
        searchQuery="药园"
        searchResults={[{
          kind: "event",
          id: "search-1",
          title: "韩立 抵达 药园",
          chapterNumber: 7,
          evidenceText: "韩立走进药园。",
          confidence: 0.88,
        }]}
        stateFacts={[{
          kind: "fact",
          id: "f-closed",
          title: "韩立 状态 谨慎",
          category: "character_state",
          subject: "韩立",
          predicate: "状态",
          object: "谨慎",
          sourceChapter: 3,
          validUntilChapter: 9,
          sourceType: "manual",
          evidenceText: "韩立压住呼吸，神色谨慎。",
          confidence: 0.91,
        }]}
        entityGroups={[{
          entity: "韩立",
          facts: [{
            id: "f-closed",
            subject: "韩立",
            predicate: "状态",
            object: "谨慎",
            category: "character_state",
            sourceChapter: 3,
            validUntilChapter: 9,
            sourceType: "manual",
            evidenceText: "韩立压住呼吸，神色谨慎。",
            confidence: 0.91,
          }],
        }]}
        events={[]}
        onOpenChapter={onOpenChapter}
        onRefresh={() => undefined}
      />,
    );

    expect(screen.getByText("已纠正/关闭")).toBeTruthy();
    expect(screen.getByText("韩立走进药园。")).toBeTruthy();
    fireEvent.click(screen.getByTitle("打开来源第 7 章"));
    expect(onOpenChapter).toHaveBeenCalledWith(7);
  });

  it("exposes jump links to the authoritative 发展历程 entry when callback is provided", async () => {
    const onOpenDevelopmentTimeline = vi.fn();
    const { rerender } = render(
      <NarrativeMemoryPanelShell
        bookId="book-1"
        diagnostics={null}
        empty={false}
        error={null}
        events={[]}
        onOpenDevelopmentTimeline={onOpenDevelopmentTimeline}
        onRefresh={() => undefined}
      />,
    );

    // 顶部只放发展历程轻量跳转。
    const jumpArea = screen.getByTestId("narrative-memory-jump-links");
    fireEvent.click(within(jumpArea).getByRole("button", { name: /发展历程/u }));
    expect(onOpenDevelopmentTimeline).toHaveBeenCalledTimes(1);

    // 未提供回调时跳转区整体不渲染。
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
    expect(screen.queryByTestId("narrative-memory-jump-links")).toBeNull();
    expect(screen.queryByTestId("development-timeline-view")).toBeNull();
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
    expect(html).toContain("驳回");
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
   * 待确认队列批量操作：置信度筛选 + 多选 + 批量批准/丢弃。
   *
   * 丢弃自 T-28 起是两步确认（点「批量丢弃」先进入确认态），一次点击不再直接丢。
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

    // 切回全部再选两条 → 批量丢弃需要二次确认（操作栏重新出现，bulkLoading 已复位）。
    fireEvent.click(screen.getByRole("button", { name: "全部" }));
    const allCheckboxes = screen.getAllByRole("checkbox", { name: /选择事件/u });
    fireEvent.click(allCheckboxes[0]!);
    fireEvent.click(allCheckboxes[1]!);
    fireEvent.click(await screen.findByRole("button", { name: "批量丢弃" }));
    // 第一次点击只是进入确认态，不会丢任何东西。
    expect(onBulkDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认丢弃 2 条" }));
    expect(onBulkDelete).toHaveBeenCalledWith(expect.arrayContaining(["e-low", "e-mid"]));
  });

  /**
   * 批量丢弃的二次确认可取消，丢弃成功后有撤销入口。
   *
   * 旧实现点一下就物理删除、不留痕；误点一次只能重新结算。这里既测「取消不丢数据」，
   * 也测「丢弃后能一键撤销」。
   */
  it("cancels the discard confirmation and undoes a finished bulk discard", async () => {
    const onBulkDelete = vi.fn(async () => undefined);
    const onRestoreTrashed = vi.fn(async () => ({ restored: ["e-1", "e-2"], skipped: [], missing: [] }));
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
        onBulkDelete={onBulkDelete}
        onRestoreTrashed={onRestoreTrashed}
        onRefresh={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "全选当前筛选下的待确认事件" }));
    fireEvent.click(await screen.findByRole("button", { name: "批量丢弃" }));
    expect(onBulkDelete).not.toHaveBeenCalled();

    // 取消回到原状：选择集还在，什么都没丢。
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("button", { name: /确认丢弃/u })).toBeNull();
    expect(screen.getByText(/已选 2 条/u)).toBeTruthy();

    fireEvent.click(await screen.findByRole("button", { name: "批量丢弃" }));
    fireEvent.click(screen.getByRole("button", { name: "确认丢弃 2 条" }));
    await waitFor(() => expect(onBulkDelete).toHaveBeenCalledWith(["e-1", "e-2"]));

    // 丢弃成功后给出撤销入口，点它调恢复通道。
    fireEvent.click(await screen.findByRole("button", { name: "撤销" }));
    await waitFor(() => expect(onRestoreTrashed).toHaveBeenCalledWith(["e-1", "e-2"]));
    await waitFor(() => expect(screen.queryByRole("button", { name: "撤销" })).toBeNull());
  });

  /**
   * D5：服务端逐条返回 restored/skipped/missing。skipped 表示同 id 已在待确认队列，
   * 等价成功；missing 表示已不在回收站，重试永远失败。请求成功后撤销入口应直接消失，
   * 只对 missing 如实报告，不能再引导作者「再点一次」。
   */
  it("撤销部分成功时如实报告三种结果，且不再提供重试入口", async () => {
    const onBulkDelete = vi.fn(async () => undefined);
    const onRestoreTrashed = vi.fn(async () => ({
      restored: ["e-1"],
      skipped: ["e-2"],
      missing: ["e-3"],
    }));
    render(
      <NarrativeMemoryPanelShell
        bookId="book-1"
        diagnostics={null}
        empty={false}
        error={null}
        events={[
          { id: "e-1", eventType: "location_changed", entity: "韩立", confidence: 0.8, risk: "low", chapterNumber: 12 },
          { id: "e-2", eventType: "location_changed", entity: "厉飞雨", confidence: 0.8, risk: "low", chapterNumber: 12 },
          { id: "e-3", eventType: "location_changed", entity: "南宫婉", confidence: 0.8, risk: "low", chapterNumber: 12 },
        ]}
        onBulkApprove={vi.fn(async () => undefined)}
        onBulkDelete={onBulkDelete}
        onRestoreTrashed={onRestoreTrashed}
        onRefresh={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "全选当前筛选下的待确认事件" }));
    fireEvent.click(await screen.findByRole("button", { name: "批量丢弃" }));
    fireEvent.click(screen.getByRole("button", { name: "确认丢弃 3 条" }));
    await waitFor(() => expect(onBulkDelete).toHaveBeenCalledWith(["e-1", "e-2", "e-3"]));

    fireEvent.click(await screen.findByRole("button", { name: "撤销" }));
    await waitFor(() => expect(onRestoreTrashed).toHaveBeenCalledWith(["e-1", "e-2", "e-3"]));

    // 三种结果分别说清：恢复、已在队列（等价成功）、不在回收站（不可恢复）。
    const notice = await screen.findByText(/1 条已回到待确认队列/);
    expect(notice.textContent).toContain("1 条已在待确认队列中");
    expect(notice.textContent).toContain("1 条已不在回收站");
    expect(notice.textContent).toContain("无法恢复");
    expect(screen.queryByText(/重试/u)).toBeNull();
    expect(screen.queryByText(/再点一次/u)).toBeNull();
    // 请求已成功返回：撤销入口与「已丢弃 N 条」横幅一并消失（skipped 不算已丢弃），
    // 且不会被重复调用第二次。
    await waitFor(() => expect(screen.queryByRole("button", { name: "撤销" })).toBeNull());
    expect(screen.queryByText(/已丢弃/u)).toBeNull();
    expect(onRestoreTrashed).toHaveBeenCalledTimes(1);
  });

  it("撤销结果全部 skipped 时视为已达成，不报错且撤掉入口", async () => {
    const onBulkDelete = vi.fn(async () => undefined);
    const onRestoreTrashed = vi.fn(async () => ({ restored: [], skipped: ["e-1"], missing: [] }));
    render(
      <NarrativeMemoryPanelShell
        bookId="book-1"
        diagnostics={null}
        empty={false}
        error={null}
        events={[{ id: "e-1", eventType: "location_changed", entity: "韩立", confidence: 0.8, risk: "low", chapterNumber: 12 }]}
        onBulkApprove={vi.fn(async () => undefined)}
        onBulkDelete={onBulkDelete}
        onRestoreTrashed={onRestoreTrashed}
        onRefresh={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "全选当前筛选下的待确认事件" }));
    fireEvent.click(await screen.findByRole("button", { name: "批量丢弃" }));
    fireEvent.click(screen.getByRole("button", { name: "确认丢弃 1 条" }));
    await waitFor(() => expect(onBulkDelete).toHaveBeenCalled());

    fireEvent.click(await screen.findByRole("button", { name: "撤销" }));
    await waitFor(() => expect(onRestoreTrashed).toHaveBeenCalledWith(["e-1"]));
    // skipped 等价成功：没有错误提示，撤销入口与「已丢弃」横幅同样消失。
    await waitFor(() => expect(screen.queryByRole("button", { name: "撤销" })).toBeNull());
    expect(screen.queryByText(/已丢弃/u)).toBeNull();
    expect(screen.queryByText(/无法恢复/u)).toBeNull();
    expect(screen.queryByText(/撤销部分完成|撤销没有生效/u)).toBeNull();
    expect(onRestoreTrashed).toHaveBeenCalledTimes(1);
  });

  it("撤销一条都没恢复（只有 missing）时不留撤销入口，并说明不可恢复", async () => {
    const onBulkDelete = vi.fn(async () => undefined);
    const onRestoreTrashed = vi.fn(async () => ({ restored: [], skipped: [], missing: ["e-1"] }));
    render(
      <NarrativeMemoryPanelShell
        bookId="book-1"
        diagnostics={null}
        empty={false}
        error={null}
        events={[{ id: "e-1", eventType: "location_changed", entity: "韩立", confidence: 0.8, risk: "low", chapterNumber: 12 }]}
        onBulkApprove={vi.fn(async () => undefined)}
        onBulkDelete={onBulkDelete}
        onRestoreTrashed={onRestoreTrashed}
        onRefresh={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "全选当前筛选下的待确认事件" }));
    fireEvent.click(await screen.findByRole("button", { name: "批量丢弃" }));
    fireEvent.click(screen.getByRole("button", { name: "确认丢弃 1 条" }));
    await waitFor(() => expect(onBulkDelete).toHaveBeenCalled());

    fireEvent.click(await screen.findByRole("button", { name: "撤销" }));
    const notice = await screen.findByText(/0 条已回到待确认队列/);
    expect(notice.textContent).toContain("1 条已不在回收站");
    expect(notice.textContent).toContain("无法恢复");
    expect(screen.queryByText(/重试/u)).toBeNull();
    // 一条都没回来：不再提供按不动的撤销入口。
    await waitFor(() => expect(screen.queryByRole("button", { name: "撤销" })).toBeNull());
  });

  it("未接入撤销回调时明确报错，不假装撤销成功", async () => {
    const onBulkDelete = vi.fn(async () => undefined);
    render(
      <NarrativeMemoryPanelShell
        bookId="book-1"
        diagnostics={null}
        empty={false}
        error={null}
        events={[{ id: "e-1", eventType: "location_changed", entity: "韩立", confidence: 0.8, risk: "low", chapterNumber: 12 }]}
        onBulkApprove={vi.fn(async () => undefined)}
        onBulkDelete={onBulkDelete}
        onRefresh={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "全选当前筛选下的待确认事件" }));
    fireEvent.click(await screen.findByRole("button", { name: "批量丢弃" }));
    fireEvent.click(screen.getByRole("button", { name: "确认丢弃 1 条" }));
    await waitFor(() => expect(onBulkDelete).toHaveBeenCalled());

    fireEvent.click(await screen.findByRole("button", { name: "撤销" }));
    expect(await screen.findByText(/当前界面未接入撤销能力/)).toBeTruthy();
    // 没有成功返回，撤销入口保留（不会假装已经撤销）。
    expect(screen.getByRole("button", { name: "撤销" })).toBeTruthy();
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

    const selectAll = screen.getByRole("checkbox", { name: "全选当前筛选下的待确认事件" });
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
    expect(screen.getByTestId("narrative-line-approvals").textContent).toContain("暂无叙事线修改记录");
  });
});

describe("NarrativeMemoryPanelShell 作者自救入口", () => {
  /**
   * 手动新增事实：结算漏记时作者自己补一条。
   * 走后端 /facts（manual 来源，享结算覆盖保护），提交成功后刷新面板。
   */
  it("新增事实表单提交后调用 POST /facts 并刷新", async () => {
    const calls: Array<{ path: string; method?: string; body?: unknown }> = [];
    apiMock.fetchJsonImpl = async (path, init) => {
      calls.push({
        path,
        ...(init?.method ? { method: init.method } : {}),
        ...(typeof init?.body === "string" ? { body: JSON.parse(init.body) } : {}),
      });
      if (path.endsWith("/narrative-memory/facts") && init?.method === "POST") {
        return { summary: "已新增叙事事实：韩立 / 境界 / 筑基初期" };
      }
      return {};
    };
    const onRefresh = vi.fn();
    render(
      <NarrativeMemoryPanelShell
        bookId="book-1"
        diagnostics={null}
        empty={false}
        error={null}
        events={[]}
        currentChapter={7}
        onRefresh={onRefresh}
      />,
    );

    fireEvent.click(screen.getByTestId("memory-manual-fact-toggle"));
    fireEvent.change(screen.getByLabelText("新事实主体"), { target: { value: "韩立" } });
    fireEvent.change(screen.getByLabelText("新事实属性"), { target: { value: "境界" } });
    fireEvent.change(screen.getByLabelText("新事实的值"), { target: { value: "筑基初期" } });
    fireEvent.change(screen.getByLabelText("新事实类别"), { target: { value: "character_state" } });
    fireEvent.click(screen.getByTestId("memory-manual-fact-submit"));

    await screen.findByText("已新增叙事事实：韩立 / 境界 / 筑基初期");
    const post = calls.find((call) => call.path.endsWith("/narrative-memory/facts") && call.method === "POST");
    expect(post?.body).toMatchObject({
      subject: "韩立",
      predicate: "境界",
      object: "筑基初期",
      category: "character_state",
      // 未填生效章时落到当前章，避免事实挂在不存在的章号上。
      validFromChapter: 7,
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  /** 补记事件：进入待确认队列，等作者裁决，不直接生效。 */
  it("补记事件表单提交后调用 POST /events 并刷新", async () => {
    const calls: Array<{ path: string; method?: string; body?: unknown }> = [];
    apiMock.fetchJsonImpl = async (path, init) => {
      calls.push({
        path,
        ...(init?.method ? { method: init.method } : {}),
        ...(typeof init?.body === "string" ? { body: JSON.parse(init.body) } : {}),
      });
      if (path.endsWith("/narrative-memory/events") && init?.method === "POST") {
        return { summary: "已创建 1 条待确认事件。" };
      }
      return {};
    };
    const onRefresh = vi.fn();
    render(
      <NarrativeMemoryPanelShell
        bookId="book-1"
        diagnostics={null}
        empty={false}
        error={null}
        events={[]}
        currentChapter={7}
        onRefresh={onRefresh}
      />,
    );

    fireEvent.click(screen.getByTestId("memory-manual-event-toggle"));
    fireEvent.change(screen.getByLabelText("补记事件章号"), { target: { value: "9" } });
    fireEvent.change(screen.getByLabelText("补记事件类型"), { target: { value: "hook_planted" } });
    fireEvent.change(screen.getByLabelText("补记事件主体"), { target: { value: "韩立" } });
    fireEvent.change(screen.getByLabelText("补记事件谓词"), { target: { value: "埋设" } });
    fireEvent.change(screen.getByLabelText("补记事件客体"), { target: { value: "神秘石符" } });
    fireEvent.change(screen.getByLabelText("补记事件正文依据"), { target: { value: "石符泛起微光。" } });
    fireEvent.click(screen.getByTestId("memory-manual-event-submit"));

    await screen.findByText("已创建 1 条待确认事件。");
    const post = calls.find((call) => call.path.endsWith("/narrative-memory/events") && call.method === "POST");
    expect(post?.body).toMatchObject({
      chapterNumber: 9,
      eventType: "hook_planted",
      subject: "韩立",
      predicate: "埋设",
      object: "神秘石符",
      evidenceText: "石符泛起微光。",
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  /**
   * 回收站：丢弃是软删除（保留 30 天），刷新页面后必须仍找得到。
   * 这里覆盖「展开 → 列出 → 恢复单条」，走 narrative-pending-events 的既有通道。
   */
  it("回收站常驻入口能列出已丢弃事件并恢复", async () => {
    const restoreBodies: unknown[] = [];
    const fetchStub = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/narrative-memory/events/trash") && !init?.method) {
        return {
          ok: true,
          json: async () => ({
            events: [
              { id: "t-1", entity: "韩立", predicate: "抵达", object: "药园", chapterNumber: 4, deletedAt: "2026-08-01T02:00:00.000Z", deletedReason: "工作台批量丢弃" },
            ],
          }),
        } as unknown as Response;
      }
      if (url.endsWith("/narrative-memory/events/trash/restore")) {
        if (typeof init?.body === "string") restoreBodies.push(JSON.parse(init.body));
        return {
          ok: true,
          json: async () => ({ summary: "撤销丢弃：1 已恢复，0 跳过，0 不在回收站。", restored: ["t-1"], skipped: [], missing: [] }),
        } as unknown as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchStub);
    const onRefresh = vi.fn();
    try {
      render(
        <NarrativeMemoryPanelShell
          bookId="book-1"
          diagnostics={null}
          empty={false}
          error={null}
          events={[]}
          onRefresh={onRefresh}
        />,
      );

      fireEvent.click(screen.getByTestId("memory-pending-trash-toggle"));
      const list = await screen.findByTestId("memory-pending-trash-list");
      expect(await within(list).findByText(/韩立 · 抵达 · 药园/)).toBeTruthy();

      fireEvent.click(within(list).getByRole("button", { name: /恢复$/ }));
      await within(list).findByText("撤销丢弃：1 已恢复，0 跳过，0 不在回收站。");
      expect(restoreBodies[0]).toEqual({ eventIds: ["t-1"] });
      expect(onRefresh).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  /** 卷 / 阶段摘要：列出记录 + 新鲜度，支持逐条确认与一键回填。 */
  it("卷摘要卡片能列出记录、确认摘要并回填", async () => {
    const calls: string[] = [];
    apiMock.fetchJsonImpl = async (path, init) => {
      calls.push(`${init?.method ?? "GET"} ${path}`);
      if (path.endsWith("/narrative-memory/arc-summaries") && !init?.method) {
        return {
          records: [
            { id: "arc-1", kind: "volume", segmentId: "v1", segmentTitle: "第一卷 落霞", chapterFrom: 1, chapterTo: 12, status: "needs-review", fresh: true, content: { gist: "韩立离乡入宗门。" } },
            { id: "arc-2", kind: "volume", segmentId: "v2", segmentTitle: "第二卷 内门", chapterFrom: 13, chapterTo: 30, status: "stale", fresh: false },
          ],
          summary: "已有 2 条卷摘要 / 全书梗概，其中待确认 1 条。",
        };
      }
      if (path.includes("/arc-summaries/arc-1/confirm")) {
        return { summary: "已确认「第一卷 落霞」的摘要。" };
      }
      if (path.endsWith("/arc-summaries/backfill")) {
        return { summary: "已生成 1 条卷摘要 / 全书梗概，均为待确认。" };
      }
      return {};
    };
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

    fireEvent.click(screen.getByTestId("memory-arc-summaries-toggle"));
    await screen.findByText("第一卷 落霞");
    expect(screen.getByText("韩立离乡入宗门。")).toBeTruthy();
    // 过期的那条不能确认：按钮禁用并给出原因。
    const staleConfirm = screen.getByTestId("memory-arc-summary-confirm-arc-2") as HTMLButtonElement;
    expect(staleConfirm.disabled).toBe(true);
    expect(screen.getAllByText("已过期").length).toBeGreaterThanOrEqual(1);

    fireEvent.click(screen.getByTestId("memory-arc-summary-confirm-arc-1"));
    await screen.findByText("已确认「第一卷 落霞」的摘要。");
    expect(calls.some((call) => call.includes("POST") && call.includes("/arc-summaries/arc-1/confirm"))).toBe(true);

    fireEvent.click(screen.getByTestId("memory-arc-summaries-backfill"));
    await screen.findByText("已生成 1 条卷摘要 / 全书梗概，均为待确认。");
  });

  /** 记忆诊断与修复工具箱：过期事实清单 + 5 类幂等修复动作。 */
  it("诊断工具箱能列出过期事实并触发修复动作", async () => {
    const calls: string[] = [];
    apiMock.fetchJsonImpl = async (path, init) => {
      calls.push(`${init?.method ?? "GET"} ${path}`);
      if (path.includes("/narrative-memory/stale-facts")) {
        return {
          staleCount: 1,
          thresholdChapters: 30,
          items: [
            {
              id: "f-stale",
              subject: "韩立",
              predicate: "位置",
              object: "黄枫谷",
              staleness: { level: "stale", staleChapters: 34, label: "已 34 章未变动", explanation: { suggestedAction: "复查这条状态是否仍然成立。" } },
            },
          ],
          summary: "发现 1 条动态状态已超过 30 章未变动，可能已过时，请复查。",
        };
      }
      if (path.endsWith("/state-slots/recompute")) {
        return { summary: "检查 3 条人物状态：无需整理。" };
      }
      return {};
    };
    render(
      <NarrativeMemoryPanelShell
        bookId="book-1"
        diagnostics={null}
        empty={false}
        error={null}
        events={[]}
        currentChapter={40}
        onRefresh={() => undefined}
      />,
    );

    fireEvent.click(screen.getByTestId("memory-maintenance-toggle"));
    await screen.findByText("发现 1 条动态状态已超过 30 章未变动，可能已过时，请复查。");
    expect(screen.getByTestId("memory-maintenance-stale-list").textContent).toContain("韩立 · 位置 · 黄枫谷");
    expect(calls.some((call) => call.includes("stale-facts?currentChapter=40"))).toBe(true);

    fireEvent.click(screen.getByTestId("memory-maintenance-state-slots"));
    await screen.findByText("检查 3 条人物状态：无需整理。");
    expect(calls.some((call) => call === "POST /api/books/book-1/narrative-memory/state-slots/recompute")).toBe(true);
    // 六个修复动作都在，缺一个作者就会以为能力不存在。
    for (const key of ["state-slots", "causal-links", "passages", "ledger", "entity-ids", "entity-embeddings"]) {
      expect(screen.getByTestId(`memory-maintenance-${key}`)).toBeTruthy();
    }
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

  it("待确认队列支持按语义类别胶囊、来源章节下拉/分组与高风险筛选", () => {
    render(
      <NarrativeMemoryPanelShell
        bookId="book-1"
        diagnostics={null}
        empty={false}
        error={null}
        events={[
          { id: "ev-1", eventType: "character_state_changed", entity: "薛行之", subject: "薛行之", predicate: "境界", object: "筑基初期", chapterNumber: 2, risk: "low", confidence: 0.7 },
          { id: "ev-2", eventType: "relationship_changed", entity: "薛行之", subject: "薛行之", predicate: "怀疑", object: "方工", chapterNumber: 3, risk: "high", confidence: 0.55 },
          { id: "ev-3", eventType: "hook_planted", entity: "古铜镜", subject: "古铜镜", predicate: "埋设", object: "背面暗纹", chapterNumber: 3, risk: "medium", confidence: 0.8 },
          { id: "ev-4", eventType: "timeline_advanced", entity: "景佑三年", subject: "故事时间", predicate: "推进至", object: "秋分", chapterNumber: 5, risk: "low", confidence: 0.85 },
        ]}
        onRefresh={() => undefined}
      />,
    );

    const pendingSection = screen.getByTestId("narrative-memory-pending");
    // 语义分类胶囊计数准确
    expect(within(pendingSection).getByTestId("memory-pending-cat-all").textContent).toContain("4");
    expect(within(pendingSection).getByTestId("memory-pending-cat-character_state").textContent).toContain("1");
    expect(within(pendingSection).getByTestId("memory-pending-cat-relationship").textContent).toContain("1");
    expect(within(pendingSection).getByTestId("memory-pending-cat-hook").textContent).toContain("1");
    expect(within(pendingSection).getByTestId("memory-pending-cat-timeline").textContent).toContain("1");

    // 按语义类别筛选「伏笔线索」
    fireEvent.click(within(pendingSection).getByTestId("memory-pending-cat-hook"));
    expect(within(pendingSection).getByText(/古铜镜 · 埋设 · 背面暗纹/)).toBeTruthy();
    expect(within(pendingSection).queryByText(/薛行之 · 怀疑 · 方工/)).toBeNull();

    // 切回全部，开启高风险优先筛选
    fireEvent.click(within(pendingSection).getByTestId("memory-pending-cat-all"));
    fireEvent.click(within(pendingSection).getByTestId("memory-pending-risk-high"));
    expect(within(pendingSection).getByText(/薛行之 · 怀疑 · 方工/)).toBeTruthy();
    expect(within(pendingSection).queryByText(/古铜镜 · 埋设 · 背面暗纹/)).toBeNull();

    // 重置风险，按来源章节下拉筛选第 5 章
    fireEvent.click(within(pendingSection).getByTestId("memory-pending-risk-all"));
    fireEvent.change(within(pendingSection).getByTestId("memory-pending-chapter-select"), { target: { value: "5" } });
    expect(within(pendingSection).getByText(/故事时间 · 推进至 · 秋分/)).toBeTruthy();
    expect(within(pendingSection).queryByText(/筑基初期/)).toBeNull();

    // 切回全部章节，开启「按章分组」
    fireEvent.change(within(pendingSection).getByTestId("memory-pending-chapter-select"), { target: { value: "all" } });
    fireEvent.click(within(pendingSection).getByTestId("memory-pending-group-by-chapter"));
    expect(within(pendingSection).getByTestId("memory-pending-chapter-groups")).toBeTruthy();
  });

  it("首次加载且暂无数据时展示骨架屏而非裸转圈，同时保留加载文案", () => {
    render(
      <NarrativeMemoryPanelShell
        bookId="book-1"
        diagnostics={null}
        loading
        empty={false}
        error={null}
        events={[]}
        onRefresh={() => undefined}
      />,
    );

    const skeleton = screen.getByTestId("narrative-memory-skeleton");
    expect(skeleton.textContent).toContain("加载故事状态...");
    expect(skeleton.querySelectorAll(".nf-skeleton-pulse").length).toBeGreaterThanOrEqual(3);
  });
});
