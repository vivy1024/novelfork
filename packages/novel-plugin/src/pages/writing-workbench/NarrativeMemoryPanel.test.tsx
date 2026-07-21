import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NarrativeMemoryPanelShell } from "./NarrativeMemoryPanel";

describe("NarrativeMemoryPanelShell", () => {
  it("exposes author-first story status and history without diagnosis or market tools", () => {
    const html = renderToStaticMarkup(
      <NarrativeMemoryPanelShell
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
    expect(html).toContain("动态事实");
    expect(html).toContain("韩立 状态 谨慎");
    expect(html).toContain("角色状态");
    expect(html).toContain("最近结算");
    expect(html).toContain("韩立 抵达 药园");
    expect(html).toContain("批准并写入动态事实");
    expect(html).toContain("拒绝");
    expect(html).toContain("正文证据");
    expect(html).toContain("章后默认自动结算");
    expect(html).toContain("高级：召回诊断");
    // 诊断默认折叠，不直接铺开通道明细
    expect(html).not.toContain("检索 3");
  });
});
