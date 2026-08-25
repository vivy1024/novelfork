import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const fetchJsonMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/use-api", () => ({ fetchJson: fetchJsonMock }));
vi.mock("@tiptap/react", () => ({
  useEditor: () => null,
  EditorContent: () => null,
}));

import {
  GovernanceCockpitPanel,
  computePromiseHitRate,
  currentChapterFromBookResources,
  formatPercent,
  rateToneClass,
} from "./GovernanceCockpitPanel";

afterEach(() => {
  cleanup();
  fetchJsonMock.mockReset();
});

describe("纯函数：承诺命中率口径", () => {
  it("resolved / (resolved + overdue) 只统计已回收与超期，分母为 0 时为 null", () => {
    // 没有任何已回收、当前章号未知 → 超期无法判定，分母为 0 → null（展示「—」）。
    const result = computePromiseHitRate([{ fields: { status: "部分揭示", plantedChapter: 5 } }], undefined);
    expect(result.percent).toBeNull();
    expect(result.resolved).toBe(0);
    expect(result.overdue).toBe(0);

    expect(rateToneClass(null)).toBe("text-muted-foreground");
    expect(formatPercent(null)).toBe("—");
  });

  it("悬置超过 20 章阈值才计超期，颜色按 70/40 分档", () => {
    const entries = [
      { fields: { status: "已回收" } },
      { fields: { status: "已回收" } },
      { fields: { status: "已回收" } },
      { fields: { status: "已埋设", plantedChapter: 4 } },
      { fields: { status: "部分揭示", plantedChapter: 20 } },
    ];
    // 当前第 30 章：第 4 章埋的悬置 26 章 → 超期；第 20 章埋的悬置 10 章 → 未超期。
    const result = computePromiseHitRate(entries, 30);
    expect(result.overdue).toBe(1);
    expect(result.resolved).toBe(3);
    expect(result.percent).toBe(75);
    expect(rateToneClass(result.percent)).toBe("text-green-600");
    expect(rateToneClass(50)).toBe("text-yellow-600");
    expect(rateToneClass(39)).toBe("text-red-500");
  });

  it("当前章号取 chapters 最大号；否则用 nextChapter - 1", () => {
    expect(currentChapterFromBookResources({ chapters: [{ number: 3 }, { number: 12 }] })).toBe(12);
    expect(currentChapterFromBookResources({ nextChapter: 9 })).toBe(8);
    expect(currentChapterFromBookResources({})).toBeUndefined();
  });
});

describe("GovernanceCockpitPanel", () => {
  it("渲染三张指标卡、只读契约与结算开关，开关写回 PUT config", async () => {
    fetchJsonMock.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (init?.method === "PUT") {
        return { config: { settlement: { useLlmExtraction: false, autoChapterSummary: true } } };
      }
      if (/\/api\/books\/b1$/.test(url)) {
        return {
          book: {
            title: "测试书",
            narrativeContract: {
              titlePromise: "凡人流逆袭",
              coreQuestion: "凡人能否逆天改命？",
              themeAnchors: ["逆天", "求道"],
              revealBudget: { level: 2, description: "卷内可揭底牌" },
            },
          },
          chapters: [{ number: 30 }],
        };
      }
      if (url.includes("/jingwei/entries")) {
        return {
          entries: [
            { id: "f1", fields: { status: "已回收" } },
            { id: "f2", fields: { status: "已回收" } },
            { id: "f3", fields: { status: "已埋设", plantedChapter: 2 } },
          ],
        };
      }
      if (url.includes("/health")) {
        return {
          health: {
            hookRecoveryRate: { status: "measured", value: 0.4, source: "test" },
            warnings: [{ type: "sensitive", message: "第 3 章敏感词密度偏高" }],
          },
        };
      }
      if (url.includes("/narrative-memory/config")) {
        return { config: { settlement: { useLlmExtraction: true, autoChapterSummary: false } } };
      }
      throw new Error(`unexpected request: ${url}`);
    });

    render(<GovernanceCockpitPanel bookId="b1" />);

    // 命中率 = 2 已回收 / (2 + 1 超期[第2章埋,当前30章]) ≈ 67%（黄色）。
    await waitFor(() => expect(screen.getByText("67%")).toBeTruthy());
    expect(screen.getByText(/已回收 2 \/ 超期 1/)).toBeTruthy();
    // 回收率来自 /health 的 0.4。
    expect(screen.getByText("40%")).toBeTruthy();
    // 治理健康 = 1 warning + 1 超期 = 2 项。
    expect(screen.getByText("2 项")).toBeTruthy();
    expect(screen.getByText(/第 3 章敏感词密度偏高/)).toBeTruthy();

    // 契约只读展示 + 无写入通道提示。
    expect(screen.getByDisplayValue("凡人流逆袭")).toBeTruthy();
    expect(screen.getByText(/手动编辑 book\.json/)).toBeTruthy();
    const promiseInput = screen.getByDisplayValue("凡人流逆袭") as HTMLInputElement;
    expect(promiseInput.disabled).toBe(true);
    expect(screen.getByText("逆天")).toBeTruthy();
    expect(screen.getByDisplayValue(/层级 2 · 卷内可揭底牌/)).toBeTruthy();

    // 结算开关初始态来自 config。
    const llmSwitch = screen.getByRole("switch", { name: "LLM 事件抽取" });
    expect(llmSwitch.getAttribute("aria-checked")).toBe("true");
    const summarySwitch = screen.getByRole("switch", { name: "自动章节摘要" });
    expect(summarySwitch.getAttribute("aria-checked")).toBe("false");

    // 点开「自动章节摘要」（初始关）→ PUT 写回并应用响应值。
    fireEvent.click(summarySwitch);
    await waitFor(() => {
      const putCall = fetchJsonMock.mock.calls.find(([, init]) => (init as { method?: string } | undefined)?.method === "PUT");
      expect(putCall).toBeTruthy();
    });
    const [putUrl, putInit] = fetchJsonMock.mock.calls.find(([, init]) => (init as { method?: string } | undefined)?.method === "PUT");
    expect(putUrl).toBe("/api/books/b1/narrative-memory/config");
    expect(JSON.parse(putInit.body)).toEqual({ config: { settlement: { autoChapterSummary: true } } });
    await waitFor(() => expect(screen.getByRole("switch", { name: "自动章节摘要" }).getAttribute("aria-checked")).toBe("true"));
  });

  it("单路失败不连坐：健康度不可用时其余区块照常渲染", async () => {
    fetchJsonMock.mockImplementation(async (url: string) => {
      if (url.includes("/health")) throw new Error("boom");
      if (/\/api\/books\/b2$/.test(url)) return { book: {}, chapters: [] };
      if (url.includes("/jingwei/entries")) return { entries: [] };
      if (url.includes("/narrative-memory/config")) {
        return { config: { settlement: { useLlmExtraction: false, autoChapterSummary: false } } };
      }
      throw new Error(`unexpected request: ${url}`);
    });

    render(<GovernanceCockpitPanel bookId="b2" />);

    await waitFor(() => expect(screen.getByText(/数据暂时不可用：boom/)).toBeTruthy());
    // 命中率分母为 0 → 灰色「—」。
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    // 结算区块不受影响。
    expect(screen.getByRole("switch", { name: "自动章节摘要" }).getAttribute("aria-checked")).toBe("false");
  });
});
