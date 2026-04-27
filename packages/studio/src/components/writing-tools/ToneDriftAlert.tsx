import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { useApi } from "@/hooks/use-api";

export interface ToneDriftData {
  readonly overallDrift: number;
  readonly isSignificant: boolean;
  readonly consecutiveDriftChapters: number;
  readonly declaredTone: string;
}

function driftLabel(drift: number): string {
  if (drift <= 0.1) return "稳定";
  if (drift <= 0.3) return "轻微偏离";
  if (drift <= 0.6) return "中度偏离";
  return "严重偏离";
}

function driftVariant(drift: number): "outline" | "secondary" | "destructive" {
  if (drift <= 0.1) return "outline";
  if (drift <= 0.3) return "secondary";
  return "destructive";
}

export function ToneDriftAlert({ bookId, chapterNumber }: { readonly bookId: string; readonly chapterNumber: number }) {
  const { data, loading, error } = useApi<ToneDriftData>(`/books/${bookId}/chapters/${chapterNumber}/tone-check`);

  if (loading || error || !data) return null;
  if (!data.isSignificant && data.consecutiveDriftChapters < 2) return null;

  const showUpdateHint = data.consecutiveDriftChapters >= 3;

  return (
    <Alert className={data.isSignificant ? "border-destructive/20 bg-destructive/5" : "border-amber-500/20 bg-amber-500/5"}>
      <AlertTitle className="flex items-center gap-2">
        文风偏离检测
        <Badge variant={driftVariant(data.overallDrift)}>{driftLabel(data.overallDrift)}</Badge>
      </AlertTitle>
      <AlertDescription className="mt-2 space-y-2">
        <div className="flex flex-wrap gap-3 text-xs">
          <span>声明基调：<Badge variant="outline">{data.declaredTone}</Badge></span>
          <span>偏离度：{(data.overallDrift * 100).toFixed(0)}%</span>
          <span>连续偏离：{data.consecutiveDriftChapters} 章</span>
        </div>
        {showUpdateHint && (
          <div className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
            已连续 {data.consecutiveDriftChapters} 章偏离声明基调，是否考虑更新基调声明？
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
}
