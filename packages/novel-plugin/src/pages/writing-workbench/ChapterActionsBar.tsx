import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GitBranch, History, Loader2, Pencil } from "lucide-react";

export interface ChapterActionsBarProps {
  resourceId: string;
  chapterNumber?: number;
  version?: number;
  wordCount?: number;
  onCreateDraft: (resourceId: string) => Promise<void>;
  onCreateVariant: (resourceId: string) => Promise<void>;
  onToggleHistory: (resourceId: string) => Promise<void>;
}

export function ChapterActionsBar({ resourceId, chapterNumber, version, wordCount, onCreateDraft, onCreateVariant, onToggleHistory }: ChapterActionsBarProps) {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(actionId: string, task: () => Promise<void>) {
    if (loading) return;
    setLoading(actionId);
    setError(null);
    try {
      await task();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="outline" className="border-green-500/20 bg-green-500/10 text-[10px] text-green-700 dark:text-green-300">正式章节</Badge>
      {chapterNumber ? <span className="text-[10px] text-muted-foreground">第 {chapterNumber} 章</span> : null}
      {version ? <span className="text-[10px] text-muted-foreground">v{version}</span> : null}
      {typeof wordCount === "number" ? <span className="text-[10px] text-muted-foreground">{wordCount} 字</span> : null}
      <span className="flex-1" />
      {error ? <span className="max-w-56 truncate text-xs text-destructive">{error}</span> : null}
      <Button size="xs" variant="outline" disabled={loading !== null} onClick={() => void run("draft", () => onCreateDraft(resourceId))} title="从正式章节创建可编辑草稿">
        {loading === "draft" ? <Loader2 className="mr-1 size-3 animate-spin" /> : <Pencil className="mr-1 size-3" />}
        编辑为草稿
      </Button>
      <Button size="xs" variant="outline" disabled={loading !== null} onClick={() => void run("variant", () => onCreateVariant(resourceId))} title="从正式章节生成候选变体">
        {loading === "variant" ? <Loader2 className="mr-1 size-3 animate-spin" /> : <GitBranch className="mr-1 size-3" />}
        生成变体
      </Button>
      <Button size="xs" variant="ghost" disabled={loading !== null} onClick={() => void run("history", () => onToggleHistory(resourceId))} title="查看版本历史">
        {loading === "history" ? <Loader2 className="mr-1 size-3 animate-spin" /> : <History className="mr-1 size-3" />}
        查看历史
      </Button>
    </div>
  );
}
