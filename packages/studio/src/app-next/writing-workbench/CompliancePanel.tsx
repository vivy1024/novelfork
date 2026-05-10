import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, AlertTriangle, XCircle, Copy, Check } from "lucide-react";
import { postApi } from "../../hooks/use-api";

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
    </div>
  );
}
