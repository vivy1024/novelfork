/**
 * RhythmChart — Tab 3: 节奏波形图
 * 实现 3+1 节奏公式可视化和张弛度曲线
 */

import { useEffect, useState } from "react";
import { Activity, TrendingUp, AlertTriangle, Zap } from "lucide-react";

interface RhythmChartProps {
  readonly bookId: string;
}

interface TensionMetrics {
  readonly conflictDensity: number;
  readonly emotionalIntensity: number;
  readonly informationLoad: number;
}

interface ChapterTension {
  readonly chapterNumber: number;
  readonly tension: number;
  readonly type: "high" | "transition" | "climax";
  readonly metrics: TensionMetrics;
}

interface RhythmPattern {
  readonly isValid: boolean;
  readonly violations: ReadonlyArray<string>;
  readonly score: number;
}

interface RhythmWarning {
  readonly type: "consecutive-high" | "rhythm-cliff" | "missing-climax";
  readonly chapterRange: [number, number];
  readonly message: string;
  readonly severity: "low" | "medium" | "high";
}

interface RhythmAnalysis {
  readonly chapters: ReadonlyArray<ChapterTension>;
  readonly pattern: RhythmPattern;
  readonly warnings: ReadonlyArray<RhythmWarning>;
  readonly climaxPoints: ReadonlyArray<number>;
}

