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

  it("renders health metrics and warnings", () => {
    useApiMock.mockReturnValue({
      data: {
        consistencyScore: 0.85,
        hookRecoveryRate: 0.72,
        aiTasteMean: 25,
        aiTasteTrend: [{ chapter: 1, score: 30 }, { chapter: 2, score: 25 }, { chapter: 3, score: 20 }, { chapter: 4, score: 28 }, { chapter: 5, score: 22 }],
        rhythmDiversity: 0.65,
        sensitiveWordCount: 3,
        warnings: [{ type: "consistency", message: "第3章与第1章设定冲突" }],
      },
      loading: false,
      error: null,
    });
    render(<BookHealthDashboard bookId="book-1" />);

    expect(screen.getByText("全书健康仪表盘")).toBeTruthy();
    expect(screen.getByText("85%")).toBeTruthy();
    expect(screen.getByText("第3章与第1章设定冲突")).toBeTruthy();
  });

  it("shows insufficient data hint when < 5 chapters", () => {
    useApiMock.mockReturnValue({
      data: {
        consistencyScore: 0.5,
        hookRecoveryRate: 0.5,
        aiTasteMean: 50,
        aiTasteTrend: [{ chapter: 1, score: 50 }],
        rhythmDiversity: 0.5,
        sensitiveWordCount: 0,
        warnings: [],
      },
      loading: false,
      error: null,
    });
    render(<BookHealthDashboard bookId="book-1" />);

    expect(screen.getByText(/数据不足/)).toBeTruthy();
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
