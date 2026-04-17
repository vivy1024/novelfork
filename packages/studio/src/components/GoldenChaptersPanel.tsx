/**
 * GoldenChaptersPanel — 黄金三章检测面板
 * 显示前 3 章的节奏密度、冲突设置、悬念布局和留人点分析
 */

import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle, TrendingUp, Zap, Eye, BookOpen } from "lucide-react";

interface Hook {
  readonly position: number;
  readonly type: "conflict" | "mystery" | "worldview" | "character";
  readonly description: string;
  readonly strength: "strong" | "medium" | "weak";
}

interface Issue {
  readonly severity: "error" | "warning";
  readonly category: string;
  readonly description: string;
  readonly suggestion: string;
}

interface ChapterAnalysis {
  readonly chapterNumber: number;
  readonly score: number;
  readonly density: {
    readonly conflict: number;
    readonly mystery: number;
    readonly info: number;
  };
  readonly issues: ReadonlyArray<Issue>;
  readonly hooks: ReadonlyArray<Hook>;
}

interface GoldenChaptersResult {
  readonly overallScore: number;
  readonly chapters: ReadonlyArray<ChapterAnalysis>;
  readonly criticalIssues: ReadonlyArray<Issue>;
}

interface GoldenChaptersPanelProps {
  readonly bookId: string;
}

export function GoldenChaptersPanel({ bookId }: GoldenChaptersPanelProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GoldenChaptersResult | null>(null);

  useEffect(() => {
    async function fetchAnalysis() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/golden-chapters/${bookId}`);
        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "分析失败");
        }
        const data = await response.json();
        setResult(data.result);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    }

    fetchAnalysis();
  }, [bookId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground">正在分析黄金三章...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-destructive flex items-center gap-2">
          <AlertCircle size={20} />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground">暂无分析结果</div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      {/* 总体评分 */}
      <div className="bg-card border border-border rounded-lg p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">黄金三章总评</h2>
            <p className="text-sm text-muted-foreground mt-1">
              前 3 章是决定读者去留的关键，必须在 6000 字内设置足够的留人点
            </p>
          </div>
          <div className="text-right">
            <div className={`text-5xl font-bold ${getScoreColor(result.overallScore)}`}>
              {result.overallScore}
            </div>
            <div className="text-sm text-muted-foreground mt-1">综合评分</div>
          </div>
        </div>

        {/* 评分等级说明 */}
        <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
          <span className="text-green-500">90+ 优秀</span>
          <span className="text-blue-500">75-89 良好</span>
          <span className="text-yellow-500">60-74 及格</span>
          <span className="text-red-500">&lt;60 需改进</span>
        </div>
      </div>

      {/* 关键问题 */}
      {result.criticalIssues.length > 0 && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle size={20} className="text-destructive" />
            <h3 className="font-semibold text-destructive">关键问题 ({result.criticalIssues.length})</h3>
          </div>
          <div className="space-y-2">
            {result.criticalIssues.map((issue, idx) => (
              <div key={idx} className="bg-background/50 rounded p-3 space-y-1">
                <div className="font-medium text-sm">[{issue.category}] {issue.description}</div>
                <div className="text-xs text-muted-foreground">💡 {issue.suggestion}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 各章分析 */}
      <div className="space-y-4">
        {result.chapters.map((chapter) => (
          <ChapterCard key={chapter.chapterNumber} chapter={chapter} />
        ))}
      </div>
    </div>
  );
}

function ChapterCard({ chapter }: { chapter: ChapterAnalysis }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      {/* 章节头部 */}
      <div
        className="p-4 cursor-pointer hover:bg-accent/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BookOpen size={20} className="text-primary" />
            <div>
              <h3 className="font-semibold">第 {chapter.chapterNumber} 章</h3>
              <p className="text-xs text-muted-foreground">
                {getChapterFocus(chapter.chapterNumber)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {/* 密度指标 */}
            <div className="flex items-center gap-3 text-xs">
              <DensityBadge label="冲突" value={chapter.density.conflict} icon={<Zap size={12} />} />
              <DensityBadge label="悬念" value={chapter.density.mystery} icon={<Eye size={12} />} />
              <DensityBadge label="信息" value={chapter.density.info} icon={<TrendingUp size={12} />} />
            </div>
            {/* 评分 */}
            <div className={`text-2xl font-bold ${getScoreColor(chapter.score)}`}>
              {chapter.score}
            </div>
          </div>
        </div>
      </div>

      {/* 展开内容 */}
      {expanded && (
        <div className="border-t border-border p-4 space-y-4 bg-accent/20">
          {/* 留人点 */}
          {chapter.hooks.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <CheckCircle size={16} className="text-green-500" />
                留人点 ({chapter.hooks.length})
              </h4>
              <div className="space-y-1">
                {chapter.hooks.slice(0, 5).map((hook, idx) => (
                  <div
                    key={idx}
                    className="text-xs bg-background/50 rounded px-2 py-1 flex items-center gap-2"
                  >
                    <span className={`font-medium ${getHookColor(hook.strength)}`}>
                      {getHookStrengthLabel(hook.strength)}
                    </span>
                    <span className="text-muted-foreground">{hook.description}</span>
                    <span className="text-muted-foreground/60 ml-auto">
                      位置: {hook.position}
                    </span>
                  </div>
                ))}
                {chapter.hooks.length > 5 && (
                  <div className="text-xs text-muted-foreground">
                    还有 {chapter.hooks.length - 5} 个留人点...
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 问题列表 */}
          {chapter.issues.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <AlertCircle size={16} className="text-yellow-500" />
                问题 ({chapter.issues.length})
              </h4>
              <div className="space-y-2">
                {chapter.issues.map((issue, idx) => (
                  <div
                    key={idx}
                    className={`text-xs rounded p-2 ${
                      issue.severity === "error"
                        ? "bg-destructive/10 border border-destructive/30"
                        : "bg-yellow-500/10 border border-yellow-500/30"
                    }`}
                  >
                    <div className="font-medium">
                      [{issue.category}] {issue.description}
                    </div>
                    <div className="text-muted-foreground mt-1">💡 {issue.suggestion}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DensityBadge({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1">
      {icon}
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-semibold ${getDensityColor(value)}`}>{value}</span>
    </div>
  );
}

// --- 辅助函数 ---

function getScoreColor(score: number): string {
  if (score >= 90) return "text-green-500";
  if (score >= 75) return "text-blue-500";
  if (score >= 60) return "text-yellow-500";
  return "text-red-500";
}

function getDensityColor(density: number): string {
  if (density >= 50) return "text-green-500";
  if (density >= 30) return "text-blue-500";
  if (density >= 15) return "text-yellow-500";
  return "text-red-500";
}

function getHookColor(strength: string): string {
  if (strength === "strong") return "text-green-500";
  if (strength === "medium") return "text-blue-500";
  return "text-yellow-500";
}

function getHookStrengthLabel(strength: string): string {
  if (strength === "strong") return "强";
  if (strength === "medium") return "中";
  return "弱";
}

function getChapterFocus(chapterNumber: number): string {
  if (chapterNumber === 1) return "开局冲突 + 世界观展示";
  if (chapterNumber === 2) return "主线推进 + 角色塑造";
  if (chapterNumber === 3) return "悬念设置 + 留人点";
  return "";
}
