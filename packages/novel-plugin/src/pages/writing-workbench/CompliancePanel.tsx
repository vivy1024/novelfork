import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Loader2, CheckCircle2, AlertTriangle, Copy, Check, Search } from "lucide-react";
import { postApi, fetchJson } from "@/hooks/use-api";

type RiskStatus = "clear" | "warning" | "needs-review" | "unknown";

interface RulePackMetadata {
  id: string;
  name: string;
  version: string;
  source: string;
  confidence: "high" | "medium" | "low";
  effectiveAt?: string;
  note?: string;
}

interface ComplianceEvidence {
  ruleId: string;
  rulePackId?: string;
  source: string;
  severity: "high" | "medium" | "low";
  chapterNumber?: number;
  chapterTitle?: string;
  message: string;
  matchedText?: string;
  offset?: number;
  paragraph?: number;
  context?: string;
  suggestion?: string;
}

interface PublishReadinessReport {
  platform: string;
  status: "ready" | "has-warnings" | "needs-review" | "skipped";
  rulePack: RulePackMetadata;
  evidence: ComplianceEvidence[];
  totalBlockCount: number;
  totalWarnCount: number;
  totalSuggestCount: number;
  sensitiveScan: { totalBlockCount: number; totalWarnCount: number; totalSuggestCount: number };
  aiTaste: {
    overallRiskLevel: "low" | "medium" | "high";
    methodology: string;
    rulePack: RulePackMetadata;
  };
  formatCheck: { blockCount: number; warnCount: number; suggestCount: number };
  continuity: { status: "passed" | "has-issues" | "unknown"; blockCount?: number; warnCount?: number; reason?: string };
}

interface DisclosureResult {
  markdownText: string;
  platform: string;
}

interface RuleHit {
  ruleId: string;
  severity: "high" | "medium" | "low";
  message: string;
  weightContribution: number;
}

interface ChapterScanResult {
  aiTasteScore: number;
  level: string;
  hits: RuleHit[];
}

export interface CompliancePanelProps {
  bookId: string;
  onClose: () => void;
}

const STATUS_ICON: Record<RiskStatus, React.ReactNode> = {
  clear: <CheckCircle2 className="size-4 text-green-500" />,
  warning: <AlertTriangle className="size-4 text-yellow-500" />,
  "needs-review": <AlertTriangle className="size-4 text-amber-500" />,
  unknown: <AlertTriangle className="size-4 text-muted-foreground" />,
};

const STATUS_LABEL: Record<RiskStatus, string> = {
  clear: "未发现明显线索",
  warning: "有提醒",
  "needs-review": "需人工复核",
  unknown: "未知",
};

function statusFromCounts(high: number, medium: number): RiskStatus {
  if (high > 0) return "needs-review";
  if (medium > 0) return "warning";
  return "clear";
}

