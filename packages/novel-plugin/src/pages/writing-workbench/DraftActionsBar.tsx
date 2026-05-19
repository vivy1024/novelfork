import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Archive, Check, Loader2, Trash2 } from "lucide-react";

export type DraftAcceptMode = "replace" | "merge" | "new";

export interface DraftActionsBarProps {
  draftId: string;
  chapterNumber?: number;
  wordCount?: number;
  updatedAt?: string;
  onSubmitCandidate: (draftId: string) => Promise<void>;
  onAccept: (draftId: string, chapterNumber: number, mode: DraftAcceptMode) => Promise<void>;
  onDelete: (draftId: string) => Promise<void>;
}

function formatDate(value: string | undefined): string {
  if (!value) return "";
  const numeric = Number(value);
  const date = Number.isFinite(numeric) ? new Date(numeric) : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function DraftActionsBar({ draftId, chapterNumber, wordCount, updatedAt, onSubmitCandidate, onAccept, onDelete }: DraftActionsBarProps) {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [targetChapter, setTargetChapter] = useState(String(chapterNumber ?? 1));
  const [confirmDelete, setConfirmDelete] = useState(false);

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

  function parsedChapter(): number | null {
    const value = Number(targetChapter);
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  const acceptDisabled = loading !== null || parsedChapter() === null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="outline" className="border-amber-500/20 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-300">
        草稿
      </Badge>
      {typeof wordCount === "number" ? <span className="text-[10px] text-muted-foreground">{wordCount} 字</span> : null}
      {updatedAt ? <span className="text-[10px] text-muted-foreground">更新于 {formatDate(updatedAt)}</span> : null}
      <span className="text-[10px] text-muted-foreground">提交或采纳前请先保存正文</span>

      <span className="flex-1" />
      {error ? <span className="max-w-56 truncate text-xs text-destructive">{error}</span> : null}

      <Button
        size="xs"
        variant="outline"
        disabled={loading !== null}
        onClick={() => void run("submit", () => onSubmitCandidate(draftId))}
        title="将草稿提交为候选稿"
      >
        {loading === "submit" ? <Loader2 className="mr-1 size-3 animate-spin" /> : <Archive className="mr-1 size-3" />}
        提交候选稿
      </Button>

      <div className="flex items-center gap-1">
        <span className="text-[10px] text-muted-foreground">目标章</span>
        <Input
          aria-label="草稿采纳目标章节"
          className="h-7 w-16 px-2 text-xs"
          inputMode="numeric"
          value={targetChapter}
          onChange={(event) => setTargetChapter(event.target.value)}
        />
        <Button
          size="xs"
          disabled={acceptDisabled}
          onClick={() => {
            const nextChapter = parsedChapter();
            if (!nextChapter) {
              setError("请输入有效章节号");
              return;
            }
            void run("accept", () => onAccept(draftId, nextChapter, "replace"));
          }}
          title="直接采纳草稿为正式章节"
        >
          {loading === "accept" ? <Loader2 className="mr-1 size-3 animate-spin" /> : <Check className="mr-1 size-3" />}
          直接采纳
        </Button>
      </div>

      {confirmDelete ? (
        <div className="flex items-center gap-1">
          <span className="text-xs text-destructive">确认删除？</span>
          <Button
            size="xs"
            variant="destructive"
            disabled={loading !== null}
            onClick={() => {
              setConfirmDelete(false);
              void run("delete", () => onDelete(draftId));
            }}
          >
            确认
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setConfirmDelete(false)}>取消</Button>
        </div>
      ) : (
        <Button size="xs" variant="ghost" disabled={loading !== null} onClick={() => setConfirmDelete(true)} title="删除草稿">
          {loading === "delete" ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
        </Button>
      )}
    </div>
  );
}
