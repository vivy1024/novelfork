import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchJsonMock } = vi.hoisted(() => ({
  fetchJsonMock: vi.fn(),
}));

vi.mock("@/hooks/use-api", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import { ChapterHookGenerator } from "./ChapterHookGenerator";
import { DailyProgressTracker } from "./DailyProgressTracker";
import { DialogueAnalysis } from "./DialogueAnalysis";
import { PovDashboard } from "./PovDashboard";
import { RhythmChart } from "./RhythmChart";

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  fetchJsonMock.mockReset();
});

describe("RhythmChart", () => {
  it("renders sentence and paragraph rhythm and highlights bucket ranges", () => {
    const onHighlightRanges = vi.fn();

    render(
      <RhythmChart
        analysis={{
          sentenceLengths: [8, 12, 14, 28],
          sentenceHistogram: [
            { range: "6-10", count: 1 },
            { range: "11-15", count: 2 },
            { range: "26-30", count: 1 },
          ],
          paragraphLengths: [120, 260, 180],
          avgSentenceLength: 15.5,
          sentenceLengthStdDev: 2.1,
          rhythmScore: 42,
          issues: [{ type: "uniform-length", message: "节奏过于均匀", affectedRanges: [{ start: 10, end: 30 }] }],
          sentenceRanges: [
            { text: "短句。", length: 8, start: 0, end: 8, bucket: "6-10" },
            { text: "中等句一。", length: 12, start: 9, end: 21, bucket: "11-15" },
            { text: "中等句二。", length: 14, start: 22, end: 36, bucket: "11-15" },
          ],
          referenceComparison: { refAvgSentenceLength: 19, refStdDev: 7.5, deviation: 0.18 },
        }}
        referenceHistogram={[{ range: "11-15", count: 1 }, { range: "26-30", count: 2 }]}
        onHighlightRanges={onHighlightRanges}
      />,
    );

    expect(screen.getByText("段落节奏可视化")).toBeTruthy();
    expect(screen.getByText("节奏评分 42")).toBeTruthy();
    expect(screen.getByText("平均句长 15.5 字")).toBeTruthy();
    expect(screen.getByText("参考均值 19 字 / 标准差 7.5")).toBeTruthy();
    expect(screen.getByText("节奏过于均匀")).toBeTruthy();
    expect(screen.getByText("段落长度序列")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "句长区间 11-15，共 2 句" }));
    expect(onHighlightRanges).toHaveBeenCalledWith([
      { start: 9, end: 21 },
      { start: 22, end: 36 },
    ]);
  });
});

describe("DialogueAnalysis", () => {
  it("renders dialogue ratio, reference range, health, and character distribution", () => {
    render(
      <DialogueAnalysis
        analysis={{
          totalWords: 1000,
          dialogueWords: 420,
          dialogueRatio: 0.42,
          chapterType: "daily",
          referenceRange: { min: 0.3, max: 0.5 },
          isHealthy: true,
          characterDialogue: [
            { name: "林月", wordCount: 260, lineCount: 6, ratio: 0.62 },
            { name: "沈舟", wordCount: 160, lineCount: 4, ratio: 0.38 },
          ],
          issues: [],
        }}
      />,
    );

    expect(screen.getByText("对话比例分析")).toBeTruthy();
    expect(screen.getByText("42.0%")).toBeTruthy();
    expect(screen.getByText("参考范围 30.0% - 50.0%"));
    expect(screen.getByText("健康")).toBeTruthy();
    expect(screen.getByText("林月")).toBeTruthy();
    expect(screen.getByText("260")).toBeTruthy();
  });

  it("shows issues when dialogue ratio is outside the reference range", () => {
    render(
      <DialogueAnalysis
        analysis={{
          totalWords: 1000,
          dialogueWords: 80,
          dialogueRatio: 0.08,
          chapterType: "battle",
          referenceRange: { min: 0.1, max: 0.25 },
          isHealthy: false,
          characterDialogue: [],
          issues: ["对话占比偏低，章节可能过于叙述化"],
        }}
      />,
    );

    expect(screen.getByText("需关注")).toBeTruthy();
    expect(screen.getByText("对话占比偏低，章节可能过于叙述化")).toBeTruthy();
  });
});

