import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson } from "@/hooks/use-api";

export interface GeneratedHookOption {
  readonly id: string;
  readonly style: string;
  readonly text: string;
  readonly rationale: string;
  readonly retentionEstimate: "high" | "medium" | "low" | string;
  readonly relatedHookIds?: ReadonlyArray<string>;
}

export interface ChapterHookGeneratorProps {
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly chapterContent: string;
  readonly onApplyHook: (hook: GeneratedHookOption) => void | Promise<void>;
  readonly applyDisabled?: boolean;
  readonly applyDisabledReason?: string;
}

const STYLE_LABELS: Record<string, string> = {
  suspense: "悬念型",
  reversal: "反转型",
  emotional: "情感型",
  "info-gap": "信息型",
  action: "动作型",
  mystery: "谜团型",
  cliffhanger: "悬崖型",
};

const RETENTION_LABELS: Record<string, string> = {
  high: "高留存",
  medium: "中留存",
  low: "低留存",
};

export function ChapterHookGenerator({ bookId, chapterNumber, chapterContent, onApplyHook, applyDisabled, applyDisabledReason }: ChapterHookGeneratorProps) {
  const [nextChapterIntent, setNextChapterIntent] = useState("");
  const [hooks, setHooks] = useState<ReadonlyArray<GeneratedHookOption>>([]);
  const [selectedHookId, setSelectedHookId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generateHooks() {
    setGenerating(true);
    setError(null);
    try {
      const response = await fetchJson<{ hooks: ReadonlyArray<GeneratedHookOption> }>(`/books/${bookId}/hooks/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chapterNumber,
          ...(chapterContent.trim() ? { chapterContent } : {}),
          ...(nextChapterIntent.trim() ? { nextChapterIntent: nextChapterIntent.trim() } : {}),
        }),
      });
      setHooks(response.hooks);
      setSelectedHookId(response.hooks[0]?.id ?? null);
    } catch (caught) {
      const status = (caught as { readonly status?: number }).status;
      setError(status === 409 ? "此功能需要配置 AI 模型" : caught instanceof Error ? caught.message : String(caught));
    } finally {
      setGenerating(false);
    }
  }

  function applySelectedHook() {
    const selected = hooks.find((hook) => hook.id === selectedHookId);
    if (selected) onApplyHook(selected);
  }

  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle>章节钩子生成器</CardTitle>
        <CardDescription>基于本章内容、伏笔状态和下一章意图生成 3-5 个章末钩子。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="next-chapter-intent">下一章意图</Label>
          <Textarea
            id="next-chapter-intent"
            value={nextChapterIntent}
            onChange={(event) => setNextChapterIntent(event.target.value)}
            placeholder="例如：追查脚步声、回收旧账簿伏笔、切换到沈舟 POV"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void generateHooks()} disabled={generating}>
            {generating ? "生成中..." : "生成章末钩子"}
          </Button>
          <Button type="button" variant="outline" onClick={applySelectedHook} disabled={!selectedHookId || applyDisabled} title={applyDisabled ? applyDisabledReason : undefined}>
            插入所选钩子
          </Button>
        </div>

        {error ? (
          <Alert className="border-destructive/20 bg-destructive/5">
            <AlertTitle>{error}</AlertTitle>
            <AlertDescription>你可以先配置模型，也可以继续使用本地写作工具。</AlertDescription>
          </Alert>
        ) : null}

        {hooks.length > 0 ? (
          <div className="space-y-3">
            {hooks.map((hook) => (
              <label key={hook.id} className="block cursor-pointer rounded-xl border border-border/60 bg-muted/20 p-4 transition-colors hover:bg-muted/40">
                <div className="flex items-start gap-3">
                  <input
                    type="radio"
                    name="chapter-hook-option"
                    checked={selectedHookId === hook.id}
                    onChange={() => setSelectedHookId(hook.id)}
                    aria-label={`选择钩子 ${hook.text}`}
                    className="mt-1"
                  />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="secondary">{STYLE_LABELS[hook.style] ?? hook.style}</Badge>
                      <Badge variant={hook.retentionEstimate === "high" ? "default" : hook.retentionEstimate === "medium" ? "secondary" : "outline"}>
                        {RETENTION_LABELS[hook.retentionEstimate] ?? hook.retentionEstimate}
                      </Badge>
                      {hook.relatedHookIds?.map((id) => <Badge key={id} variant="outline">{id}</Badge>)}
                    </div>
                    <p className="font-medium leading-relaxed">{hook.text}</p>
                    <p className="text-sm text-muted-foreground">{hook.rationale}</p>
                  </div>
                </div>
              </label>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
