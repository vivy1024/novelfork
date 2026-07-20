import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NarrativeMemoryPanelShell } from "./NarrativeMemoryPanel";

describe("NarrativeMemoryPanelShell", () => {
  it("exposes memory overview and graph views without diagnosis or market tools", () => {
    const html = renderToStaticMarkup(
      <NarrativeMemoryPanelShell
        diagnostics={null}
        empty
        error={null}
        events={[]}
        onRefresh={() => undefined}
      />,
    );

    for (const label of ["记忆总览", "关系图", "时间线", "角色弧线", "伏笔网络", "矛盾地图", "事件链"]) {
      expect(html).toContain(label);
    }

    expect(html).not.toContain("质量监控");
    expect(html).not.toContain("市场雷达");
    expect(html).not.toContain("选段写作");
  });

  it("shows book-scoped stats and pending event review actions", () => {
    const html = renderToStaticMarkup(
      <NarrativeMemoryPanelShell
        diagnostics={null}
        stats={{ total: 3, byKind: { fact: 2, event: 1 }, pendingEvents: 1 }}
        empty={false}
        error={null}
        events={[{ id: "event-1", eventType: "hook_planted", entity: "小瓶", risk: "high", confidence: 0.9, chapterNumber: 8, evidence: "正文证据" }]}
        onApprove={() => undefined}
        onReject={() => undefined}
        onRefresh={() => undefined}
      />,
    );

    expect(html).toContain("共 3 条");
    expect(html).toContain("批准并写入动态事实");
    expect(html).toContain("拒绝");
    expect(html).toContain("正文证据");
  });
});
