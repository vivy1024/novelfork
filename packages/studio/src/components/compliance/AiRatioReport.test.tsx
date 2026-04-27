import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import type { BookAiRatioReport } from "@vivy1024/novelfork-core/compliance";

import { AiRatioReport } from "./AiRatioReport";

const sampleReport: BookAiRatioReport = {
  bookId: "book-1",
  platform: "fanqie",
  totalWords: 10000,
  overallAiRatio: 0.18,
  overallLevel: "caution",
  platformThreshold: 0.2,
  platformThresholds: {
    qidian: 0,
    jjwxc: 0.05,
    fanqie: 0.2,
    qimao: 0.2,
    generic: 0.2,
  },
  methodology: "基于 AI 味特征分数的粗略估算，不代表精确 AI 生成比例；仅用于投稿前自检，最终以平台实际审核为准。",
  chapters: [
    {
      chapterNumber: 1,
      chapterTitle: "第一章 初入长夜",
      wordCount: 4000,
      aiTasteScore: 0.32,
      estimatedAiRatio: 0.1,
      isAboveThreshold: false,
      level: "safe",
    },
    {
      chapterNumber: 2,
      chapterTitle: "第二章 追猎",
      wordCount: 6000,
      aiTasteScore: 0.66,
      estimatedAiRatio: 0.3,
      isAboveThreshold: true,
      level: "danger",
    },
  ],
};

afterEach(() => {
  cleanup();
});

describe("AiRatioReport", () => {
  it("renders overall ratio, threshold references, and chapter details", () => {
    render(<AiRatioReport report={sampleReport} />);

    expect(screen.getByText("AI 比例估算报告")).toBeTruthy();
    expect(screen.getByText("总体估算 18.0%")).toBeTruthy();
    expect(screen.getByText("当前平台：番茄小说")).toBeTruthy();
    expect(screen.getByText(/仅供参考/)).toBeTruthy();

    expect(screen.getByText("平台参考阈值")).toBeTruthy();
    expect(screen.getByText("起点中文网 0.0%")).toBeTruthy();
    expect(screen.getByText(/晋江文学城 5.0%/)).toBeTruthy();
    expect(screen.getByText(/仅限 3 类辅助/)).toBeTruthy();
    expect(screen.getByText(/AIGC 办法（草案） 20.0%/)).toBeTruthy();
    expect(screen.getByLabelText("当前平台阈值 20.0%")).toBeTruthy();

    expect(screen.getByText("第二章 追猎")).toBeTruthy();
    expect(screen.getByText("30.0%")).toBeTruthy();
  });

  it("marks chapters above threshold and shows rewrite warning", () => {
    render(<AiRatioReport report={sampleReport} />);

    expect(screen.getByText("建议人工改写")).toBeTruthy();
    expect(screen.getByText("高于当前平台阈值")).toBeTruthy();
    expect(screen.getByText(/基于 AI 味特征分数的粗略估算/)).toBeTruthy();
  });
});
