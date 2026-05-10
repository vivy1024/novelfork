import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, Check, ArrowLeft } from "lucide-react";
import { postApi } from "@/hooks/use-api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VariantItem {
  readonly content: string;
  readonly prompt: string;
}

interface VariantsResponse {
  readonly mode: string;
  readonly variants: readonly VariantItem[];
  readonly count: number;
  readonly model?: string;
}

interface ApplyResponse {
  readonly target: string;
  readonly resourceId: string;
  readonly status: string;
}

export interface VariantsPanelProps {
  readonly bookId: string;
  readonly currentChapter?: number;
  readonly selectedText?: string;
  readonly onClose?: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function VariantsPanel({ bookId, currentChapter, selectedText, onClose }: VariantsPanelProps) {
  const [inputText, setInputText] = useState(selectedText ?? "");
  const [count, setCount] = useState(3);
  const [direction, setDirection] = useState("");

  const [loading, setLoading] = useState(false);
  const [variants, setVariants] = useState<readonly VariantItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [appliedIndex, setAppliedIndex] = useState<number | null>(null);
  const [applyingIndex, setApplyingIndex] = useState<number | null>(null);

  async function handleGenerate() {
    if (!inputText.trim()) {
      setError("请输入原文");
      return;
    }
    setLoading(true);
    setError(null);
    setVariants([]);
    setAppliedIndex(null);

    try {
      const body: Record<string, unknown> = {
        selectedText: inputText.trim(),
        count,
        chapterNumber: currentChapter ?? 1,
        beforeText: inputText.trim(),
      };
      if (direction.trim()) {
        body.direction = direction.trim();
      }

      const res = await postApi<VariantsResponse>(`/books/${bookId}/variants/generate`, body);
      setVariants(res.variants);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "生成失败");
    } finally {
      setLoading(false);
    }
  }

  async function handleApply(index: number) {
    const variant = variants[index];
    if (!variant) return;
    setApplyingIndex(index);
    setError(null);

    try {
      await postApi<ApplyResponse>(`/books/${bookId}/writing-modes/apply`, {
        content: variant.content,
        target: "candidate",
        sourceMode: "variant",
        chapterNumber: currentChapter ?? 1,
      });
      setAppliedIndex(index);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "应用失败");
    } finally {
      setApplyingIndex(null);
    }
  }

  return (
    <div className="space-y-3" data-testid="variants-panel">
      {/* Header */}
      <div className="flex items-center gap-2">
        {onClose && (
          <Button variant="ghost" size="icon" className="size-6" onClick={onClose}>
            <ArrowLeft className="size-3.5" />
          </Button>
        )}
        <span className="text-xs font-medium">多版本变体</span>
      </div>

      {/* Input text */}
      <div>
        <label className="text-[10px] text-muted-foreground font-medium">原文</label>
        <Textarea
          className="mt-1 text-xs min-h-[80px] resize-y"
          placeholder="粘贴要生成变体的原文…"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
        />
      </div>

      {/* Count selector */}
      <div className="flex items-center gap-3">
        <div>
          <label className="text-[10px] text-muted-foreground font-medium">变体数量</label>
          <div className="flex gap-1 mt-1">
            {[2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setCount(n)}
                className={`text-[10px] w-6 h-6 rounded-md border transition-colors ${
                  count === n
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Direction hint */}
      <div>
        <label className="text-[10px] text-muted-foreground font-medium">风格指令（可选）</label>
        <input
          type="text"
          className="mt-1 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder="例如：更口语化、更文学性、更紧凑…"
          value={direction}
          onChange={(e) => setDirection(e.target.value)}
        />
      </div>

      {/* Generate button */}
      <Button
        size="sm"
        className="w-full"
        onClick={() => void handleGenerate()}
        disabled={loading || !inputText.trim()}
      >
        {loading ? (
          <>
            <Loader2 className="size-3 animate-spin mr-1.5" />
            生成中（{count} 个变体）…
          </>
        ) : (
          `生成 ${count} 个变体`
        )}
      </Button>

      {/* Error */}
      {error && <p className="text-xs text-destructive">{error}</p>}

      {/* Variants list */}
      {variants.length > 0 && (
        <div className="space-y-2">
          <span className="text-[10px] text-muted-foreground font-medium">
            生成结果（{variants.length} 个变体）
          </span>
          {variants.map((variant, idx) => (
            <div
              key={idx}
              className={`rounded-lg border p-3 space-y-2 transition-colors ${
                appliedIndex === idx ? "border-green-500/50 bg-green-50/30 dark:bg-green-950/20" : "border-border"
              }`}
            >
              <div className="flex items-center justify-between">
                <Badge variant="secondary" className="text-[10px]">
                  变体 {idx + 1}
                </Badge>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-[10px] px-2"
                  onClick={() => void handleApply(idx)}
                  disabled={applyingIndex !== null || appliedIndex === idx}
                >
                  {appliedIndex === idx ? (
                    <>
                      <Check className="size-3 mr-1" />
                      已采用
                    </>
                  ) : applyingIndex === idx ? (
                    <>
                      <Loader2 className="size-3 animate-spin mr-1" />
                      应用中…
                    </>
                  ) : (
                    "采用"
                  )}
                </Button>
              </div>
              <pre className="text-[11px] text-foreground/90 overflow-x-auto max-h-40 whitespace-pre-wrap leading-relaxed">
                {variant.content}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
