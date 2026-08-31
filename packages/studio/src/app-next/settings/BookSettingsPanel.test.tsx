import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BookSettingsPanel } from "../../../../novel-plugin/src/pages/writing-workbench/panels/BookSettingsPanel";

const apiFetchMock = vi.fn();

vi.mock("@/hooks/use-api", () => ({
  fetchJson: (...args: unknown[]) => apiFetchMock(...args),
}));

vi.mock("../../../../novel-plugin/src/pages/writing-config/WritingConfigSection", () => ({
  NarrativeMemorySettingsSection: () => <div data-testid="narrative-memory-section">Mock Narrative Memory</div>,
}));

describe("BookSettingsPanel layers and author profile toggle", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  it("loads and renders author profile toggle, book design and book rules", async () => {
    apiFetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/writing-layers")) {
        return {
          bookId: "book-1",
          authorProfileEnabled: true,
          bookDesign: {
            authorIntent: "长期写实主线",
            currentFocus: "药园试探",
            volumeOutline: "第一卷：七玄门",
          },
          bookRulesRaw: "主角必须隐忍",
          bookRulesText: "主角必须隐忍",
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
          authorProfileEnabled: true,
        },
      };
    });

    render(<BookSettingsPanel bookId="book-1" onBack={() => undefined} />);

    expect(await screen.findByDisplayValue("凡人修仙录")).toBeTruthy();
    expect(screen.getByTestId("author-profile-toggle")).toBeTruthy();
    expect(await screen.findByDisplayValue("长期写实主线")).toBeTruthy();
    expect(screen.getByDisplayValue("药园试探")).toBeTruthy();
    expect(screen.getByDisplayValue("第一卷：七玄门")).toBeTruthy();
    expect(screen.getByDisplayValue("主角必须隐忍")).toBeTruthy();
  });
});
