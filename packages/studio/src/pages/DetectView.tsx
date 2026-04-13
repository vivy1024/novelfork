import { useState } from "react";
import { useApi, postApi } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import { ShieldAlert, Loader2, ScanSearch, ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";

// --- 类型定义 ---

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
}

// --- 风险等级颜色映射 ---

function riskColor(level: string): string {
  switch (level) {
    case "high": return "text-red-500 bg-red-500/10 border-red-500/30";
    case "medium": return "text-amber-500 bg-amber-500/10 border-amber-500/30";
    default: return "text-emerald-500 bg-emerald-500/10 border-emerald-500/30";
  }
}

function riskLabel(level: string): string {
  switch (level) {
    case "high": return "高风险";
    case "medium": return "中风险";
    default: return "低风险";
  }
}

// --- 概览卡片 ---

function StatCard({ label, value, accent, c }: {
  label: string;
  value: string;
  accent?: string;
  c: ReturnType<typeof useColors>;
}) {
  return (
    <div className={`border ${c.cardStatic} rounded-lg p-5`}>
      <div className={`text-sm ${c.muted} mb-1`}>{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${accent ?? ""}`}>{value}</div>
    </div>
  );
}

// --- 单章详情展开行 ---

function ChapterRow({ result, c }: {
  result: ChapterResult;
  c: ReturnType<typeof useColors>;
}) {
  const [expanded, setExpanded] = useState(false);
  const risk = riskColor(result.riskLevel);

  return (
    <div className={`border ${c.cardStatic} rounded-lg overflow-hidden`}>
      {/* 章节摘要行 */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={`w-full flex items-center justify-between px-5 py-3.5 text-sm ${c.tableHover}`}
      >
        <div className="flex items-center gap-4">
          {expanded
            ? <ChevronDown size={14} className={c.muted} />
            : <ChevronRight size={14} className={c.muted} />}
          <span className="font-medium">第 {result.chapter} 章</span>
          <span className={`tabular-nums ${c.muted}`}>AI 分数: {result.score.toFixed(1)}</span>
          <span className={c.muted}>问题: {result.issues.length}</span>
        </div>
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${risk}`}>
          {riskLabel(result.riskLevel)}
        </span>
      </button>

      {/* 展开的问题列表 */}
      {expanded && result.issues.length > 0 && (
        <div className="border-t border-border px-5 py-3 space-y-2">
          {result.issues.map((issue, i) => (
            <div key={i} className="flex items-start gap-3 text-sm py-1.5">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" />
              <div className="min-w-0">
                <span className="font-medium">[{issue.type}]</span>{" "}
                <span className={c.muted}>{issue.description}</span>
                {issue.location && (
                  <span className={`ml-2 text-xs ${c.mono} ${c.muted}`}>{issue.location}</span>
                )}
              </div>
              <span className={`shrink-0 text-xs px-2 py-0.5 rounded border ${riskColor(issue.severity)}`}>
                {issue.severity}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* 无问题提示 */}
      {expanded && result.issues.length === 0 && (
        <div className={`border-t border-border px-5 py-4 text-sm ${c.muted}`}>
          未发现 AI Tells 问题
        </div>
      )}
    </div>
  );
}

// --- 主组件 ---

export function DetectView({ bookId, nav, theme, t }: {
  bookId: string;
  nav: Nav;
  theme: Theme;
  t: TFunction;
}) {
  const c = useColors(theme);
  const { data: stats, loading: statsLoading, error: statsError } = useApi<DetectStats>(
    `/books/${bookId}/detect/stats`,
  );

  // 全书扫描状态
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  const [results, setResults] = useState<ReadonlyArray<ChapterResult> | null>(null);

  const handleScanAll = async () => {
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
    <div className="space-y-6">
      {/* 面包屑导航 */}
      <div className={`flex items-center gap-2 text-sm ${c.muted}`}>
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.home")}</button>
        <span className="text-border">/</span>
        <button onClick={() => nav.toBook(bookId)} className={c.link}>{bookId}</button>
        <span className="text-border">/</span>
        <span>AI 检测</span>
      </div>

      {/* 标题 + 扫描按钮 */}
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-3xl flex items-center gap-3">
          <ShieldAlert size={28} className="text-primary" />
          AI 检测仪表盘
        </h1>
        <button
          onClick={handleScanAll}
          disabled={scanning}
          className={`px-5 py-2.5 text-sm rounded-lg ${c.btnPrimary} disabled:opacity-30 flex items-center gap-2`}
        >
          {scanning
            ? <Loader2 size={14} className="animate-spin" />
            : <ScanSearch size={14} />}
          {scanning ? "扫描中…" : "全书扫描"}
        </button>
      </div>

      {/* 概览统计卡片 */}
      {statsLoading && <div className={c.muted}>加载统计中…</div>}
      {statsError && (
        <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-lg text-sm">
          {statsError}
        </div>
      )}
      {stats && (
        <div className="grid grid-cols-3 gap-4">
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
      )}

      {/* 扫描错误 */}
      {scanError && (
        <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-lg text-sm">
          {scanError}
        </div>
      )}

      {/* 扫描结果列表 */}
      {results && results.length > 0 && (
        <div className="space-y-3">
          <h2 className={`text-xs font-bold uppercase tracking-wider ${c.muted}`}>
            扫描结果 ({results.length} 章)
          </h2>
          {results.map((r) => (
            <ChapterRow key={r.chapter} result={r} c={c} />
          ))}
        </div>
      )}

      {results && results.length === 0 && (
        <div className={`border ${c.cardStatic} rounded-lg p-8 text-center ${c.muted}`}>
          未检测到任何章节结果
        </div>
      )}
    </div>
  );
}
