import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Loader2, ScanSearch, ShieldAlert } from "lucide-react";

import { AiModelRequiredDialog } from "@/components/ai/AiModelRequiredDialog";
import { PageEmptyState } from "@/components/layout/PageEmptyState";
import { PageScaffold } from "@/components/layout/PageScaffold";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAiModelGate } from "../hooks/use-ai-model-gate";
import { postApi, useApi } from "../hooks/use-api";
import { useColors } from "../hooks/use-colors";
import type { TFunction } from "../hooks/use-i18n";
import type { Theme } from "../hooks/use-theme";

interface DetectStats {
  readonly totalChapters: number;
  readonly averageScore: number;
  readonly highRiskCount: number;
}

interface AiTell {
  readonly type: string;
  readonly description: string;
  readonly severity: string;
  readonly location?: string;
}

interface ChapterResult {
  readonly chapter: number;
  readonly score: number;
  readonly issues: ReadonlyArray<AiTell>;
  readonly riskLevel: "low" | "medium" | "high";
}

interface DetectAllResponse {
  readonly results: ReadonlyArray<ChapterResult>;
}

interface Nav {
  toBook: (id: string) => void;
  toDashboard: () => void;
  toAdmin?: (section?: string) => void;
}

function riskColor(level: string): string {
  switch (level) {
    case "high":
      return "text-red-500 bg-red-500/10 border-red-500/30";
    case "medium":
      return "text-amber-500 bg-amber-500/10 border-amber-500/30";
    default:
      return "text-emerald-500 bg-emerald-500/10 border-emerald-500/30";
  }
}

function riskLabel(level: string): string {
  switch (level) {
    case "high":
      return "高风险";
    case "medium":
      return "中风险";
    default:
      return "低风险";
  }
}

function StatCard({ label, value, accent, c }: {
  label: string;
  value: string;
  accent?: string;
  c: ReturnType<typeof useColors>;
}) {
  return (
    <Card className={c.cardStatic}>
      <CardContent className="p-5">
        <div className={`mb-1 text-sm ${c.muted}`}>{label}</div>
        <div className={`text-2xl font-semibold tabular-nums ${accent ?? "text-foreground"}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function ChapterRow({ result, c }: {
  result: ChapterResult;
  c: ReturnType<typeof useColors>;
}) {
  const [expanded, setExpanded] = useState(false);
  const risk = riskColor(result.riskLevel);

  return (
    <Card className={c.cardStatic}>
      <button
        onClick={() => setExpanded(!expanded)}
        className={`flex w-full items-center justify-between gap-4 px-5 py-3.5 text-left text-sm ${c.tableHover}`}
      >
        <div className="flex min-w-0 items-center gap-4">
          {expanded ? <ChevronDown size={14} className={c.muted} /> : <ChevronRight size={14} className={c.muted} />}
          <span className="font-medium text-foreground">第 {result.chapter} 章</span>
          <span className={`tabular-nums ${c.muted}`}>AI 分数: {result.score.toFixed(1)}</span>
          <span className={c.muted}>问题: {result.issues.length}</span>
        </div>
        <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium ${risk}`}>
          {riskLabel(result.riskLevel)}
        </span>
      </button>

      {expanded && result.issues.length > 0 && (
        <div className="border-t border-border/60 px-5 py-3 space-y-2">
          {result.issues.map((issue, i) => (
            <div key={i} className="flex items-start gap-3 py-1.5 text-sm">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" />
              <div className="min-w-0 flex-1">
                <span className="font-medium text-foreground">[{issue.type}]</span>{" "}
                <span className="text-muted-foreground">{issue.description}</span>
                {issue.location && <span className={`ml-2 text-xs ${c.mono} ${c.muted}`}>{issue.location}</span>}
              </div>
              <span className={`shrink-0 rounded border px-2 py-0.5 text-xs ${riskColor(issue.severity)}`}>
                {issue.severity}
              </span>
            </div>
          ))}
        </div>
      )}

      {expanded && result.issues.length === 0 && (
        <div className="border-t border-border/60 px-5 py-4 text-sm text-muted-foreground">未发现 AI Tells 问题</div>
      )}
    </Card>
  );
}

