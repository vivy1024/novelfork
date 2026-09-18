/**
 * 张力曲线条（故事推进网格的顶部带）。
 *
 * 与 `TensionCurvePanel` 的分工：
 *  - TensionCurvePanel 是独立面板，自己拉数据、CSS 竖条、带告警，答「节奏是否崩了」
 *  - 本组件不拉数据，直接吃 story-progress-board 已算好的章节列，只做「当前进度 + 起伏」的一眼概览
 *
 * 视觉：平滑折线 + 渐变面积（高张力段更暖），当前章竖线标记。
 * 未评张力的章**不连线**（诚实断开），不插值伪造曲线。
 * 纯 SVG，无图表库依赖。
 */

import { useMemo } from "react";
import { Activity } from "lucide-react";

import type { StoryProgressChapterColumn } from "./story-progress-board";

export interface TensionCurveStripProps {
  readonly chapters: readonly StoryProgressChapterColumn[];
  readonly currentChapter: number;
  readonly onJumpToChapter?: (chapterNumber: number) => void;
}

const HEIGHT = 56;
const MAX_SCORE = 10;
/** 高张力阈值：达到即视觉「发烫」。 */
const HOT_SCORE = 8;

interface Point {
  readonly chapterNumber: number;
  readonly score: number;
  readonly x: number;
  readonly y: number;
}

/** 把连续有分的章切成若干段：缺分处断开，不跨空隙连线。 */
function buildSegments(points: readonly Point[], chapterNumbers: readonly number[]): Point[][] {
  const indexByChapter = new Map(chapterNumbers.map((chapter, index) => [chapter, index]));
  const segments: Point[][] = [];
  let current: Point[] = [];
  let previousIndex: number | undefined;
  for (const point of points) {
    const index = indexByChapter.get(point.chapterNumber);
    if (previousIndex !== undefined && index !== undefined && index !== previousIndex + 1) {
      if (current.length > 0) segments.push(current);
      current = [];
    }
    current.push(point);
    previousIndex = index;
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

function toPath(points: readonly Point[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) {
    const only = points[0]!;
    // 单点画一小段水平线，否则 SVG 什么都不显示
    return `M ${only.x - 2} ${only.y} L ${only.x + 2} ${only.y}`;
  }
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

export function TensionCurveStrip({ chapters, currentChapter, onJumpToChapter }: TensionCurveStripProps) {
  const model = useMemo(() => {
    const scored = chapters.filter((column) => column.tensionScore !== undefined);
    const width = Math.max(chapters.length, 1) * 24;
    const step = chapters.length > 1 ? width / (chapters.length - 1) : width;
    const xOf = (chapterNumber: number): number => {
      const index = chapters.findIndex((column) => column.chapterNumber === chapterNumber);
      return index < 0 ? 0 : index * step;
    };
    const points: Point[] = scored.map((column) => {
      const score = Math.min(MAX_SCORE, Math.max(0, column.tensionScore!));
      return {
        chapterNumber: column.chapterNumber,
        score,
        x: xOf(column.chapterNumber),
        // 上边距 8 / 下边距 12，给峰值和刻度留白
        y: 8 + (1 - score / MAX_SCORE) * (HEIGHT - 20),
      };
    });
    return {
      width,
      points,
      segments: buildSegments(points, chapters.map((column) => column.chapterNumber)),
      scoredCount: scored.length,
      currentX: xOf(currentChapter),
      hasCurrent: chapters.some((column) => column.chapterNumber === currentChapter),
    };
  }, [chapters, currentChapter]);

  if (chapters.length === 0) return null;

  return (
    <div className="shrink-0 rounded-lg border px-2 py-1.5" data-testid="tension-curve-strip">
      <div className="flex items-center gap-2">
        <Activity className="size-3 text-muted-foreground" />
        <span className="text-2xs font-medium text-muted-foreground">张力曲线</span>
        <span className="text-2xs text-muted-foreground">
          {model.scoredCount > 0
            ? `${model.scoredCount}/${chapters.length} 章已评分`
            : "还没有章节评过张力"}
        </span>
      </div>

      {model.scoredCount === 0 ? (
        // 没有分就明说，不画一条假曲线
        <p className="px-1 py-2 text-2xs text-muted-foreground" data-testid="tension-curve-strip-empty">
          章节摘要里没有张力分（`tension_score`），这条曲线暂时画不出来。跑过章后结算评分后会出现。
        </p>
      ) : (
        <div className="mt-1 overflow-x-auto">
          <svg
            width={model.width}
            height={HEIGHT}
            viewBox={`0 0 ${model.width} ${HEIGHT}`}
            className="block"
            role="img"
            aria-label="按章节的张力曲线"
          >
            <defs>
              <linearGradient id="tension-strip-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f7768e" stopOpacity="0.28" />
                <stop offset="100%" stopColor="#7aa2f7" stopOpacity="0.04" />
              </linearGradient>
            </defs>

            {/* 高张力参考线（8 分） */}
            <line
              x1={0}
              x2={model.width}
              y1={8 + (1 - HOT_SCORE / MAX_SCORE) * (HEIGHT - 20)}
              y2={8 + (1 - HOT_SCORE / MAX_SCORE) * (HEIGHT - 20)}
              stroke="rgba(148,163,184,0.35)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />

            {model.segments.map((segment, index) => {
              const path = toPath(segment);
              const first = segment[0]!;
              const last = segment[segment.length - 1]!;
              return (
                <g key={`segment-${index}`}>
                  {segment.length > 1 ? (
                    <path
                      d={`${path} L ${last.x} ${HEIGHT - 12} L ${first.x} ${HEIGHT - 12} Z`}
                      fill="url(#tension-strip-fill)"
                    />
                  ) : null}
                  <path d={path} fill="none" stroke="#f7768e" strokeWidth={1.5} strokeLinecap="round" />
                </g>
              );
            })}

            {model.points.map((point) => (
              <circle
                key={point.chapterNumber}
                cx={point.x}
                cy={point.y}
                r={point.score >= HOT_SCORE ? 3 : 2}
                fill={point.score >= HOT_SCORE ? "#f7768e" : "#7aa2f7"}
                className={onJumpToChapter ? "cursor-pointer" : undefined}
                onClick={onJumpToChapter ? () => onJumpToChapter(point.chapterNumber) : undefined}
              >
                <title>{`第 ${point.chapterNumber} 章 · 张力 ${point.score}/10`}</title>
              </circle>
            ))}

            {model.hasCurrent ? (
              <g data-testid="tension-curve-strip-current">
                <line
                  x1={model.currentX}
                  x2={model.currentX}
                  y1={4}
                  y2={HEIGHT - 12}
                  stroke="rgba(16,185,129,0.55)"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
                <text x={model.currentX} y={HEIGHT - 2} textAnchor="middle" fontSize={8} fill="rgba(16,185,129,0.9)">
                  第{currentChapter}章
                </text>
              </g>
            ) : null}
          </svg>
        </div>
      )}
    </div>
  );
}

export default TensionCurveStrip;
