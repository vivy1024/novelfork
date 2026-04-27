import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { postApi } from "@/hooks/use-api";

export interface VariantCompareProps {
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly selectedText: string;
  readonly onAccept: (content: string) => void;
}

interface Variant {
  readonly label: string;
  readonly content: string;
}

export function VariantCompare({ bookId, chapterNumber, selectedText, onAccept }: VariantCompareProps) {
  const [variants, setVariants] = useState<readonly Variant[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await postApi<{ variants: readonly Variant[] }>(`/books/${bookId}/variants/generate`, {
        selectedText,
        chapterNumber,
      });
      setVariants(res.variants);
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
              <Button type="button" size="xs" onClick={() => onAccept(active.content)}>选择此版本</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
