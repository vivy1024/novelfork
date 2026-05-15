import { useState, useEffect } from "react";
import { Loader2, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MeasuredMetric {
  readonly status: "measured";
  readonly value: number;
}

interface ChapterQuality {
  readonly chapterNumber: number;
  readonly qualityScore: number;
  readonly aiTastePercent: number;
  readonly auditStatus: "pass" | "warn" | "none";
}

interface HealthResponse {
  readonly health: {
    readonly totalChapters: MeasuredMetric;
    readonly aiTasteMean: MeasuredMetric | null;
    readonly chapters?: readonly ChapterQuality[];
  };
}

export interface QualityPanelProps {
  readonly bookId: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function QualityPanel({ bookId }: QualityPanelProps) {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetch(`/api/books/${bookId}/health`)
      .then((res) => {
        if (!res.ok) throw new Error("API error");
        return res.json() as Promise<HealthResponse>;
      })
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [bookId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-2">
        <BarChart3 className="size-8 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">暂无质量数据</p>
      </div>
    );
  }

  const { health } = data;
  const totalChapters = health.totalChapters?.value ?? 0;
  const aiTasteMean = health.aiTasteMean?.value ?? null;
  const chapters = health.chapters ?? [];

  // Calculate audit pass rate
  const audited = chapters.filter((c) => c.auditStatus !== "none");
  const passed = audited.filter((c) => c.auditStatus === "pass");
  const passRate = audited.length > 0 ? Math.round((passed.length / audited.length) * 100) : null;

  return (
    <div className="space-y-3">
      {/* Top stats row */}
      <div className="grid grid-cols-3 gap-2">
        <StatCard label="AI味均值" value={aiTasteMean !== null ? `${aiTasteMean}%` : "—"} />
        <StatCard label="审校通过率" value={passRate !== null ? `${passRate}%` : "—"} />
        <StatCard label="总章数" value={String(totalChapters)} />
      </div>

      {/* Chapter quality table */}
      {chapters.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-4">暂无章节数据</p>
      ) : (
        <div className="border border-border rounded-md overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="text-left px-2 py-1.5 font-medium text-muted-foreground">章节</th>
                <th className="text-center px-2 py-1.5 font-medium text-muted-foreground">质量分</th>
                <th className="text-center px-2 py-1.5 font-medium text-muted-foreground">AI味%</th>
                <th className="text-center px-2 py-1.5 font-medium text-muted-foreground">审校</th>
              </tr>
            </thead>
            <tbody>
              {chapters.map((ch) => (
                <tr key={ch.chapterNumber} className="border-b border-border last:border-0">
                  <td className="px-2 py-1.5">第{ch.chapterNumber}章</td>
                  <td className="text-center px-2 py-1.5">
                    <span className={cn(
                      "font-medium",
                      ch.qualityScore >= 80 ? "text-green-600" : ch.qualityScore >= 60 ? "text-yellow-600" : "text-red-500"
                    )}>
                      {ch.qualityScore}
                    </span>
                  </td>
                  <td className="text-center px-2 py-1.5">{ch.aiTastePercent}%</td>
                  <td className="text-center px-2 py-1.5">
                    {ch.auditStatus === "pass" && "✅"}
                    {ch.auditStatus === "warn" && "⚠"}
                    {ch.auditStatus === "none" && "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// StatCard
// ---------------------------------------------------------------------------

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border p-2 text-center">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold mt-0.5">{value}</div>
    </div>
  );
}
