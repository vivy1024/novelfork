/**
 * PoisonDetectorPanel — Web novel toxic pattern detector.
 * Displays detected poison points with severity, description, and suggestions.
 */

import { useState, useEffect, useCallback } from "react";
import { X, AlertTriangle, AlertCircle, Info, Shield } from "lucide-react";
import { fetchJson } from "../hooks/use-api";

interface Poison {
  readonly rule: string;
  readonly severity: "error" | "warning";
  readonly description: string;
  readonly suggestion: string;
}

interface PoisonDetectionResponse {
  readonly poisons: ReadonlyArray<Poison>;
  readonly severity: "low" | "medium" | "high";
  readonly score: number;
}

interface PoisonDetectorPanelProps {
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly visible: boolean;
  readonly onClose: () => void;
}

function severityColor(severity: "low" | "medium" | "high"): string {
  switch (severity) {
    case "high":
      return "bg-red-500";
    case "medium":
      return "bg-amber-500";
    case "low":
      return "bg-emerald-500";
  }
}

function severityTextColor(severity: "low" | "medium" | "high"): string {
  switch (severity) {
    case "high":
      return "text-red-600";
    case "medium":
      return "text-amber-600";
    case "low":
      return "text-emerald-600";
  }
}

function severityLabel(severity: "low" | "medium" | "high"): string {
  switch (severity) {
    case "high":
      return "高风险";
    case "medium":
      return "中风险";
    case "low":
      return "低风险";
  }
}

function PoisonIcon({ severity }: { severity: "error" | "warning" }) {
  if (severity === "error") {
    return <AlertTriangle size={16} className="text-red-500" />;
  }
  return <AlertCircle size={16} className="text-amber-500" />;
}

export function PoisonDetectorPanel({
  bookId,
  chapterNumber,
  visible,
  onClose,
}: PoisonDetectorPanelProps) {
  const [poisons, setPoisons] = useState<ReadonlyArray<Poison>>([]);
  const [severity, setSeverity] = useState<"low" | "medium" | "high">("low");
  const [score, setScore] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedRules, setExpandedRules] = useState<ReadonlySet<string>>(new Set());

  const detectPoisons = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJson<PoisonDetectionResponse>(
        `/api/books/${bookId}/chapters/${chapterNumber}/detect-poisons`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        },
      );
      setPoisons(data.poisons);
      setSeverity(data.severity);
      setScore(data.score);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [bookId, chapterNumber]);

  useEffect(() => {
    if (visible) {
      detectPoisons();
    }
  }, [visible, detectPoisons]);

  const toggleExpanded = (rule: string) => {
    setExpandedRules((prev) => {
      const next = new Set(prev);
      if (next.has(rule)) {
        next.delete(rule);
      } else {
        next.add(rule);
      }
      return next;
    });
  };

  if (!visible) return null;

  return (
    <div className="fixed top-0 right-0 z-50 h-full w-[400px] flex flex-col border-l border-border bg-background shadow-2xl animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
        <div className="flex items-center gap-2">
          <Shield size={16} className="text-primary" />
          <h2 className="text-sm font-bold text-foreground">毒点检测器</h2>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-all"
        >
          <X size={16} />
        </button>
      </div>

      {/* Score Bar */}
      {!loading && !error && (
        <div className="px-4 py-3 border-b border-border/30">
          <div className="flex items-center justify-between mb-2">
            <span className={`text-xs font-bold ${severityTextColor(severity)}`}>
              毒点评分: {score}/100
            </span>
            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${severityColor(severity)} text-white`}
            >
              {severityLabel(severity)}
            </span>
          </div>
          <div className="h-2 rounded-full bg-secondary overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${severityColor(severity)}`}
              style={{ width: `${Math.min(score, 100)}%` }}
            />
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">
            {poisons.length === 0
              ? "未检测到毒点，章节质量良好"
              : `检测到 ${poisons.length} 个潜在毒点`}
          </p>
        </div>
      )}

      {/* Poison List */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex flex-col items-center justify-center py-16 space-y-3">
            <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
            <span className="text-xs text-muted-foreground">检测中...</span>
          </div>
        )}

        {error && (
          <div className="m-4 p-3 rounded-xl bg-destructive/5 border border-destructive/20 text-xs text-destructive">
            {error}
          </div>
        )}

        {!loading && !error && poisons.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Shield size={32} className="mb-3 opacity-40 text-emerald-500" />
            <span className="text-sm font-medium text-emerald-600">章节质量良好</span>
            <span className="text-xs mt-1">未检测到毒点</span>
          </div>
        )}

        {!loading &&
          !error &&
          poisons.map((poison) => {
            const isExpanded = expandedRules.has(poison.rule);

            return (
              <div
                key={poison.rule}
                className="border-b border-border/30 hover:bg-secondary/30 transition-colors"
              >
                <button
                  onClick={() => toggleExpanded(poison.rule)}
                  className="w-full px-4 py-3 flex items-start gap-3 text-left"
                >
                  <PoisonIcon severity={poison.severity} />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold text-foreground">{poison.rule}</span>
                      <span
                        className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                          poison.severity === "error"
                            ? "bg-red-100 text-red-700"
                            : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {poison.severity === "error" ? "严重" : "警告"}
                      </span>
                    </div>

                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      {poison.description}
                    </p>
                  </div>
                </button>

                {/* Suggestion (expanded) */}
                {isExpanded && (
                  <div className="px-4 pb-3 pl-11">
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <Info size={12} className="text-blue-600" />
                        <span className="text-[10px] font-bold text-blue-700">修改建议</span>
                      </div>
                      <p className="text-[11px] text-blue-900 leading-relaxed">
                        {poison.suggestion}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
      </div>

      {/* Footer */}
      {!loading && !error && poisons.length > 0 && (
        <div className="px-4 py-3 border-t border-border/30 bg-secondary/20">
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            💡 提示：点击毒点条目查看详细修改建议。毒点检测基于确定性规则，零 LLM 成本。
          </p>
        </div>
      )}
    </div>
  );
}
