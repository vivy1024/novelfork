import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NarrativeMemoryPanelShell } from "./NarrativeMemoryPanel";

// 本包没开 vitest globals，RTL 的自动 cleanup 不会注册；不清理会让多次 render
// 的 DOM 累积，按 role 定位时命中上一个用例留下的节点。
afterEach(() => {
  cleanup();
});

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

    for (const label of ["故事状态", "结算历史", "关系图", "时间线", "角色弧线", "矛盾地图", "事件链"]) {
      expect(html).toContain(label);
    }

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

    const nav = screen.getByRole("navigation", { name: "叙事记忆视图" });
    fireEvent.click(within(nav).getByRole("button", { name: "结算历史" }));

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

    // 默认在「故事状态」，台账还不该出现。
    expect(screen.queryByTestId("narrative-line-approvals")).toBeNull();

    const nav = screen.getByRole("navigation", { name: "叙事记忆视图" });
    fireEvent.click(within(nav).getByRole("button", { name: "结算历史" }));

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

    // 「结算历史」既是导航项也是摘要区的「查看全部」目标，这里限定导航区。
    const nav = screen.getByRole("navigation", { name: "叙事记忆视图" });
    fireEvent.click(within(nav).getByRole("button", { name: "结算历史" }));
    expect(screen.getByTestId("narrative-line-approvals").textContent).toContain("在叙事线视图增删节点后会出现");
  });
});
