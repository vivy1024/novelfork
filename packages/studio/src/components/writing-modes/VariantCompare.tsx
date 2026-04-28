import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { postApi } from "@/hooks/use-api";

export interface VariantCompareProps {
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly selectedText: string;
  readonly onAccept: (content: string) => void;
  readonly applyDisabledReason?: string;
}

interface Variant {
  readonly label: string;
  readonly content: string;
}

export function VariantCompare({ bookId, chapterNumber, selectedText, onAccept, applyDisabledReason }: VariantCompareProps) {
  const [variants, setVariants] = useState<readonly Variant[]>([]);
  const [promptPreviews, setPromptPreviews] = useState<readonly string[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await postApi<{ variants?: readonly Variant[]; mode?: "prompt-preview"; promptPreviews?: readonly string[]; prompts?: readonly string[] }>(`/books/${bookId}/variants/generate`, {
        selectedText,
        chapterNumber,
      });
      if (res.mode === "prompt-preview" || res.promptPreviews) {
        setPromptPreviews(res.promptPreviews ?? res.prompts ?? []);
        setVariants([]);
      } else {
        setVariants(res.variants ?? []);
        setPromptPreviews([]);
      }
      setActiveIdx(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const active = variants[activeIdx];

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-3 text-sm">
      <span className="font-medium">多版本对比</span>

      <Button type="button" size="sm" onClick={() => void generate()} disabled={loading || !selectedText}>
        {loading ? "生成中..." : "生成多版本"}
      </Button>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {promptPreviews.length > 0 && (
        <div className="space-y-2 rounded-lg border border-dashed border-border bg-muted/20 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-amber-600 dark:text-amber-400">Prompt 预览</span>
            <Button type="button" size="xs" disabled>执行生成（未接入）</Button>
          </div>
          <div className="space-y-2">
            {promptPreviews.map((prompt, index) => (
              <pre key={index} className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded border border-border bg-background/60 p-2 text-xs leading-6 text-muted-foreground">{prompt}</pre>
            ))}
          </div>
        </div>
      )}

      {variants.length > 0 && (
        <div className="space-y-2">
          <div className="flex gap-1">
            {variants.map((v, i) => (
              <button
                key={i}
                className={`rounded-lg px-2 py-1 text-xs ${i === activeIdx ? "bg-primary text-primary-foreground" : "border border-border hover:bg-muted"}`}
                onClick={() => setActiveIdx(i)}
                type="button"
              >
                {v.label}
              </button>
            ))}
          </div>

          {active && (
            <div className="space-y-2">
              <Badge variant="secondary">{active.label}</Badge>
              <div className="max-h-48 overflow-y-auto rounded-lg border border-border bg-muted/20 p-3 leading-7">
                {active.content}
              </div>
              {applyDisabledReason && <p className="text-xs text-muted-foreground">{applyDisabledReason}</p>}
              <Button type="button" size="xs" onClick={() => onAccept(active.content)} disabled={Boolean(applyDisabledReason)} title={applyDisabledReason}>
                {applyDisabledReason ? "选择此版本（未接入）" : "选择此版本"}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
