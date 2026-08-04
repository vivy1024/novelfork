import { Badge } from "@/components/ui/badge";

interface UsageWindow {
  readonly type: string;
  readonly remaining: number;
  readonly total: number;
  readonly resetAt?: string; // ISO timestamp
}

interface CodexUsageDisplayProps {
  readonly planTier?: string;
  readonly windows: readonly UsageWindow[];
  readonly queriedAt?: string;
}

function formatRelativeTime(isoString: string): string {
  const diff = new Date(isoString).getTime() - Date.now();
  if (diff <= 0) return "即将重置";
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m 后重置`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h 后重置`;
  const days = Math.floor(hours / 24);
  return `${days}d 后重置`;
}

function formatQueriedAt(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  if (diff < 60000) return "刚刚查询";
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes} 分钟前查询`;
  const hours = Math.floor(minutes / 60);
  return `${hours} 小时前查询`;
}

function getBarColor(remaining: number, total: number): string {
  if (total <= 0) return "bg-green-500";
  const pct = (remaining / total) * 100;
  if (pct < 10) return "bg-red-500";
  if (pct < 30) return "bg-yellow-500";
  return "bg-green-500";
}

export function CodexUsageDisplay({ planTier, windows, queriedAt }: CodexUsageDisplayProps) {
  if (!windows.length) {
    return (
      <div className="flex items-center justify-center text-muted-foreground text-sm py-4">
        暂无使用数据
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {planTier && (
        <div>
          <Badge variant="secondary">{planTier}</Badge>
        </div>
      )}

      <div className="space-y-2">
        {windows.map((w) => {
          const pct = w.total > 0 ? (w.remaining / w.total) * 100 : 0;
          return (
            <div key={w.type} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{w.type}</span>
                <span className="tabular-nums">
                  {w.remaining} / {w.total}
                </span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${getBarColor(w.remaining, w.total)}`}
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
              </div>
              {w.resetAt && (
                <p className="text-xs text-muted-foreground text-right">
                  {formatRelativeTime(w.resetAt)}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {queriedAt && (
        <p className="text-xs text-muted-foreground pt-1">
          {formatQueriedAt(queriedAt)}
        </p>
      )}
    </div>
  );
}
