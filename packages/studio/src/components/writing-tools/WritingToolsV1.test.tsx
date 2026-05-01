import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { useApiMock } = vi.hoisted(() => ({
  useApiMock: vi.fn(),
}));

vi.mock("@/hooks/use-api", () => ({
  useApi: (...args: unknown[]) => useApiMock(...args),
  fetchJson: vi.fn(),
}));

import { BookHealthDashboard } from "./BookHealthDashboard";
import { ConflictMap } from "./ConflictMap";
import { CharacterArcDashboard } from "./CharacterArcDashboard";
import { ToneDriftAlert } from "./ToneDriftAlert";

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  useApiMock.mockReset();
});

describe("BookHealthDashboard", () => {
  it("renders loading state", () => {
    useApiMock.mockReturnValue({ data: null, loading: true, error: null });
    render(<BookHealthDashboard bookId="book-1" />);
    expect(screen.getByText("正在加载全书健康数据...")).toBeTruthy();
  });

  it("renders measured health facts and unknown metric placeholders", () => {
    useApiMock.mockReturnValue({
      data: {
        health: {
          totalChapters: { status: "measured", value: 3, source: "chapter-files" },
          totalWords: { status: "measured", value: 9800, source: "chapter-files" },
          dailyWords: { status: "measured", value: 3000, source: "writing-log" },
          dailyTarget: { status: "measured", value: 6000, source: "progress-config" },
          sensitiveWordCount: { status: "measured", value: 3, source: "sensitive-word-scan" },
          knownConflictCount: { status: "measured", value: 1, source: "bible-conflicts" },
          consistencyScore: { status: "unknown", reason: "连续性审计汇总尚未接入真实来源" },
          hookRecoveryRate: { status: "unknown", reason: "钩子回收率尚未接入真实来源" },
          aiTasteMean: { status: "unknown", reason: "AI 味均值尚未接入真实来源" },
          rhythmDiversity: { status: "unknown", reason: "节奏多样性尚未接入真实来源" },
          warnings: [{ type: "敏感词", message: "检测到 3 处敏感词命中" }],
        },
      },
      loading: false,
      error: null,
    });
    render(<BookHealthDashboard bookId="book-1" />);

    expect(screen.getByText("全书健康仪表盘")).toBeTruthy();
    expect(screen.getByText("3 章")).toBeTruthy();
    expect(screen.getByText("9800 字")).toBeTruthy();
    expect(screen.getAllByText("待评估").length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText(/连续性审计汇总等待统计数据/)).toBeTruthy();
    expect(screen.queryByText(/未接入|尚未接入/)).toBeNull();
    expect(screen.getByText("检测到 3 处敏感词命中")).toBeTruthy();
  });

  it("shows transparent unknown hint when quality metrics are not wired", () => {
    useApiMock.mockReturnValue({
      data: {
        health: {
          totalChapters: { status: "measured", value: 1, source: "chapter-files" },
          totalWords: { status: "measured", value: 3000, source: "chapter-files" },
          dailyWords: { status: "measured", value: 0, source: "writing-log" },
          dailyTarget: { status: "measured", value: 6000, source: "progress-config" },
          sensitiveWordCount: { status: "measured", value: 0, source: "sensitive-word-scan" },
          knownConflictCount: { status: "measured", value: 0, source: "bible-conflicts" },
          consistencyScore: { status: "unknown", reason: "连续性审计汇总尚未接入真实来源" },
          hookRecoveryRate: { status: "unknown", reason: "钩子回收率尚未接入真实来源" },
          aiTasteMean: { status: "unknown", reason: "AI 味均值尚未接入真实来源" },
          rhythmDiversity: { status: "unknown", reason: "节奏多样性尚未接入真实来源" },
          warnings: [],
        },
      },
      loading: false,
      error: null,
    });
    render(<BookHealthDashboard bookId="book-1" />);

    expect(screen.getByText(/质量评分等待统计数据/)).toBeTruthy();
    expect(screen.queryByText(/未接入|尚未接入/)).toBeNull();
  });
});