describe("ChapterHookGenerator", () => {
  it("generates hook options and applies the selected hook", async () => {
    const onApplyHook = vi.fn();
    fetchJsonMock.mockResolvedValueOnce({
      hooks: [
        { id: "hook-1", style: "suspense", text: "门外第三次响起脚步声。", rationale: "制造新问题", retentionEstimate: "high", relatedHookIds: ["old-hook"] },
        { id: "hook-2", style: "emotional", text: "她终于承认自己害怕。", rationale: "情绪推进", retentionEstimate: "medium" },
      ],
    });

    render(
      <ChapterHookGenerator
        bookId="book-1"
        chapterNumber={3}
        chapterContent="本章最后，林月合上旧账簿。"
        onApplyHook={onApplyHook}
      />,
    );

    fireEvent.change(screen.getByLabelText("下一章意图"), { target: { value: "追查脚步声" } });
    fireEvent.click(screen.getByRole("button", { name: "生成章末钩子" }));

    await waitFor(() => {
      expect(fetchJsonMock).toHaveBeenCalledWith("/books/book-1/hooks/generate", expect.objectContaining({ method: "POST" }));
    });
    expect(JSON.parse(fetchJsonMock.mock.calls[0][1].body)).toMatchObject({
      chapterNumber: 3,
      chapterContent: "本章最后，林月合上旧账簿。",
      nextChapterIntent: "追查脚步声",
    });
    expect(await screen.findByText("门外第三次响起脚步声。")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("选择钩子 门外第三次响起脚步声。"));
    fireEvent.click(screen.getByRole("button", { name: "插入所选钩子" }));

    expect(onApplyHook).toHaveBeenCalledWith(expect.objectContaining({ id: "hook-1", text: "门外第三次响起脚步声。" }));
  });

  it("shows model configuration guidance when hook generation is gated", async () => {
    fetchJsonMock.mockRejectedValueOnce(Object.assign(new Error("409 Conflict"), { status: 409 }));

    render(<ChapterHookGenerator bookId="book-1" chapterNumber={3} chapterContent="正文" onApplyHook={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "生成章末钩子" }));

    expect(await screen.findByText("此功能需要配置 AI 模型")).toBeTruthy();
  });
});

describe("PovDashboard", () => {
  it("renders POV characters, gap warnings, and suggestions", () => {
    render(
      <PovDashboard
        dashboard={{
          currentChapter: 18,
          characters: [
            { name: "林月", totalChapters: 8, lastAppearanceChapter: 17, gapSinceLastAppearance: 1, chapterNumbers: [1, 3, 5, 8, 11, 13, 15, 17] },
            { name: "沈舟", totalChapters: 3, lastAppearanceChapter: 6, gapSinceLastAppearance: 12, chapterNumbers: [2, 4, 6] },
          ],
          warnings: [{ characterName: "沈舟", gapChapters: 12, message: "沈舟 已 12 章未出现" }],
          suggestion: { recommendedPov: "沈舟", reason: "间隔最长，适合回收支线" },
        }}
      />,
    );

    expect(screen.getByText("POV 视角仪表盘")).toBeTruthy();
    expect(screen.getByText("沈舟 已 12 章未出现")).toBeTruthy();
    expect(screen.getByText("建议下一章 POV：沈舟")).toBeTruthy();
    expect(screen.getByText("8")).toBeTruthy();
  });

  it("does not render for single POV books", () => {
    const { container } = render(
      <PovDashboard
        dashboard={{
          currentChapter: 5,
          characters: [{ name: "林月", totalChapters: 5, lastAppearanceChapter: 5, gapSinceLastAppearance: 0, chapterNumbers: [1, 2, 3, 4, 5] }],
          warnings: [],
        }}
      />,
    );

    expect(container.firstChild).toBeNull();
  });
});

describe("DailyProgressTracker", () => {
  it("loads progress, renders trend and persists target changes", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({
        config: { dailyTarget: 6000, weeklyTarget: 42000 },
        progress: {
          today: { written: 4800, target: 6000, completed: false },
          thisWeek: { written: 18000, target: 42000 },
          streak: 3,
          last30Days: [{ date: "2026-04-25", wordCount: 6200 }, { date: "2026-04-26", wordCount: 4800 }],
          estimatedCompletionDate: "2026-06-01",
        },
        trend: [{ date: "2026-04-25", wordCount: 6200 }, { date: "2026-04-26", wordCount: 4800 }],
      })
      .mockResolvedValueOnce({ config: { dailyTarget: 7000, weeklyTarget: 42000 } })
      .mockResolvedValueOnce({
        config: { dailyTarget: 7000, weeklyTarget: 42000 },
        progress: {
          today: { written: 4800, target: 7000, completed: false },
          thisWeek: { written: 18000, target: 42000 },
          streak: 3,
          last30Days: [],
          estimatedCompletionDate: "2026-06-01",
        },
        trend: [],
      });

    render(<DailyProgressTracker />);

    expect(await screen.findByText("日更进度追踪")).toBeTruthy();
    expect(screen.getByText("4,800 / 6,000 字")).toBeTruthy();
    expect(screen.getByText("连续达标 3 天")).toBeTruthy();
    expect(screen.getByText("预计完成 2026-06-01")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("日更目标"), { target: { value: "7000" } });
    fireEvent.click(screen.getByRole("button", { name: "保存目标" }));

    await waitFor(() => {
      expect(fetchJsonMock).toHaveBeenCalledWith("/progress/config", expect.objectContaining({ method: "PUT" }));
    });
    expect(JSON.parse(fetchJsonMock.mock.calls[1][1].body)).toMatchObject({ dailyTarget: 7000, weeklyTarget: 42000 });
    await waitFor(() => {
      expect(fetchJsonMock).toHaveBeenCalledWith("/progress");
    });
  });
});
