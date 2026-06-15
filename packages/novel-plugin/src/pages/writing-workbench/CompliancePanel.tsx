import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, AlertTriangle, XCircle, Copy, Check, Search } from "lucide-react";
import { postApi } from "@/hooks/use-api";

interface DimensionResult {
  status: "pass" | "warn" | "fail" | "unknown";
  reason?: string;
  issues?: number;
}

interface PublishReadinessReport {
  ready: boolean;
  platform: string;
  sensitive: DimensionResult;
  aiRatio: DimensionResult;
  format: DimensionResult;
  continuity?: DimensionResult;
}

interface DisclosureResult {
  text: string;
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

const STATUS_ICON: Record<string, React.ReactNode> = {
  pass: <CheckCircle2 className="size-4 text-green-500" />,
  warn: <AlertTriangle className="size-4 text-yellow-500" />,
  fail: <XCircle className="size-4 text-red-500" />,
  unknown: <AlertTriangle className="size-4 text-muted-foreground" />,
};

const STATUS_LABEL: Record<string, string> = {
  pass: "通过",
  warn: "警告",
  fail: "未通过",
  unknown: "未知",
};

export function CompliancePanel({ bookId, onClose }: CompliancePanelProps) {
  const [checking, setChecking] = useState(false);
  const [report, setReport] = useState<PublishReadinessReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [generatingDisclosure, setGeneratingDisclosure] = useState(false);
  const [disclosure, setDisclosure] = useState<DisclosureResult | null>(null);
  const [copied, setCopied] = useState(false);

  // B4: 逐章 AI 检测
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "检查失败");
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成声明失败");
    } finally {
      setGeneratingDisclosure(false);
    }
  }

  async function handleCopy() {
    if (!disclosure) return;
    const text = typeof disclosure === "string" ? disclosure : disclosure.text;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleChapterScan() {
    setScanning(true);
    setScanError(null);
    setScanResult(null);
    try {
      // 1. 拿章节正文
      const chapterRes = await fetch(`/api/books/${encodeURIComponent(bookId)}/chapters/${scanChapter}`);
      if (!chapterRes.ok) throw new Error(`章节 ${scanChapter} 不存在`);
      const chapterData = await chapterRes.json() as { content: string };
      // 2. 调用朱雀扫描
      const scanRes = await postApi<{ report: ChapterScanResult }>(
        "/api/filter/scan",
        { text: chapterData.content },
      );
      setScanResult(scanRes.report);
    } catch (e) {
      setScanError(e instanceof Error ? e.message : "检测失败");
    } finally {
      setScanning(false);
    }
  }

  const dimensions: { key: keyof PublishReadinessReport; label: string }[] = [
    { key: "sensitive", label: "敏感词" },
    { key: "aiRatio", label: "AI 含量" },
    { key: "format", label: "格式规范" },
    { key: "continuity", label: "连续性" },
  ];

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">发布合规检查</span>
        <button
          type="button"
          onClick={onClose}
          className="text-[10px] text-muted-foreground hover:text-foreground"
        >
          收起
        </button>
      </div>

      {/* 一键检查 */}
      <button
        type="button"
        disabled={checking}
        onClick={() => void handleCheck()}
        className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {checking ? <Loader2 className="size-3 animate-spin" /> : null}
        {checking ? "检查中…" : "一键检查"}
      </button>

      {/* 错误 */}
      {error && <p className="text-xs text-destructive">{error}</p>}

      {/* 结果 */}
      {report && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant={report.ready ? "default" : "destructive"} className="text-[10px]">
              {report.ready ? "就绪" : "未就绪"}
            </Badge>
            <span className="text-[10px] text-muted-foreground">
              平台: {report.platform ?? "通用"}
            </span>
          </div>

          <div className="space-y-1">
            {dimensions.map(({ key, label }) => {
              const dim = report[key] as DimensionResult | undefined;
              if (!dim) return null;
              return (
                <div key={key} className="flex items-center gap-2 text-xs">
                  {STATUS_ICON[dim.status] ?? STATUS_ICON.unknown}
                  <span className="font-medium">{label}</span>
                  <span className="text-muted-foreground">
                    {STATUS_LABEL[dim.status] ?? "未知"}
                  </span>
                  {dim.issues !== undefined && dim.issues > 0 && (
                    <span className="text-[10px] text-muted-foreground">
                      ({dim.issues} 项问题)
                    </span>
                  )}
                  {dim.reason && (
                    <span className="text-[10px] text-muted-foreground truncate max-w-[120px]" title={dim.reason}>
                      {dim.reason}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* AI 声明 */}
      {report && (
        <div className="border-t border-border pt-2 space-y-2">
          <button
            type="button"
            disabled={generatingDisclosure}
            onClick={() => void handleGenerateDisclosure()}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted/50 disabled:opacity-50"
          >
            {generatingDisclosure ? <Loader2 className="size-3 animate-spin" /> : null}
            {generatingDisclosure ? "生成中…" : "生成 AI 使用声明"}
          </button>

          {disclosure && (
            <div className="relative rounded-md bg-muted/50 p-2">
              <pre className="text-[11px] whitespace-pre-wrap text-muted-foreground max-h-32 overflow-y-auto">
                {typeof disclosure === "string" ? disclosure : disclosure.text}
              </pre>
              <button
                type="button"
                onClick={() => void handleCopy()}
                className="absolute top-1 right-1 rounded p-1 hover:bg-muted"
                title="复制"
              >
                {copied ? <Check className="size-3 text-green-500" /> : <Copy className="size-3 text-muted-foreground" />}
              </button>
            </div>
          )}
        </div>
      )}

      {/* 逐章 AI 检测 */}
      <div className="border-t border-border pt-2 space-y-2">
        <span className="text-xs font-medium">逐章 AI 检测</span>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            value={scanChapter}
            onChange={(e) => setScanChapter(Math.max(1, parseInt(e.target.value) || 1))}
            className="w-20 rounded-md border border-border bg-background px-2 py-1 text-xs"
            placeholder="章节号"
          />
          <button
            type="button"
            disabled={scanning}
            onClick={() => void handleChapterScan()}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {scanning ? <Loader2 className="size-3 animate-spin" /> : <Search className="size-3" />}
            {scanning ? "检测中…" : "检测"}
          </button>
        </div>

        {scanError && <p className="text-xs text-destructive">{scanError}</p>}

        {scanResult && (
          <div className="space-y-1.5 rounded-md bg-muted/50 p-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium">AI味评分:</span>
              <Badge
                variant={scanResult.level === "clean" ? "secondary" : scanResult.level === "severe" ? "destructive" : "outline"}
                className="text-[10px]"
              >
                {scanResult.aiTasteScore.toFixed(0)}% · {scanResult.level}
              </Badge>
            </div>
            {scanResult.hits.length > 0 && (
              <div className="space-y-0.5">
                <span className="text-[10px] text-muted-foreground">命中规则 ({scanResult.hits.length}):</span>
                {scanResult.hits.slice(0, 10).map((hit, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-[10px]">
                    <Badge
                      variant={hit.severity === "high" ? "destructive" : hit.severity === "medium" ? "outline" : "secondary"}
                      className="text-[9px] px-1 py-0"
                    >
                      {hit.severity}
                    </Badge>
                    <span className="text-muted-foreground truncate">{hit.message}</span>
                  </div>
                ))}
                {scanResult.hits.length > 10 && (
                  <span className="text-[10px] text-muted-foreground">…及另外 {scanResult.hits.length - 10} 条</span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