export function DetectView({ bookId, nav, theme, t }: {
  bookId: string;
  nav: Nav;
  theme: Theme;
  t: TFunction;
}) {
  const c = useColors(theme);
  const { ensureModelFor, blockedResult, closeGate } = useAiModelGate();
  const { data: stats, loading: statsLoading, error: statsError } = useApi<DetectStats>(
    `/books/${bookId}/detect/stats`,
  );

  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  const [results, setResults] = useState<ReadonlyArray<ChapterResult> | null>(null);

  const handleScanAll = async () => {
    if (!ensureModelFor("deep-ai-taste-scan")) {
      return;
    }
    setScanning(true);
    setScanError("");
    setResults(null);
    try {
      const data = await postApi<DetectAllResponse>(`/books/${bookId}/detect-all`);
      setResults(data.results);
    } catch (e) {
      setScanError(e instanceof Error ? e.message : String(e));
    }
    setScanning(false);
  };

  return (
    <PageScaffold
      title="AI 检测仪表盘"
      description="扫描全书的 AI 味与高风险章节，帮助你更快定位需要人工回修的内容。"
      actions={
        <>
          <Button variant="outline" onClick={nav.toDashboard}>返回书单</Button>
          <Button variant="outline" onClick={() => nav.toBook(bookId)}>返回书籍</Button>
          <Button onClick={handleScanAll} disabled={scanning}>
            {scanning ? <Loader2 className="mr-2 size-4 animate-spin" /> : <ScanSearch className="mr-2 size-4" />}
            {scanning ? "扫描中…" : "全书扫描"}
          </Button>
        </>
      }
    >
      {statsLoading ? (
        <div className="flex min-h-[180px] items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 size-4 animate-spin" />
          加载统计中…
        </div>
      ) : statsError ? (
        <Card className="border-destructive/20 bg-destructive/5">
          <CardContent className="p-4 text-sm text-destructive">{statsError}</CardContent>
        </Card>
      ) : stats ? (
        <div className="grid gap-4 md:grid-cols-3">
          <StatCard label="总章节数" value={stats.totalChapters.toString()} c={c} />
          <StatCard
            label="平均 AI 分数"
            value={stats.averageScore.toFixed(1)}
            accent={stats.averageScore > 70 ? "text-red-500" : stats.averageScore > 40 ? "text-amber-500" : "text-emerald-500"}
            c={c}
          />
          <StatCard
            label="高风险章节"
            value={stats.highRiskCount.toString()}
            accent={stats.highRiskCount > 0 ? "text-red-500" : "text-emerald-500"}
            c={c}
          />
        </div>
      ) : null}

      {scanError && (
        <Card className="border-destructive/20 bg-destructive/5">
          <CardContent className="p-4 text-sm text-destructive">{scanError}</CardContent>
        </Card>
      )}

      {results && results.length > 0 ? (
        <div className="space-y-3">
          <h2 className={`text-xs font-bold uppercase tracking-wider ${c.muted}`}>扫描结果 ({results.length} 章)</h2>
          {results.map((r) => (
            <ChapterRow key={r.chapter} result={r} c={c} />
          ))}
        </div>
      ) : results && results.length === 0 ? (
        <PageEmptyState
          title="未检测到任何章节结果"
          description="这次扫描没有返回可见问题，说明当前章节暂时没有触发高风险特征。"
          icon={ShieldAlert}
        />
      ) : !scanning ? (
        <PageEmptyState
          title="准备开始检测"
          description="点击右上角的全书扫描，先看整体风险，再逐章展开问题细节。"
          icon={ShieldAlert}
        />
      ) : null}

      <AiModelRequiredDialog
        open={Boolean(blockedResult)}
        message={blockedResult?.message ?? ""}
        onCancel={closeGate}
        onConfigureModel={() => {
          closeGate();
          nav.toAdmin?.("providers");
        }}
      />
    </PageScaffold>
  );
}
