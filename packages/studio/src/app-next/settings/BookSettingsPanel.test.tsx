import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BookSettingsPanel } from "../../../../novel-plugin/src/pages/writing-workbench/panels/BookSettingsPanel";

const apiFetchMock = vi.fn();

vi.mock("@/hooks/use-api", () => ({
  fetchJson: (...args: unknown[]) => apiFetchMock(...args),
}));

vi.mock("../../../../novel-plugin/src/pages/writing-workbench/panels/NarrativeMemorySettingsPanel", () => ({
  NarrativeMemorySettingsSection: () => <div data-testid="narrative-memory-section">Mock Narrative Memory</div>,
}));

describe("BookSettingsPanel book design and rules", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  it("loads and renders book design and book rules", async () => {
    apiFetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/writing-layers")) {
        return {
          bookId: "book-1",
          bookDesign: {
            authorIntent: "长期写实主线",
            currentFocus: "药园试探",
            volumeOutline: "第一卷：七玄门",
          },
          bookRulesRaw: "主角必须隐忍",
          bookRulesText: "主角必须隐忍",
          bookRules: [{ id: "rule-1", title: "人设锁定", content: "主角必须隐忍" }],
        };
      }
      return {
        book: {
          title: "凡人修仙录",
          genre: "xianxia",
          platform: "tomato",
          language: "zh",
          targetChapters: 200,
          chapterWordCount: 3000,
          arcTrackingMode: "rule",
          customSensitiveWords: "",
        },
      };
    });

    render(<BookSettingsPanel bookId="book-1" onBack={() => undefined} />);

    expect(await screen.findByDisplayValue("凡人修仙录")).toBeTruthy();
    expect(screen.queryByTestId("author-profile-toggle")).toBeNull();
    expect(await screen.findByDisplayValue("长期写实主线")).toBeTruthy();
    // 当前聚焦与本书规则只读显示（唯一编辑处在创作罗盘 / 设定的写作规则）。
    expect(screen.getByTestId("current-focus-summary").textContent).toContain("药园试探");
    expect(screen.queryByDisplayValue("药园试探")).toBeNull();
    expect(screen.getByDisplayValue("第一卷：七玄门")).toBeTruthy();
    expect(screen.getByTestId("book-rules-summary").textContent).toContain("主角必须隐忍");
    expect(screen.queryByDisplayValue("主角必须隐忍")).toBeNull();
  });
});
