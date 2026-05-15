import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Check, X, Archive, Trash2, ChevronDown, Loader2 } from "lucide-react";

export type CandidateAcceptAction = "merge" | "replace" | "draft";
export type CandidateStatus = "candidate" | "accepted" | "rejected" | "archived";

export interface CandidateActionsBarProps {
  candidateId: string;
  bookId: string;
  status: CandidateStatus;
  source?: string;
  targetChapterId?: string;
  createdAt?: string;
  onAccept: (candidateId: string, action: CandidateAcceptAction) => Promise<void>;
  onReject: (candidateId: string) => Promise<void>;
  onArchive: (candidateId: string) => Promise<void>;
  onDelete: (candidateId: string) => Promise<void>;
}

const statusLabels: Record<CandidateStatus, string> = {
  candidate: "待处理",
  accepted: "已接受",
  rejected: "已拒绝",
  archived: "已归档",
};

const statusVariants: Record<CandidateStatus, string> = {
  candidate: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  accepted: "bg-green-500/10 text-green-600 border-green-500/20",
  rejected: "bg-red-500/10 text-red-600 border-red-500/20",
  archived: "bg-gray-500/10 text-gray-600 border-gray-500/20",
};

function formatDate(iso: string | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export function CandidateActionsBar({
  candidateId,
  status,
  source,
  targetChapterId,
  createdAt,
  onAccept,
  onReject,
  onArchive,
  onDelete,
}: CandidateActionsBarProps) {
  const [loading, setLoading] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPending = status === "candidate";
  const isTerminal = status === "accepted" || status === "rejected" || status === "archived";

  async function handleAction(actionId: string, fn: () => Promise<void>) {
    setLoading(actionId);
    setError(null);
    try {
      await fn();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* 状态 Badge */}
      <Badge variant="outline" className={`text-[10px] ${statusVariants[status]}`}>
        {statusLabels[status]}
      </Badge>

      {/* 元信息 */}
      {source && <span className="text-[10px] text-muted-foreground">来源: {source}</span>}
      {targetChapterId && <span className="text-[10px] text-muted-foreground">目标: 第{targetChapterId}章</span>}
      {createdAt && <span className="text-[10px] text-muted-foreground">{formatDate(createdAt)}</span>}

      {/* 分隔 */}
      <span className="flex-1" />

      {/* 错误提示 */}
      {error && <span className="text-xs text-destructive">{error}</span>}

      {/* 操作按钮 — 仅待处理状态可操作 */}
      {isPending && (
        <>
          {/* 接受（下拉菜单） */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className={`inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 ${loading !== null ? "opacity-50 pointer-events-none" : ""}`}
            >
              {loading === "accept" ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
              接受
              <ChevronDown className="size-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => void handleAction("accept", () => onAccept(candidateId, "replace"))}>
                替换章节 — 用候选稿覆盖目标章节
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void handleAction("accept", () => onAccept(candidateId, "merge"))}>
                合并到章节 — 追加到目标章节末尾
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void handleAction("accept", () => onAccept(candidateId, "draft"))}>
                另存为草稿 — 保留候选稿为草稿
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* 拒绝 */}
          <Button
            size="xs"
            variant="outline"
            disabled={loading !== null}
            onClick={() => void handleAction("reject", () => onReject(candidateId))}
          >
            {loading === "reject" ? <Loader2 className="size-3 animate-spin mr-1" /> : <X className="size-3 mr-1" />}
            拒绝
          </Button>

          {/* 归档 */}
          <Button
            size="xs"
            variant="ghost"
            disabled={loading !== null}
            onClick={() => void handleAction("archive", () => onArchive(candidateId))}
          >
            {loading === "archive" ? <Loader2 className="size-3 animate-spin mr-1" /> : <Archive className="size-3 mr-1" />}
            归档
          </Button>
        </>
      )}

      {/* 删除 — 所有状态可用 */}
      {confirmDelete ? (
        <div className="flex items-center gap-1">
          <span className="text-xs text-destructive">确认删除？</span>
          <Button
            size="xs"
            variant="destructive"
            disabled={loading !== null}
            onClick={() => { setConfirmDelete(false); void handleAction("delete", () => onDelete(candidateId)); }}
          >
            确认
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setConfirmDelete(false)}>
            取消
          </Button>
        </div>
      ) : (
        <Button
          size="xs"
          variant="ghost"
          disabled={loading !== null || isTerminal && status === "accepted"}
          onClick={() => setConfirmDelete(true)}
          title="删除候选稿"
        >
          <Trash2 className="size-3" />
        </Button>
      )}
    </div>
  );
}
