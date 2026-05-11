import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Palette, AlertTriangle, CheckCircle2 } from "lucide-react";
import { postApi } from "@/hooks/use-api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DriftResult {
  readonly sentenceLengthDrift: number;
  readonly vocabularyDrift: number;
  readonly overallDrift: number;
  readonly isSignificant: boolean;
}

interface DriftResponse {
  readonly drift: DriftResult;
  readonly bookId: string;
  readonly base?: { avgSentenceLength?: number; vocabularyDiversity?: number };
  readonly current?: { avgSentenceLength?: number; vocabularyDiversity?: number };
}

export interface StyleDriftPanelProps {
  readonly bookId: string;
  readonly chapterContent?: string;
  readonly onClose: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function driftLevel(value: number): { label: string; color: string } {
  if (value < 0.2) return { label: "低", color: "text-green-600" };
  if (value < 0.5) return { label: "中", color: "text-yellow-600" };
  return { label: "高", color: "text-red-600" };
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StyleDriftPanel({ bookId, chapterContent, onClose }: StyleDriftPanelProps) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DriftResult | null>(null);
  const [baseProfile, setBaseProfile] = useState<{ avgSentenceLength?: number; vocabularyDiversity?: number } | null>(null);
  const [currentProfile, setCurrentProfile] = useState<{ avgSentenceLength?: number; vocabularyDiversity?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleCheck() {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      // Compute current chapter's style profile from content
      const text = chapterContent ?? "";
      const sentences = text.split(/[。！？.!?]+/).filter((s) => s.trim().length > 0);
      const avgSentenceLength = sentences.length > 0 ? Math.round(sentences.reduce((sum, s) => sum + s.length, 0) / sentences.length) : 20;
      const chars = new Set(text.split(""));
      const vocabularyDiversity = text.length > 0 ? Math.min(1, chars.size / Math.min(text.length, 500)) : 0.5;

      const res = await postApi<DriftResponse>(`/books/${bookId}/style/drift-check`, {
        current: { avgSentenceLength, vocabularyDiversity },
        base: "auto",
      });
      setResult(res.drift);
      setBaseProfile(res.base ?? null);
      setCurrentProfile(res.current ?? { avgSentenceLength, vocabularyDiversity });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "文风漂移检测失败");
    } finally {
      setLoading(false);
    }
  }

  const overall = result ? driftLevel(result.overallDrift) : null;

  return (
    <div className="rounded-lg border border-border p-3 space-y-2" data-testid="style-drift-panel">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Palette className="size-3.5 text-primary" />
          <span className="text-xs font-medium">文风漂移检测</span>
        </div>
        <button type="button" onClick={onClose} className="text-[10px] text-muted-foreground hover:text-foreground">关闭</button>
      </div>

      <Button
        size="sm"
        variant="outline"
        className="w-full text-xs"
        onClick={() => void handleCheck()}
        disabled={loading}
      >
        {loading ? (
          <>
            <Loader2 className="size-3 animate-spin mr-1" />
            检测中…
          </>
        ) : (
          "检测漂移"
        )}
      </Button>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {result && (
        <div className="space-y-2 pt-1">
          {/* Overall */}
          <div className="flex items-center gap-2">
            {result.isSignificant ? (
              <AlertTriangle className="size-3.5 text-yellow-600 shrink-0" />
            ) : (
              <CheckCircle2 className="size-3.5 text-green-600 shrink-0" />
            )}
            <span className="text-xs">
              整体漂移：<span className={`font-medium ${overall?.color}`}>{overall?.label}</span>
              <span className="text-muted-foreground ml-1">({formatPercent(result.overallDrift)})</span>
            </span>
          </div>

          {/* Dimensions */}
          <div className="space-y-1.5 pl-1">
            <DimensionRow
              name="句长"
              value={result.sentenceLengthDrift}
              baseline={`${baseProfile?.avgSentenceLength ?? "?"} 字/句`}
              current={`${currentProfile?.avgSentenceLength ?? "?"} 字/句`}
            />
            <DimensionRow
              name="词汇多样性"
              value={result.vocabularyDrift}
              baseline={baseProfile?.vocabularyDiversity?.toFixed(2) ?? "?"}
              current={currentProfile?.vocabularyDiversity?.toFixed(2) ?? "?"}
            />
          </div>

          {result.isSignificant && (
            <p className="text-[10px] text-yellow-700 bg-yellow-50 dark:bg-yellow-950/30 rounded px-2 py-1">
              检测到显著文风偏移，建议检查近期章节是否偏离既定基调。
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function DimensionRow({ name, value, baseline, current }: {
  name: string;
  value: number;
  baseline: string;
  current: string;
}) {
  const level = driftLevel(value);
  return (
    <div className="flex items-center justify-between text-[10px]">
      <span className="text-muted-foreground">{name}</span>
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">{baseline} → {current}</span>
        <Badge variant="outline" className={`text-[8px] h-3.5 ${level.color}`}>
          {level.label} {formatPercent(value)}
        </Badge>
      </div>
    </div>
  );
}
