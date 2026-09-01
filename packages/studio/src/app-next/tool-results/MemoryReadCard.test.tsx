import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MemoryReadCard } from "./MemoryReadCard";

describe("MemoryReadCard", () => {
  it("renders seven write-profile columns and trim reasons", () => {
    render(MemoryReadCard({
      toolName: "memory.read",
      result: {
        ok: true,
        data: {
          cards: [{ id: "c1", title: "韩立", channel: "state", brief: "抵达药园", reason: "点名实体", estimatedTokens: 12 }],
          diagnostics: { totalEstimatedTokens: 12, warnings: [], trimReasons: [{ id: "c2", reason: "核心角色超过上限 6。" }] },
          writeProfile: {
            locationAndTime: { title: "当前位置与故事时间", items: [{ title: "药园", summary: "入门第三日黄昏" }] },
            hardConstraints: { title: "硬约束", items: [{ title: "不得暴露小瓶" }] },
            coreCharacters: { title: "核心角色", items: [{ title: "韩立", named: true }], cap: 6, trimmed: 2, candidateCount: 8 },
            activeHooks: { title: "活跃伏笔", items: [{ title: "小瓶来历" }], cap: 8, trimmed: 0 },
            recentSummaries: { title: "近5章速记", items: [{ title: "第12章" }], cap: 5 },
            nextCommitments: { title: "下一章承诺", items: [{ title: "确认墨大夫是否察觉" }] },
            continuityRisks: { title: "连贯性风险", items: [] },
          },
        },
      },
    }));

    expect(screen.getByTestId("write-profile")).toBeTruthy();
    expect(screen.getByText("核心角色")).toBeTruthy();
    expect(screen.getByText("1/6")).toBeTruthy();
    expect(screen.getByText("近5章速记")).toBeTruthy();
    expect(screen.getByText("1/5")).toBeTruthy();
    expect(screen.getByText("点名")).toBeTruthy();
    expect(screen.getByText(/裁剪原因/)).toBeTruthy();
  });
});
