import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

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

    for (const label of ["故事状态", "结算历史", "关系图", "时间线", "角色弧线", "伏笔网络", "矛盾地图", "事件链"]) {
      expect(html).toContain(label);
    }

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
