import { useState } from "react";
import { Loader2, Download, CheckCircle2 } from "lucide-react";
import { postApi } from "../../hooks/use-api";

type ExportFormat = "txt" | "docx" | "epub";

interface ExportResult {
  ok: boolean;
  path?: string;
  format?: string;
  chapters?: number;
  error?: string;
}

export interface ExportPanelProps {
  bookId: string;
  onClose: () => void;
}

const FORMAT_OPTIONS: { value: ExportFormat; label: string; description: string }[] = [
  { value: "txt", label: "TXT", description: "纯文本格式" },
  { value: "docx", label: "Word", description: ".docx 格式" },
  { value: "epub", label: "ePub", description: "电子书格式" },
];

export function ExportPanel({ bookId, onClose }: ExportPanelProps) {
  const [format, setFormat] = useState<ExportFormat>("txt");
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleExport() {
    setExporting(true);
    setError(null);
    setResult(null);
    try {
      const res = await postApi<ExportResult>(
        `/api/books/${bookId}/export`,
        { format },
      );
      if (res.error) {
        setError(res.error);
      } else {
        setResult(res);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "导出失败");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">导出书籍</span>
        <button
          type="button"
          onClick={onClose}
          className="text-[10px] text-muted-foreground hover:text-foreground"
        >
          收起
        </button>
      </div>

      {/* 格式选择 */}
      <div className="flex gap-2">
        {FORMAT_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setFormat(opt.value)}
            className={`flex-1 rounded-md border px-2 py-1.5 text-center text-xs transition-colors ${
              format === opt.value
                ? "border-primary bg-primary/10 text-primary font-medium"
                : "border-border hover:bg-muted/50"
            }`}
          >
            <div>{opt.label}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">{opt.description}</div>
          </button>
        ))}
      </div>

      {/* 导出按钮 */}
      <button
        type="button"
        disabled={exporting}
        onClick={() => void handleExport()}
        className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {exporting ? (
          <Loader2 className="size-3 animate-spin" />
        ) : (
          <Download className="size-3" />
        )}
        {exporting ? "导出中…" : "导出"}
      </button>

      {/* 错误 */}
      {error && <p className="text-xs text-destructive">{error}</p>}

      {/* 结果 */}
      {result && (
        <div className="flex items-center gap-2 rounded-md bg-green-50 dark:bg-green-950/30 p-2 text-xs">
          <CheckCircle2 className="size-4 text-green-500 shrink-0" />
          <div className="min-w-0">
            <p className="font-medium text-green-700 dark:text-green-400">导出完成</p>
            {result.path && (
              <p className="text-[10px] text-muted-foreground truncate" title={result.path}>
                {result.path}
              </p>
            )}
            {result.chapters !== undefined && (
              <p className="text-[10px] text-muted-foreground">
                共 {result.chapters} 章 · {result.format ?? format} 格式
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
