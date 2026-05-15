import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { History, RotateCcw, Loader2, AlertTriangle } from "lucide-react";

export interface CheckpointEntry {
  id: string;
  createdAt: string;
  sessionId: string;
  reason: string | null;
  resourceCount: number;
}

export interface CheckpointPanelProps {
  checkpoints: readonly CheckpointEntry[];
  loading?: boolean;
  onPreviewRewind: (checkpointId: string) => Promise<unknown>;
  onApplyRewind: (checkpointId: string) => Promise<void>;
  onRefresh: () => void;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export function CheckpointPanel({ checkpoints, loading, onPreviewRewind, onApplyRewind, onRefresh }: CheckpointPanelProps) {
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<unknown>(null);

  async function handlePreview(checkpointId: string) {
    setPreviewingId(checkpointId);
    setError(null);
    setPreview(null);
    try {
      const result = await onPreviewRewind(checkpointId);
      setPreview(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "预览失败");
    } finally {
      setPreviewingId(null);
    }
  }

  async function handleApply(checkpointId: string) {
    setApplyingId(checkpointId);
    setError(null);
    try {
      await onApplyRewind(checkpointId);
      setConfirmId(null);
      onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "回滚失败");
    } finally {
      setApplyingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        加载 Checkpoint 列表...
      </div>
    );
  }

  if (checkpoints.length === 0) {
    return (
      <div className="p-4 text-center space-y-2">
        <History className="size-8 text-muted-foreground/30 mx-auto" />
        <p className="text-sm text-muted-foreground">暂无 Checkpoint</p>
        <p className="text-xs text-muted-foreground/60">AI 写入正式资源时会自动创建 Checkpoint，可用于回滚</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-3" data-testid="checkpoint-panel">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <History className="size-3.5" />
          Checkpoint 历史 · {checkpoints.length} 条
        </h3>
        <Button variant="ghost" size="xs" onClick={onRefresh}>刷新</Button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="space-y-2 max-h-60 overflow-y-auto">
        {[...checkpoints].reverse().map((cp) => (
          <div key={cp.id} className="rounded-md border border-border p-2.5 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-muted-foreground">{cp.id.slice(0, 16)}...</span>
              <span className="text-[10px] text-muted-foreground">{formatTime(cp.createdAt)}</span>
            </div>
            {cp.reason && <p className="text-xs">{cp.reason}</p>}
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-[9px]">{cp.resourceCount} 资源</Badge>
              <span className="flex-1" />
              {confirmId === cp.id ? (
                <div className="flex items-center gap-1">
                  <AlertTriangle className="size-3 text-yellow-500" />
                  <span className="text-[10px] text-yellow-600">确认回滚？</span>
                  <Button size="xs" variant="destructive" disabled={applyingId !== null} onClick={() => void handleApply(cp.id)}>
                    {applyingId === cp.id ? <Loader2 className="size-3 animate-spin" /> : "确认"}
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => setConfirmId(null)}>取消</Button>
                </div>
              ) : (
                <>
                  <Button size="xs" variant="ghost" disabled={previewingId !== null} onClick={() => void handlePreview(cp.id)}>
                    {previewingId === cp.id ? <Loader2 className="size-3 animate-spin" /> : "预览"}
                  </Button>
                  <Button size="xs" variant="outline" onClick={() => setConfirmId(cp.id)}>
                    <RotateCcw className="size-3 mr-1" />
                    回滚
                  </Button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {preview != null && (
        <div className="rounded-md border border-border bg-muted/30 p-2">
          <p className="text-[10px] font-medium text-muted-foreground mb-1">回滚预览</p>
          <pre className="text-[10px] text-muted-foreground overflow-x-auto max-h-32 whitespace-pre-wrap">
            {JSON.stringify(preview, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
