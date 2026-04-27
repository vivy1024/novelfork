import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { postApi } from "@/hooks/use-api";

export interface WorkImporterProps {
  readonly onImportComplete: () => void;
}

type ImportPurpose = "analyze-style" | "continue-writing";

const PURPOSE_LABELS: Record<ImportPurpose, string> = {
  "analyze-style": "只分析文风",
  "continue-writing": "续写",
};

interface ImportResult {
  readonly chapterCount: number;
  readonly styleSummary: string;
}

export function WorkImporter({ onImportComplete }: WorkImporterProps) {
  const [text, setText] = useState("");
  const [purpose, setPurpose] = useState<ImportPurpose>("analyze-style");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => setText(e.target?.result as string ?? "");
    reader.readAsText(file);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const submit = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await postApi<ImportResult>("/works/import", { text: text.trim(), purpose });
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-3 text-sm">
      <span className="font-medium">作品导入</span>

      <div
        className={`rounded-lg border-2 border-dashed p-4 text-center text-xs text-muted-foreground transition ${dragOver ? "border-primary bg-primary/5" : "border-border"}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        拖放 .txt 文件到此处，或在下方粘贴文本
        <input type="file" accept=".txt,.md" className="hidden" id="work-import-file" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
        <label htmlFor="work-import-file" className="ml-1 cursor-pointer text-primary hover:underline">选择文件</label>
      </div>

      <Textarea placeholder="粘贴作品文本..." value={text} onChange={(e) => setText(e.target.value)} className="min-h-20" aria-label="作品文本" />

      <div className="flex gap-1">
        {(Object.keys(PURPOSE_LABELS) as ImportPurpose[]).map((p) => (
          <button
            key={p}
            className={`rounded-lg px-2 py-1 text-xs ${purpose === p ? "bg-primary text-primary-foreground" : "border border-border hover:bg-muted"}`}
            onClick={() => setPurpose(p)}
            type="button"
          >
            {PURPOSE_LABELS[p]}
          </button>
        ))}
      </div>

      <Button type="button" size="sm" onClick={() => void submit()} disabled={loading || !text.trim()}>
        {loading ? "导入中..." : "提交导入"}
      </Button>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {result && (
        <div className="space-y-1 rounded-lg border border-border bg-muted/20 p-3">
          <p>识别章节数：{result.chapterCount}</p>
          <p>文风摘要：{result.styleSummary}</p>
          <Button type="button" size="xs" onClick={onImportComplete}>完成</Button>
        </div>
      )}
    </div>
  );
}
