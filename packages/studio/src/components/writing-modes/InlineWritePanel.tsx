import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { postApi } from "@/hooks/use-api";

export interface InlineWritePanelProps {
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly selectedText: string;
  readonly onAccept: (content: string) => void;
  readonly onDiscard: () => void;
}

type InlineWriteMode = "continuation" | "expansion" | "bridge";

const MODE_LABELS: Record<InlineWriteMode, string> = {
  continuation: "续写",
  expansion: "扩写",
  bridge: "补写",
};

const EXPANSION_DIRECTIONS = ["感官", "动作", "心理", "环境", "对话"] as const;

export function InlineWritePanel({ bookId, chapterNumber, selectedText, onAccept, onDiscard }: InlineWritePanelProps) {
  const [mode, setMode] = useState<InlineWriteMode>("continuation");
  const [direction, setDirection] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await postApi<{ content: string }>(`/books/${bookId}/inline-write`, {
        mode,
        selectedText,
        direction: direction.trim() || undefined,
        chapterNumber,
      });
      setResult(res.content);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium">选段写作</span>
        <button className="text-xs text-muted-foreground hover:text-foreground" onClick={onDiscard} type="button">关闭</button>
      </div>

      <div className="flex gap-1">
        {(Object.keys(MODE_LABELS) as InlineWriteMode[]).map((m) => (
          <button
            key={m}
            className={`rounded-lg px-2 py-1 text-xs ${mode === m ? "bg-primary text-primary-foreground" : "border border-border hover:bg-muted"}`}
            onClick={() => setMode(m)}
            type="button"
          >
            {MODE_LABELS[m]}
          </button>
        ))}
      </div>

      {mode === "expansion" && (
        <div className="flex flex-wrap gap-1">
          {EXPANSION_DIRECTIONS.map((d) => (
            <Badge
              key={d}
              variant={direction === d ? "default" : "outline"}
              className="cursor-pointer"
              onClick={() => setDirection(direction === d ? "" : d)}
            >
              {d}
            </Badge>
          ))}
        </div>
      )}

      {mode !== "expansion" && (
        <Input placeholder="写作方向提示（可选）" value={direction} onChange={(e) => setDirection(e.target.value)} />
      )}

      <Button type="button" size="sm" onClick={() => void generate()} disabled={loading || !selectedText}>
        {loading ? "生成中..." : "生成"}
      </Button>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {result && (
        <div className="space-y-2">
          <div className="max-h-48 overflow-y-auto rounded-lg border border-border bg-muted/20 p-3 leading-7">
            <span className="text-muted-foreground">{selectedText}</span>
            <span className="text-blue-600 dark:text-blue-400">{result}</span>
          </div>
          <div className="flex gap-2">
            <Button type="button" size="xs" onClick={() => onAccept(result)}>接受</Button>
            <Button type="button" size="xs" variant="outline" onClick={() => void generate()}>重新生成</Button>
            <Button type="button" size="xs" variant="ghost" onClick={onDiscard}>丢弃</Button>
          </div>
        </div>
      )}
    </div>
  );
}
