import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, X } from "lucide-react";

export interface ResourceHistoryEntry {
  id: string;
  title: string;
  type: string;
  status: string;
  version?: number;
  parentId?: string | null;
  updatedAt?: string | number;
}

export interface ResourceHistoryPanelProps {
  entries: readonly ResourceHistoryEntry[];
  loading?: boolean;
  error?: string | null;
  onClose: () => void;
}

function formatDate(value: string | number | undefined): string {
  if (value === undefined) return "";
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const statusLabel: Record<string, string> = {
  draft: "草稿",
  candidate: "候选",
  accepted: "正式",
  rejected: "拒绝",
  archived: "归档",
};

export function ResourceHistoryPanel({ entries, loading = false, error, onClose }: ResourceHistoryPanelProps) {
  return (
    <aside className="shrink-0 border-b border-border bg-muted/20 px-4 py-3" aria-label="版本历史">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-sm font-semibold">版本历史</h3>
        <Badge variant="outline" className="text-[10px]">parent 链</Badge>
        <span className="flex-1" />
        <Button size="xs" variant="ghost" onClick={onClose} title="关闭历史">
          <X className="size-3" />
        </Button>
      </div>
      {loading ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" />正在加载历史…</p>
      ) : error ? (
        <p role="alert" className="text-xs text-destructive">{error}</p>
      ) : entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">暂无历史版本。</p>
      ) : (
        <ol className="space-y-2">
          {entries.map((entry, index) => (
            <li key={entry.id} className="rounded-md border border-border bg-background px-3 py-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="font-medium">{index + 1}. {entry.title}</span>
                <Badge variant="secondary" className="text-[10px]">v{entry.version ?? "?"}</Badge>
                <Badge variant="outline" className="text-[10px]">{statusLabel[entry.status] ?? entry.status}</Badge>
                <span className="ml-auto text-[10px] text-muted-foreground">{formatDate(entry.updatedAt)}</span>
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">ID: {entry.id}{entry.parentId ? ` · parent: ${entry.parentId}` : " · 根版本"}</p>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