export function RhythmChart({ bookId }: RhythmChartProps) {
  const [data, setData] = useState<RhythmAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchRhythmData() {
      try {
        setLoading(true);
        const response = await fetch(`/api/rhythm/${bookId}`);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const result = await response.json();
        setData(result);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "加载失败");
      } finally {
        setLoading(false);
      }
    }

    fetchRhythmData();
  }, [bookId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Activity className="animate-spin text-primary" size={32} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <AlertTriangle size={32} className="mb-2" />
        <p>加载节奏数据失败: {error}</p>
      </div>
    );
  }

  if (data.chapters.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <Activity size={32} className="mb-2 opacity-40" />
        <p>暂无章节数据</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full p-4 space-y-4 overflow-y-auto">
      {/* 节奏评分卡片 */}
      <div className="grid grid-cols-3 gap-4">
        <MetricCard
          icon={<TrendingUp size={20} />}
          label="节奏评分"
          value={`${data.pattern.score}/100`}
          color={data.pattern.score >= 70 ? "text-green-500" : data.pattern.score >= 50 ? "text-yellow-500" : "text-red-500"}
        />
        <MetricCard
          icon={<Activity size={20} />}
          label="章节数"
          value={data.chapters.length.toString()}
          color="text-blue-500"
        />
        <MetricCard
          icon={<Zap size={20} />}
          label="高潮点"
          value={data.climaxPoints.length.toString()}
          color="text-purple-500"
        />
      </div>

      {/* 警告列表 */}
      {data.warnings.length > 0 && (
        <div className="border border-yellow-500/30 rounded-lg p-3 bg-yellow-500/5">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={16} className="text-yellow-500" />
            <span className="text-sm font-medium">节奏警告 ({data.warnings.length})</span>
          </div>
          <div className="space-y-1">
            {data.warnings.map((warning, idx) => (
              <div key={idx} className="text-xs text-muted-foreground">
                <span className={`font-medium ${
                  warning.severity === "high" ? "text-red-500" :
                  warning.severity === "medium" ? "text-yellow-500" :
                  "text-blue-500"
                }`}>
                  [{warning.severity.toUpperCase()}]
                </span>{" "}
                第 {warning.chapterRange[0]}-{warning.chapterRange[1]} 章: {warning.message}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 波形图 */}
      <div className="border border-border rounded-lg p-4 bg-secondary/20">
        <h3 className="text-sm font-medium mb-3">张弛度曲线</h3>
        <WaveformChart chapters={data.chapters} climaxPoints={data.climaxPoints} />
      </div>

      {/* 3+1 模式检测 */}
      <div className="border border-border rounded-lg p-4 bg-secondary/20">
        <h3 className="text-sm font-medium mb-2">3+1 节奏模式</h3>
        <div className="text-xs text-muted-foreground space-y-1">
          <p>
            <span className={data.pattern.isValid ? "text-green-500" : "text-red-500"}>
              {data.pattern.isValid ? "✓ 符合" : "✗ 不符合"}
            </span>{" "}
            3+1 节奏公式（3 章紧张 + 1 章过渡）
          </p>
          {data.pattern.violations.length > 0 && (
            <div className="mt-2 space-y-1">
              {data.pattern.violations.map((v, idx) => (
                <p key={idx} className="text-yellow-600">• {v}</p>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  color
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="border border-border rounded-lg p-3 bg-secondary/20">
      <div className="flex items-center gap-2 mb-1">
        <div className={color}>{icon}</div>
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <div className={`text-xl font-bold ${color}`}>{value}</div>
    </div>
  );
}

function WaveformChart({
  chapters,
  climaxPoints
}: {
  chapters: ReadonlyArray<ChapterTension>;
  climaxPoints: ReadonlyArray<number>;
}) {
  const maxTension = Math.max(...chapters.map(c => c.tension), 100);
  const width = Math.max(800, chapters.length * 20);
  const height = 200;
  const padding = { top: 20, right: 20, bottom: 30, left: 40 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // 生成路径
  const points = chapters.map((ch, idx) => {
    const x = padding.left + (idx / (chapters.length - 1)) * chartWidth;
    const y = padding.top + chartHeight - (ch.tension / maxTension) * chartHeight;
    return { x, y, chapter: ch };
  });

  const pathD = points.map((p, idx) =>
    `${idx === 0 ? "M" : "L"} ${p.x} ${p.y}`
  ).join(" ");

  return (
    <div className="overflow-x-auto">
      <svg width={width} height={height} className="text-foreground">
        {/* 网格线 */}
        {[0, 25, 50, 75, 100].map(val => {
          const y = padding.top + chartHeight - (val / maxTension) * chartHeight;
          return (
            <g key={val}>
              <line
                x1={padding.left}
                y1={y}
                x2={width - padding.right}
                y2={y}
                stroke="currentColor"
                strokeOpacity={0.1}
                strokeDasharray="2,2"
              />
              <text
                x={padding.left - 8}
                y={y + 4}
                fontSize={10}
                fill="currentColor"
                opacity={0.5}
                textAnchor="end"
              >
                {val}
              </text>
            </g>
          );
        })}

        {/* 高潮点标记 */}
        {climaxPoints.map(num => {
          const idx = chapters.findIndex(c => c.chapterNumber === num);
          if (idx === -1) return null;
          const point = points[idx];
          return (
            <g key={num}>
              <circle
                cx={point.x}
                cy={point.y}
                r={6}
                fill="rgb(168, 85, 247)"
                opacity={0.3}
              />
              <text
                x={point.x}
                y={padding.top - 5}
                fontSize={9}
                fill="rgb(168, 85, 247)"
                textAnchor="middle"
              >
                ★
              </text>
            </g>
          );
        })}

        {/* 波形曲线 */}
        <path
          d={pathD}
          fill="none"
          stroke="rgb(59, 130, 246)"
          strokeWidth={2}
          strokeLinejoin="round"
        />

        {/* 数据点 */}
        {points.map((p, idx) => (
          <circle
            key={idx}
            cx={p.x}
            cy={p.y}
            r={3}
            fill={
              p.chapter.type === "climax" ? "rgb(168, 85, 247)" :
              p.chapter.type === "high" ? "rgb(59, 130, 246)" :
              "rgb(34, 197, 94)"
            }
          />
        ))}

        {/* X 轴标签 */}
        {chapters.filter((_, idx) => idx % Math.ceil(chapters.length / 10) === 0).map((ch, idx) => {
          const point = points[chapters.indexOf(ch)];
          return (
            <text
              key={idx}
              x={point.x}
              y={height - 10}
              fontSize={10}
              fill="currentColor"
              opacity={0.5}
              textAnchor="middle"
            >
              {ch.chapterNumber}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

