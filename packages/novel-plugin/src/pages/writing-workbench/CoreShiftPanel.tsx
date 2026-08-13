/**
 * CoreShiftPanel — 核心转折面板
 *
 * 展示提案卡片列表，支持接受/拒绝操作
 */
import { useState } from "react";
import { Loader2, Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fetchJson, invalidateApiPaths, useApi } from "@/hooks/use-api";

interface CoreShift {
  id: string;
  targetType: string;
  targetId: string;
  fromSnapshot: Record<string, unknown>;
  toSnapshot: Record<string, unknown>;
  triggeredBy: "author" | "data-signal" | "continuity-audit";
  chapterAt: number;
  affectedChaptersJson: string;
  impactAnalysisJson: string;
  status: "proposed" | "accepted" | "rejected" | "applied";
  createdAt: string;
  appliedAt: string | null;
}

export interface CoreShiftPanelProps {
  bookId: string;
}

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  proposed: { label: "待定", variant: "default" },
  accepted: { label: "已接受", variant: "secondary" },
  rejected: { label: "已拒绝", variant: "outline" },
  applied: { label: "已应用", variant: "secondary" },
};

const TARGET_LABELS: Record<string, string> = {
  "premise": "前提",
  "character-arc": "角色弧",
  "conflict": "冲突",
  "world-model": "世界模型",
  "outline": "大纲",
};

const TRIGGER_LABELS: Record<string, string> = {
  author: "作者",
  "data-signal": "数据信号",
  "continuity-audit": "一致性审查",
};

export function CoreShiftPanel({ bookId }: CoreShiftPanelProps) {
  const { data, loading, error } = useApi<{ coreShifts: CoreShift[] }>(
    `/api/books/${encodeURIComponent(bookId)}/core-shifts`,
  );
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const shifts = data?.coreShifts ?? [];

  async function handleAction(id: string, action: "accept" | "reject") {
    setActionLoading(id);
    try {
      await fetchJson(`/api/books/${encodeURIComponent(bookId)}/core-shifts/${id}/${action}`, { method: "POST" });
      invalidateApiPaths([`/api/books/${encodeURIComponent(bookId)}/core-shifts`]);
    } finally {
      setActionLoading(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return <p className="text-xs text-destructive p-2">{error}</p>;
  }

  if (shifts.length === 0) {
    return (
      <p className="text-xs text-muted-foreground p-2">
        尚无核心转折提案（写作过程中自动生成或手动创建）
      </p>
    );
  }

  return (
    <div className="space-y-2 max-h-80 overflow-y-auto">
      {shifts.map((shift) => {
        const cfg = STATUS_CONFIG[shift.status] ?? STATUS_CONFIG.proposed;
        const isPending = shift.status === "proposed";
        let impact: { summary?: string } = {};
        try { impact = JSON.parse(shift.impactAnalysisJson || "{}"); } catch { /* ignore */ }

        return (
          <div key={shift.id} className="rounded-md border border-border p-2.5 space-y-1.5">
            {/* Header */}
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={cfg.variant} className="text-[10px]">{cfg.label}</Badge>
              <span className="text-xs font-medium">
                {TARGET_LABELS[shift.targetType] ?? shift.targetType}
              </span>
              <span className="text-[10px] text-muted-foreground">
                第{shift.chapterAt}章 · {TRIGGER_LABELS[shift.triggeredBy] ?? shift.triggeredBy}
              </span>
            </div>

            {/* Content: to snapshot summary */}
            <div className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">变更: </span>
              {summarizeSnapshot(shift.toSnapshot)}
            </div>

            {/* Impact */}
            {impact.summary && (
              <div className="text-[10px] text-muted-foreground">
                <span className="font-medium">影响: </span>{impact.summary}
              </div>
            )}

            {/* Actions for pending */}
            {isPending && (
              <div className="flex items-center gap-1.5 pt-1">
                <Button
                  size="xs"
                  variant="default"
                  disabled={actionLoading === shift.id}
                  onClick={() => void handleAction(shift.id, "accept")}
                >
                  {actionLoading === shift.id ? <Loader2 className="size-3 animate-spin mr-1" /> : <Check className="size-3 mr-1" />}
                  接受
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={actionLoading === shift.id}
                  onClick={() => void handleAction(shift.id, "reject")}
                >
                  <X className="size-3 mr-1" />
                  拒绝
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function summarizeSnapshot(snap: Record<string, unknown>): string {
  const entries = Object.entries(snap).slice(0, 3);
  if (entries.length === 0) return "（无详细信息）";
  return entries.map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join("; ");
}