describe("ConflictMap", () => {
  it("renders loading state", () => {
    useApiMock.mockReturnValue({ data: null, loading: true, error: null });
    render(<ConflictMap bookId="book-1" />);
    expect(screen.getByText("正在加载矛盾地图...")).toBeTruthy();
  });

  it("renders conflicts with rank icons and expands details", () => {
    useApiMock.mockReturnValue({
      data: {
        conflicts: [
          {
            id: "c1", name: "正邪对抗", rank: "primary", nature: "antagonistic",
            status: "激化中", controllingIdea: "正义终将胜利",
            transformations: [{ chapter: 3, description: "首次正面冲突" }],
          },
          {
            id: "c2", name: "师徒分歧", rank: "secondary", nature: "non-antagonistic",
            status: "潜伏", transformations: [],
          },
        ],
        driftWarning: { message: "主线矛盾偏移" },
      },
      loading: false,
      error: null,
    });
    render(<ConflictMap bookId="book-1" />);

    expect(screen.getByText("矛盾地图")).toBeTruthy();
    expect(screen.getByText("正邪对抗")).toBeTruthy();
    expect(screen.getByText("师徒分歧")).toBeTruthy();
    expect(screen.getByText("主线矛盾偏移")).toBeTruthy();

    fireEvent.click(screen.getByText("正邪对抗"));
    expect(screen.getByText((_content, element) => element?.textContent === "控制理念：正义终将胜利")).toBeTruthy();
    expect(screen.getByText("首次正面冲突")).toBeTruthy();
  });
});

describe("CharacterArcDashboard", () => {
  it("renders loading state", () => {
    useApiMock.mockReturnValue({ data: null, loading: true, error: null });
    render(<CharacterArcDashboard bookId="book-1" />);
    expect(screen.getByText("正在加载角色弧线...")).toBeTruthy();
  });

  it("renders arcs with progress and expands beat timeline", () => {
    useApiMock.mockReturnValue({
      data: {
        arcs: [{
          characterId: "char-1", characterName: "林月", arcType: "成长型",
          startState: "懵懂少女", endState: "独当一面",
          beats: [
            { chapter: 1, description: "初入江湖", direction: "advance" },
            { chapter: 5, description: "遭遇挫折", direction: "regression" },
          ],
          warnings: ["第8章后弧线停滞"],
        }],
      },
      loading: false,
      error: null,
    });
    render(<CharacterArcDashboard bookId="book-1" />);

    expect(screen.getByText("角色弧线仪表盘")).toBeTruthy();
    expect(screen.getByText("林月")).toBeTruthy();
    expect(screen.getByText("成长型")).toBeTruthy();

    fireEvent.click(screen.getByText("林月"));
    expect(screen.getByText("初入江湖")).toBeTruthy();
    expect(screen.getByText("遭遇挫折")).toBeTruthy();
    expect(screen.getByText("第8章后弧线停滞")).toBeTruthy();
  });
});

describe("ToneDriftAlert", () => {
  it("returns null when drift is not significant", () => {
    useApiMock.mockReturnValue({
      data: { overallDrift: 0.05, isSignificant: false, consecutiveDriftChapters: 0, declaredTone: "热血" },
      loading: false,
      error: null,
    });
    const { container } = render(<ToneDriftAlert bookId="book-1" chapterNumber={5} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders drift alert with update hint when >= 3 consecutive chapters", () => {
    useApiMock.mockReturnValue({
      data: { overallDrift: 0.65, isSignificant: true, consecutiveDriftChapters: 4, declaredTone: "热血" },
      loading: false,
      error: null,
    });
    render(<ToneDriftAlert bookId="book-1" chapterNumber={10} />);

    expect(screen.getByText("文风偏离检测")).toBeTruthy();
    expect(screen.getByText("严重偏离")).toBeTruthy();
    expect(screen.getByText(/是否考虑更新基调声明/)).toBeTruthy();
  });
});
