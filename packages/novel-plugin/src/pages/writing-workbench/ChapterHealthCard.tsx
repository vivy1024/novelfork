import { useState } from "react";
import { Activity, BarChart3, MessageSquare, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { postApi } from "@/hooks/use-api";

// --- Types matching API responses ---

interface RhythmAnalysis {
  readonly score: number;
  readonly sentenceLengths?: readonly number[];
  readonly avgLength?: number;
  readonly diversity?: number;
}

interface DialogueAnalysis {
  readonly dialogueRatio: number;
  readonly totalLines?: number;
  readonly dialogueLines?: number;
}

interface ChapterHealthCardProps {
  bookId: string;
  chapterNumber: number;
}

// --- SVG Histogram ---

function SentenceLengthHistogram({ lengths }: { lengths: readonly number[] }) {
  if (lengths.length === 0) return null;

  // Bucket into ranges: 0-5, 6-10, 11-15, 16-20, 21-30, 31+
  const buckets = [0, 0, 0, 0, 0, 0];
  const bucketLabels = ["≤5", "6-10", "11-15", "16-20", "21-30", "31+"];
  for (const len of lengths) {
    if (len <= 5) buckets[0]++;
    else if (len <= 10) buckets[1]++;
    else if (len <= 15) buckets[2]++;
    else if (len <= 20) buckets[3]++;
    else if (len <= 30) buckets[4]++;
    else buckets[5]++;
  }

  const max = Math.max(...buckets, 1);
  const barWidth = 28;
  const gap = 6;
  const chartHeight = 48;
  const svgWidth = buckets.length * (barWidth + gap) - gap;

  return (
    <div className="space-y-1">
      <p className="text-[10px] text-muted-foreground">句长分布</p>
      <svg width={svgWidth} height={chartHeight + 16} className="block">
        {buckets.map((count, i) => {
          const barHeight = max > 0 ? (count / max) * chartHeight : 0;
          const x = i * (barWidth + gap);
          const y = chartHeight - barHeight;
          return (
            <g key={i}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={barHeight}
                rx={2}
                className="fill-primary/60"
              />
              <text
                x={x + barWidth / 2}
                y={chartHeight + 12}
                textAnchor="middle"
                className="fill-muted-foreground text-[8px]"
                fontSize={8}
              >
                {bucketLabels[i]}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// --- Dialogue ratio label ---

function dialogueLabel(ratio: number): { text: string; variant: "default" | "secondary" | "destructive" } {
  if (ratio < 0.15) return { text: "偏低", variant: "destructive" };
  if (ratio > 0.55) return { text: "偏高", variant: "destructive" };
  return { text: "健康", variant: "default" };
}

// --- Progress bar ---

function ScoreBar({ score, label }: { score: number; label: string }) {
  const percent = Math.min(100, Math.max(0, Math.round(score)));
  const color = percent >= 70 ? "bg-green-500" : percent >= 40 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{percent}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

// --- Main component ---

export function ChapterHealthCard({ bookId, chapterNumber }: ChapterHealthCardProps) {
  const [loading, setLoading] = useState(false);
  const [rhythm, setRhythm] = useState<RhythmAnalysis | null>(null);
  const [dialogue, setDialogue] = useState<DialogueAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analyzed, setAnalyzed] = useState(false);

  async function runAnalysis() {
    setLoading(true);
    setError(null);
    try {
      const [rhythmRes, dialogueRes] = await Promise.all([
        postApi<{ analysis: RhythmAnalysis }>(
          `/api/books/${bookId}/chapters/${chapterNumber}/rhythm`,
          {},
        ),
        postApi<{ analysis: DialogueAnalysis }>(
          `/api/books/${bookId}/chapters/${chapterNumber}/dialogue`,
          {},
        ),
      ]);
      setRhythm(rhythmRes.analysis);
      setDialogue(dialogueRes.analysis);
      setAnalyzed(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "分析失败");
    } finally {
      setLoading(false);
    }
  }

  if (!analyzed) {
    return (
      <div className="rounded-lg border border-border p-4 space-y-3" data-testid="chapter-health-card">
        <div className="flex items-center gap-2">
          <Activity className="size-4 text-primary" />
          <h4 className="text-xs font-medium">章节健康度分析</h4>
        </div>
        <p className="text-[11px] text-muted-foreground">
          分析第 {chapterNumber} 章的节奏、对话比例和句长分布
        </p>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <button
          type="button"
          onClick={() => void runAnalysis()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {loading && <Loader2 className="size-3 animate-spin" />}
          开始分析
        </button>
      </div>
    );
  }

  const dLabel = dialogue ? dialogueLabel(dialogue.dialogueRatio) : null;

  return (
    <div className="rounded-lg border border-border p-4 space-y-3" data-testid="chapter-health-card">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="size-4 text-primary" />
          <h4 className="text-xs font-medium">第 {chapterNumber} 章 · 健康度</h4>
        </div>
        <button
          type="button"
          onClick={() => void runAnalysis()}
          disabled={loading}
          className="text-[10px] text-muted-foreground hover:text-foreground"
        >
          {loading ? <Loader2 className="size-3 animate-spin" /> : "刷新"}
        </button>
      </div>

      {/* Rhythm score */}
      {rhythm && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <BarChart3 className="size-3 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground">节奏评分</span>
          </div>
          <ScoreBar score={rhythm.score} label="节奏" />
          {rhythm.sentenceLengths && rhythm.sentenceLengths.length > 0 && (
            <SentenceLengthHistogram lengths={rhythm.sentenceLengths} />
          )}
        </div>
      )}

      {/* Dialogue ratio */}
      {dialogue && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <MessageSquare className="size-3 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground">对话比例</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{Math.round(dialogue.dialogueRatio * 100)}%</span>
            {dLabel && <Badge variant={dLabel.variant} className="text-[9px]">{dLabel.text}</Badge>}
          </div>
          {dialogue.totalLines !== undefined && dialogue.dialogueLines !== undefined && (
            <p className="text-[10px] text-muted-foreground">
              {dialogue.dialogueLines} / {dialogue.totalLines} 行为对话
            </p>
          )}
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