export function CompliancePanel({ bookId, onClose }: CompliancePanelProps) {
  const [checking, setChecking] = useState(false);
  const [report, setReport] = useState<PublishReadinessReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generatingDisclosure, setGeneratingDisclosure] = useState(false);
  const [disclosure, setDisclosure] = useState<DisclosureResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [scanChapter, setScanChapter] = useState<number>(1);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ChapterScanResult | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  async function handleCheck() {
    setChecking(true);
    setError(null);
    setReport(null);
    setDisclosure(null);
    try {
      const res = await postApi<{ report: PublishReadinessReport }>(
        `/api/books/${bookId}/compliance/publish-readiness`,
        { platform: "generic" },
      );
      setReport(res.report);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "检查失败");
    } finally {
      setChecking(false);
    }
  }

  async function handleGenerateDisclosure() {
    setGeneratingDisclosure(true);
    setError(null);
    try {
      const res = await postApi<{ disclosure: DisclosureResult }>(
        `/api/books/${bookId}/compliance/ai-disclosure`,
        { platform: "generic" },
      );
      setDisclosure(res.disclosure);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "生成声明失败");
    } finally {
      setGeneratingDisclosure(false);
    }
  }

  async function handleCopy() {
    if (!disclosure) return;
    await navigator.clipboard.writeText(disclosure.markdownText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleChapterScan() {
    setScanning(true);
    setScanError(null);
    setScanResult(null);
    try {
      const chapterData = await fetchJson<{ content: string }>(
        `/api/books/${encodeURIComponent(bookId)}/chapters/${scanChapter}`,
      );
      const scanRes = await postApi<{ report: ChapterScanResult }>("/api/filter/scan", { text: chapterData.content });
      setScanResult(scanRes.report);
    } catch (cause) {
      setScanError(cause instanceof Error ? cause.message : "检测失败");
    } finally {
      setScanning(false);
    }
  }

  const dimensions = report ? [
    { label: "敏感词线索", status: statusFromCounts(report.sensitiveScan.totalBlockCount, report.sensitiveScan.totalWarnCount), count: report.sensitiveScan.totalBlockCount + report.sensitiveScan.totalWarnCount },
    { label: "AI 味线索", status: report.aiTaste.overallRiskLevel === "high" ? "needs-review" : report.aiTaste.overallRiskLevel === "medium" ? "warning" : "clear" as RiskStatus, count: report.aiTaste.overallRiskLevel === "low" ? 0 : 1 },
    { label: "正文完整性", status: statusFromCounts(report.formatCheck.blockCount, report.formatCheck.warnCount), count: report.formatCheck.blockCount + report.formatCheck.warnCount },
    { label: "连续性", status: report.continuity.status === "unknown" ? "unknown" : statusFromCounts(report.continuity.blockCount ?? 0, report.continuity.warnCount ?? 0), count: (report.continuity.blockCount ?? 0) + (report.continuity.warnCount ?? 0) },
  ] satisfies Array<{ label: string; status: RiskStatus; count: number }> : [];

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">投稿风险自检</span>
        <button type="button" onClick={onClose} className="text-[10px] text-muted-foreground hover:text-foreground">收起</button>
      </div>

      <button type="button" disabled={checking} onClick={() => void handleCheck()} className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
        {checking ? <Loader2 className="size-3 animate-spin" /> : null}
        {checking ? "检查中…" : "开始自检"}
      </button>

      {error && <Alert className="border-destructive/40 text-destructive py-2 text-xs">{error}</Alert>}

      {report && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={report.status === "needs-review" ? "outline" : "secondary"} className="text-[10px]">
              {report.status === "needs-review" ? "需人工复核" : report.status === "has-warnings" ? "有提醒" : "未发现明显线索"}
            </Badge>
            <span className="text-[10px] text-muted-foreground">平台建议：{report.platform}</span>
          </div>

          <div className="space-y-1">
            {dimensions.map((dimension) => (
              <div key={dimension.label} className="flex items-center gap-2 text-xs">
                {STATUS_ICON[dimension.status]}
                <span className="font-medium">{dimension.label}</span>
                <span className="text-muted-foreground">{STATUS_LABEL[dimension.status]}</span>
                {dimension.count > 0 && <span className="text-[10px] text-muted-foreground">（{dimension.count} 条）</span>}
              </div>
            ))}
          </div>

          <div className="rounded-md bg-muted/50 p-2 text-[10px] text-muted-foreground">
            <p><span className="font-medium text-foreground">规则来源：</span>{report.rulePack.id} · {report.rulePack.name} · v{report.rulePack.version} · {report.rulePack.confidence} 可信度</p>
            <p className="mt-1">{report.rulePack.source}</p>
            {report.rulePack.effectiveAt && <p className="mt-1">生效时间：{report.rulePack.effectiveAt}</p>}
            {report.rulePack.note && <p className="mt-1">{report.rulePack.note}</p>}
          </div>

          <div className="rounded-md bg-muted/50 p-2 text-[10px] text-muted-foreground">
            <p><span className="font-medium text-foreground">AI 味线索来源：</span>{report.aiTaste.rulePack.id} · {report.aiTaste.rulePack.name}</p>
            <p className="mt-1">{report.aiTaste.methodology}</p>
            {report.aiTaste.rulePack.note && <p className="mt-1">{report.aiTaste.rulePack.note}</p>}
          </div>

          {report.evidence.length > 0 && (
            <div className="space-y-1 border-t border-border pt-2">
              <span className="text-xs font-medium">复核证据</span>
              {report.evidence.slice(0, 6).map((evidence, index) => (
                <div key={`${evidence.ruleId}-${index}`} className="rounded-md bg-muted/50 p-2 text-[10px] text-muted-foreground">
                  <p className="text-foreground">{evidence.message}</p>
                  <p className="mt-1">规则：{evidence.rulePackId ? `${evidence.rulePackId} · ` : ""}{evidence.ruleId} · 来源：{evidence.source}</p>
                  {evidence.chapterNumber && <p className="mt-1">位置：第 {evidence.chapterNumber} 章{evidence.chapterTitle ? `《${evidence.chapterTitle}》` : ""}{evidence.paragraph ? ` · 第 ${evidence.paragraph} 段` : ""}{typeof evidence.offset === "number" ? ` · 偏移 ${evidence.offset}` : ""}</p>}
                  {evidence.context && <p className="mt-1 break-words">正文摘录：{evidence.context}</p>}
                  {evidence.suggestion && <p className="mt-1">人工复核建议：{evidence.suggestion}</p>}
                </div>
              ))}
              {report.evidence.length > 6 && <p className="text-[10px] text-muted-foreground">另有 {report.evidence.length - 6} 条证据。</p>}
            </div>
          )}
        </div>
      )}

      {report && (
        <div className="space-y-2 border-t border-border pt-2">
          <button type="button" disabled={generatingDisclosure} onClick={() => void handleGenerateDisclosure()} className="flex w-full items-center justify-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted/50 disabled:opacity-50">
            {generatingDisclosure ? <Loader2 className="size-3 animate-spin" /> : null}
            {generatingDisclosure ? "生成中…" : "生成 AI 使用说明草稿"}
          </button>
          {disclosure && (
            <div className="relative rounded-md bg-muted/50 p-2">
              <pre className="max-h-32 whitespace-pre-wrap overflow-y-auto text-[11px] text-muted-foreground">{disclosure.markdownText}</pre>
              <button type="button" onClick={() => void handleCopy()} className="absolute right-1 top-1 rounded p-1 hover:bg-muted" title="复制">
                {copied ? <Check className="size-3 text-green-500" /> : <Copy className="size-3 text-muted-foreground" />}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="space-y-2 border-t border-border pt-2">
        <span className="text-xs font-medium">逐章 AI 味线索扫描</span>
        <div className="flex items-center gap-2">
          <input type="number" min={1} value={scanChapter} onChange={(event) => setScanChapter(Math.max(1, parseInt(event.target.value) || 1))} className="w-20 rounded-md border border-border bg-background px-2 py-1 text-xs" placeholder="章节号" />
          <button type="button" disabled={scanning} onClick={() => void handleChapterScan()} className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {scanning ? <Loader2 className="size-3 animate-spin" /> : <Search className="size-3" />}
            {scanning ? "检测中…" : "检测"}
          </button>
        </div>
        {scanError && <Alert className="border-destructive/40 py-2 text-xs text-destructive">{scanError}</Alert>}
        {scanResult && (
          <div className="space-y-1.5 rounded-md bg-muted/50 p-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium">本地特征分数：</span>
              <Badge variant={scanResult.level === "clean" ? "secondary" : scanResult.level === "severe" ? "destructive" : "outline"} className="text-[10px]">
                {scanResult.aiTasteScore.toFixed(0)} · {scanResult.level}
              </Badge>
            </div>
            {scanResult.hits.length > 0 && <span className="text-[10px] text-muted-foreground">命中规则（{scanResult.hits.length}）：请结合正文人工判断。</span>}
          </div>
        )}
      </div>

      <p className="text-[10px] text-muted-foreground">本地自检只提供风险线索，不能替代平台审核或作者判断。</p>
    </div>
  );
}
