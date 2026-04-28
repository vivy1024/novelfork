import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { postApi } from "@/hooks/use-api";

export interface OutlineBrancherProps {
  readonly bookId: string;
  readonly onSelectBranch: (outline: string) => void;
  readonly applyDisabledReason?: string;
}

interface Branch {
  readonly id: string;
  readonly conflict: string;
  readonly turningPoint: string;
  readonly estimatedChapters: number;
}

export function OutlineBrancher({ bookId, onSelectBranch, applyDisabledReason }: OutlineBrancherProps) {
  const [branches, setBranches] = useState<readonly Branch[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedContent, setExpandedContent] = useState<string | null>(null);
  const [promptPreview, setPromptPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanding, setExpanding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await postApi<{ branches?: readonly Branch[]; mode?: "prompt-preview"; promptPreview?: string; prompt?: string }>(`/books/${bookId}/outline/branch`, {});
      if (res.mode === "prompt-preview" || res.promptPreview) {
        setPromptPreview(res.promptPreview ?? res.prompt ?? "");
        setBranches([]);
      } else {
        setBranches(res.branches ?? []);
        setPromptPreview(null);
      }
      setExpandedId(null);
      setExpandedContent(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const expand = async (branchId: string) => {
    setExpanding(true);
    setError(null);
    try {
      const res = await postApi<{ outline?: string; mode?: "prompt-preview"; promptPreview?: string; prompt?: string }>(`/books/${bookId}/outline/expand`, { branchId });
      setExpandedId(branchId);
      setExpandedContent(res.mode === "prompt-preview" || res.promptPreview ? (res.promptPreview ?? res.prompt ?? "") : (res.outline ?? ""));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExpanding(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-3 text-sm">
      <span className="font-medium">大纲分支</span>

      <Button type="button" size="sm" onClick={() => void generate()} disabled={loading}>
        {loading ? "生成中..." : "生成分支走向"}
      </Button>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {promptPreview && (
        <div className="space-y-2 rounded-lg border border-dashed border-border bg-muted/20 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-amber-600 dark:text-amber-400">Prompt 预览</span>
            <Button type="button" size="xs" disabled>执行生成（未接入）</Button>
          </div>
          <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap text-xs leading-6 text-muted-foreground">{promptPreview}</pre>
        </div>
      )}

      {applyDisabledReason && <p className="text-xs text-muted-foreground">{applyDisabledReason}</p>}

      <div className="space-y-2">
        {branches.map((b) => (
          <Card key={b.id} size="sm">
            <CardHeader>
              <CardTitle className="text-sm">{b.conflict}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-xs text-muted-foreground">
              <p>转折点：{b.turningPoint}</p>
              <p>预计 {b.estimatedChapters} 章</p>
              <div className="flex gap-2 pt-1">
                <Button type="button" size="xs" variant="outline" onClick={() => void expand(b.id)} disabled={expanding}>
                  {expanding && expandedId === b.id ? "展开中..." : "展开"}
                </Button>
                {expandedId === b.id && expandedContent && (
                  <Button type="button" size="xs" onClick={() => onSelectBranch(expandedContent)} disabled={Boolean(applyDisabledReason)} title={applyDisabledReason}>
                    {applyDisabledReason ? "选择此走向（未接入）" : "选择此走向"}
                  </Button>
                )}
              </div>
              {expandedId === b.id && expandedContent && (
                <div className="mt-2 max-h-36 overflow-y-auto rounded-lg border border-border bg-muted/20 p-2 whitespace-pre-wrap">
                  {expandedContent}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
