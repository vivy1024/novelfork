import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { AiTasteBadge } from "./AiTasteBadge";
import { ChapterDetailPanel } from "./ChapterDetailPanel";
import { FilterReportTab } from "./FilterReportTab";
import { SevenTacticsDrawer } from "./SevenTacticsDrawer";
import type { StoredFilterReportView } from "./types";

const report: StoredFilterReportView = {
  id: "report-1",
  bookId: "book-1",
  chapterNumber: 1,
  aiTasteScore: 76,
  level: "severe" as const,
  details: {
    pgiUsed: true,
    hits: [
      { ruleId: "r03", name: "典型 AI 词汇", severity: "high", spans: [{ start: 0, end: 5, matched: "值得注意" }], suggestion: "删套话" },
    ],
  },
};

afterEach(() => cleanup());

describe("filter report UI components", () => {
  it("renders badge colors, report summary, detail panel, and tactics drawer", () => {
    render(
      <>
        <AiTasteBadge score={24} level="clean" />
        <AiTasteBadge score={76} level="severe" />
        <FilterReportTab reports={[report]} />
        <ChapterDetailPanel report={report} />
        <SevenTacticsDrawer suggestions={[{ tacticId: 4, name: "人工改写润色", template: "打开 diff", type: "ui-action" }]} />
      </>,
    );

    expect(screen.getByText("AI 味 24 · clean")).toBeTruthy();
    expect(screen.getAllByText("AI 味 76 · severe").length).toBeGreaterThan(0);
    expect(screen.getByText("全书平均分：76")).toBeTruthy();
    expect(screen.getByText("PGI 章节平均：76（1 章）")).toBeTruthy();
    expect(screen.getByText("典型 AI 词汇")).toBeTruthy();
    expect(screen.getByText("人工改写润色")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "应用第 4 招" }));
    expect(screen.getByText("打开 diff")).toBeTruthy();
  });
});
