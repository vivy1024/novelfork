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
});
