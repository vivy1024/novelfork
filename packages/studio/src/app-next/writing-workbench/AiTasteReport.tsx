import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle, Info, Loader2, Sparkles, Wrench } from "lucide-react";
import { postApi } from "../../hooks/use-api";

// ---------------------------------------------------------------------------
// Types (mirrors core FilterReport / RuleHit / SevenTacticSuggestion)
// ---------------------------------------------------------------------------

export type RuleSeverity = "low" | "medium" | "high";
export type AiTasteLevel = "clean" | "mild" | "moderate" | "severe";

export interface RuleSpan {
  start: number;
  end: number;
  matched: string;
}

export interface RuleHit {
  ruleId: string;
  name: string;
  severity: RuleSeverity;
  spans: RuleSpan[];
  suggestion?: string;
  weightContribution: number;
}

export interface FilterReport {
  aiTasteScore: number;
  level: AiTasteLevel;
  hits: RuleHit[];
  engineVersion: string;
  tokensAnalyzed: number;
  elapsedMs: number;
  pgiUsed: boolean;
}

export interface SevenTacticSuggestion {
  tacticId: number;
  name: string;
  type: string;
  template: string;
  ruleIds: string[];
}

// ---------------------------------------------------------------------------
// Score badge color mapping
// ---------------------------------------------------------------------------

function scoreBadgeClass(score: number): string {
  if (score < 30) return "bg-green-500/10 text-green-700 border-green-500/20";
  if (score < 50) return "bg-yellow-500/10 text-yellow-700 border-yellow-500/20";
  if (score <= 70) return "bg-orange-500/10 text-orange-700 border-orange-500/20";
  return "bg-red-500/10 text-red-700 border-red-500/20";
}

function levelLabel(level: AiTasteLevel): string {
  switch (level) {
    case "clean": return "干净";
    case "mild": return "轻微";
    case "moderate": return "中等";
    case "severe": return "严重";
  }
}

function severityLabel(severity: RuleSeverity): string {
  switch (severity) {
    case "low": return "低";
    case "medium": return "中";
    case "high": return "高";
  }
}

function severityBadgeClass(severity: RuleSeverity): string {
  switch (severity) {
    case "low": return "bg-blue-500/10 text-blue-700 border-blue-500/20";
    case "medium": return "bg-yellow-500/10 text-yellow-700 border-yellow-500/20";
    case "high": return "bg-red-500/10 text-red-700 border-red-500/20";
  }
}

// ---------------------------------------------------------------------------
// HitItem — single rule hit with rewrite suggestion support
// ---------------------------------------------------------------------------

interface HitItemProps {
  hit: RuleHit;
}

function HitItem({ hit }: HitItemProps) {
  const [suggestions, setSuggestions] = useState<SevenTacticSuggestion[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSuggestRewrite() {
    setLoading(true);
    setError(null);
    try {
      const res = await postApi<{ suggestions: SevenTacticSuggestion[] }>("/api/filter/suggest-rewrite", {
        ruleIds: [hit.ruleId],
      });
      setSuggestions(res.suggestions);
    } catch (e) {
      setError(e instanceof Error ? e.message : "获取建议失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-border p-3 space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Badge className={`text-[10px] ${severityBadgeClass(hit.severity)}`}>
            {severityLabel(hit.severity)}
          </Badge>
          <span className="text-xs font-medium truncate">{hit.name}</span>
          <span className="text-[10px] text-muted-foreground shrink-0">{hit.ruleId}</span>
        </div>
        <span className="text-[10px] text-muted-foreground shrink-0">{hit.spans.length} 处命中</span>
      </div>

      {/* Matched spans preview */}
      {hit.spans.length > 0 && (
        <div className="space-y-1">
          {hit.spans.slice(0, 3).map((span, i) => (
            <p key={i} className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1 line-clamp-2">
              &ldquo;{span.matched}&rdquo;
            </p>
          ))}
          {hit.spans.length > 3 && (
            <p className="text-[10px] text-muted-foreground">...还有 {hit.spans.length - 3} 处</p>
          )}
        </div>
      )}

      {/* Suggestion from rule itself */}
      {hit.suggestion && (
        <p className="text-xs text-blue-600 flex items-start gap-1">
          <Info className="size-3 mt-0.5 shrink-0" />
          {hit.suggestion}
        </p>
      )}

      {/* Rewrite button */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-[11px] px-2"
          disabled={loading}
          onClick={handleSuggestRewrite}
        >
          {loading ? <Loader2 className="size-3 animate-spin mr-1" /> : <Wrench className="size-3 mr-1" />}
          修复建议
        </Button>
        {error && <span className="text-[10px] text-destructive">{error}</span>}
      </div>

      {/* Suggestions list */}
      {suggestions && suggestions.length > 0 && (
        <div className="space-y-1.5 pt-1 border-t border-border">
          {suggestions.map((s) => (
            <div key={s.tacticId} className="rounded bg-muted/50 p-2 space-y-1">
              <div className="flex items-center gap-2">
                <Sparkles className="size-3 text-purple-500 shrink-0" />
                <span className="text-xs font-medium">{s.name}</span>
                <Badge variant="outline" className="text-[9px]">{s.type}</Badge>
              </div>
              <p className="text-[11px] text-muted-foreground whitespace-pre-wrap">{s.template}</p>
            </div>
          ))}
        </div>
      )}
      {suggestions && suggestions.length === 0 && (
        <p className="text-[10px] text-muted-foreground">暂无针对此规则的修复建议</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AiTasteScoreBadge — reusable score badge for cockpit/chapter cards
// ---------------------------------------------------------------------------

export function AiTasteScoreBadge({ score, className }: { score: number; className?: string }) {
  return (
    <Badge className={`text-[10px] ${scoreBadgeClass(score)} ${className ?? ""}`}>
      AI味 {score}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// AiTasteReport — main report component
// ---------------------------------------------------------------------------

export interface AiTasteReportProps {
  report: FilterReport;
}

export function AiTasteReport({ report }: AiTasteReportProps) {
  const hitsWithSpans = report.hits.filter((h) => h.spans.length > 0);

  return (
    <div className="space-y-3" data-testid="ai-taste-report">
      {/* Score header */}
      <div className="flex items-center gap-3">
        <div className={`flex items-center justify-center size-12 rounded-lg ${scoreBadgeClass(report.aiTasteScore)}`}>
          <span className="text-lg font-bold">{report.aiTasteScore}</span>
        </div>
        <div>
          <div className="flex items-center gap-2">
            {report.aiTasteScore < 30 ? (
              <CheckCircle className="size-4 text-green-500" />
            ) : (
              <AlertTriangle className="size-4 text-yellow-500" />
            )}
            <span className="text-sm font-medium">AI 味等级：{levelLabel(report.level)}</span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            分析 {report.tokensAnalyzed} 字 · 耗时 {Math.round(report.elapsedMs)}ms · {report.engineVersion}
          </p>
        </div>
      </div>

      {/* Hits list */}
      {hitsWithSpans.length > 0 ? (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground">
            命中规则 ({hitsWithSpans.length})
          </h4>
          {hitsWithSpans.map((hit) => (
            <HitItem key={hit.ruleId} hit={hit} />
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">未检测到明显 AI 味特征</p>
      )}
    </div>
  );
}
